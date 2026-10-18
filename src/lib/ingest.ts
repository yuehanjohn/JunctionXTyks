// ── Live lab-feed demo: simulated LIS ingestion ──────────────────────
//
// The challenge asks for a "rolling, real-time" tool, but the mock-up dataset
// is static. This module stands in for the laboratory information system:
// it inserts new cultures/isolates/susceptibilities dated "now" so the whole
// pipeline (dataMax-keyed cache invalidation → recompute → z-test scan →
// signal badge) reacts exactly as it would in a live laboratory.
//
// Two scenarios:
// - "routine": a trickle of ordinary samples mimicking real recent isolates —
//   numbers drift, no alarm.
// - "outbreak": the drill. ICU × Klebsiella pneumoniae × Ciprofloxacin has a
//   trailing-12-month baseline of n≈131 at ≈77% S and no standing signal; a
//   burst of isolates at ≈25% S over the last 14 days produces a ≈50 pp drop,
//   z far below −4 → a new "high"-severity signal fires on the next scan.
//
// Everything inserted uses ids prefixed SIM- so DELETE can revert the demo.

import { db } from "./db";

const SIM_PREFIX = "SIM-";

interface OutbreakSpec {
  ward: string;
  organism: string;
  antibiotic: string;
  susceptibleFraction: number;
  count: number;
}

const OUTBREAK: OutbreakSpec = {
  ward: "ICU",
  organism: "Klebsiella pneumoniae",
  antibiotic: "Ciprofloxacin",
  susceptibleFraction: 0.25,
  count: 45,
};

/** Observed per-antibiotic S-rate for an organism — new isolates mimic the
 *  organism's real panel instead of inventing one. */
async function observedPanel(organism: string): Promise<{ antibiotic: string; sRate: number }[]> {
  const rows = await db.susceptibility.findMany({
    where: { isolate: { organism } },
    select: { antibiotic: true, result: true },
  });
  const tally = new Map<string, { s: number; r: number }>();
  for (const row of rows) {
    if (row.result !== "S" && row.result !== "R") continue;
    const cell = tally.get(row.antibiotic) ?? { s: 0, r: 0 };
    if (row.result === "S") cell.s += 1;
    else cell.r += 1;
    tally.set(row.antibiotic, cell);
  }
  return [...tally.entries()]
    .filter(([, c]) => c.s + c.r >= 10)
    .map(([antibiotic, c]) => ({ antibiotic, sRate: c.s / (c.s + c.r) }));
}

/** A real recent isolate to mimic: ward, sample type, organism, panel. */
async function recentIsolateTemplate() {
  const since = new Date(Date.now() - 90 * 86_400_000);
  const candidates = await db.isolate.findMany({
    where: { culture: { takenAt: { gte: since } } },
    select: {
      organism: true,
      culture: { select: { ward: true, sampleType: true } },
    },
    take: 500,
  });
  if (candidates.length === 0) return null;
  const template = candidates[Math.floor(Math.random() * candidates.length)];
  const panel = await observedPanel(template.organism);
  return {
    ward: template.culture.ward,
    sampleType: template.culture.sampleType,
    organism: template.organism,
    panel,
  };
}

interface SimSusceptibility {
  antibiotic: string;
  result: "S" | "R";
}

function drawPanel(
  panel: { antibiotic: string; sRate: number }[],
  override: { antibiotic: string; sRate: number } | null,
): SimSusceptibility[] {
  const rows: SimSusceptibility[] = [];
  for (const entry of panel) {
    const sRate = override && entry.antibiotic === override.antibiotic
      ? override.sRate
      : entry.sRate;
    rows.push({ antibiotic: entry.antibiotic, result: Math.random() < sRate ? "S" : "R" });
  }
  return rows;
}

export async function ingestSimulated(scenario: "routine" | "outbreak", count?: number) {
  const stamp = Date.now().toString(36);

  // Routine: one template per sample (ward/organism spread); outbreak: fixed drill.
  const outbreak = scenario === "outbreak";
  const n = outbreak ? OUTBREAK.count : Math.max(1, Math.min(12, count ?? 3));

  // Samples land just AFTER the newest existing sample so the dataMax marker —
  // the cache-invalidation key and the rolling-window anchor — always moves
  // forward. (The synthetic dataset's newest sample can sit ahead of the wall
  // clock, so "now minus random days" would often not move it.)
  const latest = await db.culture.aggregate({ _max: { takenAt: true } });
  const baseMs = Math.max(Date.now(), latest._max.takenAt?.getTime() ?? Date.now());

  const patientCount = await db.patient.count();
  const creates: Parameters<typeof db.culture.create>[0][] = [];
  let maxTakenAtMs = 0;
  let susCount = 0;

  const outbreakPanel = outbreak ? await observedPanel(OUTBREAK.organism) : [];
  const outbreakOverride = {
    antibiotic: OUTBREAK.antibiotic,
    sRate: OUTBREAK.susceptibleFraction,
  };

  for (let i = 0; i < n; i++) {
    const t = outbreak
      ? {
          ward: OUTBREAK.ward,
          sampleType: Math.random() < 0.68 ? "urine" : "blood",
          organism: OUTBREAK.organism,
          panel: outbreakPanel,
          override: outbreakOverride,
        }
      : await recentIsolateTemplate().then((r) => (r ? { ...r, override: null } : null));
    if (!t || t.panel.length === 0) continue;

    const takenAt = new Date(baseMs + 60_000 + Math.floor(Math.random() * 3_600_000));
    maxTakenAtMs = Math.max(maxTakenAtMs, takenAt.getTime());

    const patient = await db.patient.findFirst({
      select: { id: true },
      skip: Math.floor(Math.random() * patientCount),
    });
    if (!patient) continue;

    const sus = drawPanel(t.panel, t.override);
    susCount += sus.length;
    creates.push({
      data: {
        id: `${SIM_PREFIX}C-${stamp}-${i}`,
        patientId: patient.id,
        sampleType: t.sampleType,
        ward: t.ward,
        takenAt,
        isolates: {
          create: {
            id: `${SIM_PREFIX}I-${stamp}-${i}`,
            organism: t.organism,
            susceptibilities: {
              create: sus.map((s, j) => ({
                id: `${SIM_PREFIX}S-${stamp}-${i}-${j}`,
                antibiotic: s.antibiotic,
                result: s.result,
              })),
            },
          },
        },
      },
    });
  }

  await db.$transaction(async (tx) => {
    for (const args of creates) {
      await tx.culture.create(args);
    }
  });

  return {
    scenario,
    cultures: creates.length,
    isolates: creates.length,
    susceptibilities: susCount,
    ward: outbreak ? OUTBREAK.ward : null,
    organism: outbreak ? OUTBREAK.organism : null,
    antibiotic: outbreak ? OUTBREAK.antibiotic : null,
    dataMax: new Date(maxTakenAtMs || baseMs).toISOString(),
  };
}

export async function resetSimulated() {
  const deletedSus = await db.susceptibility.deleteMany({
    where: { id: { startsWith: SIM_PREFIX } },
  });
  const deletedIso = await db.isolate.deleteMany({
    where: { id: { startsWith: SIM_PREFIX } },
  });
  const deletedCul = await db.culture.deleteMany({
    where: { id: { startsWith: SIM_PREFIX } },
  });
  const agg = await db.culture.aggregate({ _max: { takenAt: true } });
  return {
    removed: {
      cultures: deletedCul.count,
      isolates: deletedIso.count,
      susceptibilities: deletedSus.count,
    },
    dataMax: agg._max.takenAt ? agg._max.takenAt.toISOString() : "",
  };
}
