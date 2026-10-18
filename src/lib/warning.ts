// ── Early-warning DB adapters & feeds ─────────────────────────────────
//
// Bridges the pure detection core (detect.ts / mdro.ts) to the database and
// exposes the unified warning feed, MDRO feed, transfer pathways and the
// weekly sitrep. All clinical-safety framing lives here: every warning is a
// statistical hypothesis for investigation — never a confirmed outbreak,
// never ward blame, never patient-specific therapy.

import { db } from "./db";
import {
  clusterScan,
  cusumScan,
  DEFAULT_CLUSTER_CONFIG,
  proportionDropScan,
  type DetIsolate,
  type DetectionConfig,
} from "./detect";
import { classifyIsolate, MDRO_DEFINITIONS, mdroByWard, mdroCusumScan, mdroWeekly, recentMdro } from "./mdro";
import { getBacktest } from "./backtest";
import { getOverview } from "./pulse";
import type {
  MdroResponse,
  PathwaysResponse,
  TimelineWarning,
  TimelineWeek,
  TransferEdge,
  Warning,
  WarningFeedResponse,
  WarningKind,
  WarningTimelineResponse,
} from "./types";
import { cachedByDataMax } from "./stats";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

// ── Row adapter: DB → DetIsolate (first isolate per patient|organism) ─

/** DB → detector rows. Returns BOTH: raw rows (for the proportion-drop
 *  detector, which dedupes per period itself) and span-deduped rows (first
 *  isolate per patient|organism — what the count detectors need, so repeat
 *  cultures don't inflate counts). */
export async function loadDetIsolates(
  asOf: string | null | undefined,
  spanDays: number,
  ward?: string,
): Promise<{ rows: DetIsolate[]; deduped: DetIsolate[]; anchor: Date }> {
  const agg = await db.culture.aggregate({ _max: { takenAt: true } });
  const dataMax = agg._max.takenAt ?? new Date();
  let anchor = dataMax;
  if (asOf) {
    const t = new Date(asOf);
    if (!Number.isNaN(t.getTime()) && t.getTime() < dataMax.getTime()) anchor = t;
  }
  const from = new Date(anchor.getTime() - spanDays * DAY_MS);
  const isolates = await db.isolate.findMany({
    where: {
      culture: {
        ...(ward && ward !== "All wards" ? { ward } : {}),
        takenAt: { gte: from, lte: anchor },
      },
    },
    select: {
      id: true,
      organism: true,
      culture: { select: { patientId: true, ward: true, sampleType: true, takenAt: true } },
      susceptibilities: { select: { antibiotic: true, result: true } },
    },
  });
  const firstByKey = new Map<string, (typeof isolates)[number]>();
  for (const row of [...isolates].sort(
    (a, b) =>
      a.culture.takenAt.getTime() - b.culture.takenAt.getTime() || (a.id < b.id ? -1 : 1),
  )) {
    const key = `${row.culture.patientId}|${row.organism}`;
    if (!firstByKey.has(key)) firstByKey.set(key, row);
  }
  const toDet = (row: (typeof isolates)[number]): DetIsolate => {
    const results: Record<string, "S" | "R"> = {};
    for (const sus of row.susceptibilities) {
      if (sus.result === "S" || sus.result === "R") results[sus.antibiotic] = sus.result;
    }
    return {
      id: row.id,
      patientId: row.culture.patientId,
      organism: row.organism,
      ward: row.culture.ward,
      sampleType: row.culture.sampleType,
      takenAt: row.culture.takenAt.getTime(),
      results,
    };
  };
  const rows: DetIsolate[] = isolates.map(toDet);
  const deduped: DetIsolate[] = [...firstByKey.values()].map(toDet);
  return { rows, deduped, anchor };
}

// ── Unified warning feed ──────────────────────────────────────────────

const severityOf = (ratio: number): Warning["severity"] =>
  ratio >= 2 ? "high" : ratio >= 1.3 ? "moderate" : "watch";

/** Distinct (ward, organism, antibiotic) cells with a reportable window
 *  (n ≥ 30) and a baseline — the honest denominator for "cells scanned". */
function countTestedCells(rows: DetIsolate[], windowFrom: number): number {
  const windowRows = rows.filter((r) => r.takenAt >= windowFrom);
  const baselineFrom = windowFrom - 365 * DAY_MS;
  const cellWindow = new Map<string, number>();
  const cellBaseline = new Set<string>();
  for (const row of rows) {
    const bases = Object.keys(row.results);
    if (row.takenAt >= baselineFrom) {
      for (const ab of bases) {
        if (row.takenAt >= windowFrom) {
          const key = `${row.ward}|${row.organism}|${ab}`;
          cellWindow.set(key, (cellWindow.get(key) ?? 0) + 1);
        }
        cellBaseline.add(`${row.ward}|${row.organism}|${ab}`);
      }
    }
  }
  let n = 0;
  for (const [key, count] of cellWindow) {
    if (count >= 30 && cellBaseline.has(key)) n += 1;
  }
  return n;
}

export async function getWarningFeed(opts: {
  ward?: string;
  asOf?: string | null;
}): Promise<WarningFeedResponse> {
  const bt = await getBacktest();
  const config: DetectionConfig = bt.config;
  // 421 days: 28d window + 393d D1 baseline + 26-week CUSUM/MDRO span.
  const { rows, deduped, anchor } = await loadDetIsolates(opts.asOf, 421, opts.ward);
  const windowStart = new Date(anchor.getTime() - 28 * DAY_MS);

  const warnings: Warning[] = [];
  const mk = (
    kind: WarningKind,
    ward: string,
    organism: string,
    antibiotic: string | null,
    severity: Warning["severity"],
    score: number,
    headline: string,
    evidence: string,
    mdro: boolean,
  ): Warning => ({
    id: `${kind}|${ward}|${organism}|${antibiotic ?? "panel"}`,
    kind,
    ward,
    organism,
    antibiotic,
    severity,
    score: Math.round(score * 100) / 100,
    headline,
    evidence,
    windowStart: windowStart.toISOString(),
    windowEnd: anchor.toISOString(),
    mdro,
  });

  // D1: proportion drops — 28d window vs 365d baseline, z ≤ −3 + BH FDR
  // across the scan (pure core, same thresholds the backtest tuned).
  for (const s of proportionDropScan(rows)) {
    const ratio = Math.abs(s.z) / 2.5; // z ≥ 5 → high, z ≥ 3.25 → moderate
    warnings.push(
      mk(
        "proportion-drop",
        s.ward,
        s.organism,
        s.antibiotic,
        severityOf(ratio),
        ratio * 2,
        `${s.organism}: susceptibility to ${s.antibiotic} down ${s.dropPp} pp on ${s.ward}`,
        `%S ${s.baselineS} → ${s.windowS} over the rolling 4 weeks (n=${s.nWindow} vs ${s.nBaseline} baseline; z=${s.z}, FDR-significant). Population-level finding — investigate before drawing conclusions.`,
        false,
      ),
    );
  }

  // D2: weekly-count CUSUM per (ward, organism).
  for (const f of cusumScan(deduped, config)) {
    const wk = new Date(f.week).getTime();
    if (wk < anchor.getTime() - 14 * DAY_MS) continue;
    const ratio = f.cusum / config.cusumH;
    const cellRows = deduped.filter(
      (r) => r.ward === f.ward && r.organism === f.organism && r.takenAt >= wk && r.takenAt < wk + WEEK_MS,
    );
    const mdro = cellRows.some((r) => classifyIsolate(r).phenotypes.length > 0);
    warnings.push(
      mk(
        "count-cusum",
        f.ward,
        f.organism,
        null,
        severityOf(ratio),
        ratio * 2,
        `${f.organism}: sustained isolate-count elevation on ${f.ward}`,
        `${f.count} isolates this week vs ${f.expected}/week trailing baseline (CUSUM ${f.cusum} ≥ ${config.cusumH}). Sustained elevation can precede resistance shifts — review sampling and infection-prevention context.`,
        mdro,
      ),
    );
  }

  // D3: 14-day cluster scan.
  for (const f of clusterScan(deduped, { ...DEFAULT_CLUSTER_CONFIG, ...config, recentDays: 7 })) {
    const cellRows = deduped.filter(
      (r) =>
        r.ward === f.ward &&
        r.organism === f.organism &&
        r.takenAt >= anchor.getTime() - 14 * DAY_MS,
    );
    const mdro = cellRows.some((r) => classifyIsolate(r).phenotypes.length > 0);
    const ratio = -Math.log10(Math.max(f.p, 1e-9)) / 3;
    warnings.push(
      mk(
        "cluster",
        f.ward,
        f.organism,
        null,
        severityOf(ratio),
        ratio * 2,
        `${f.organism}: temporal cluster on ${f.ward}`,
        `${f.observed} isolates in 14 days vs ${f.expected} expected from the cell's own 90-day rate (Poisson p=${f.p.toExponential(1)}). Epidemiological candidate — molecular typing is unavailable, so this is not confirmed transmission.`,
        mdro,
      ),
    );
  }

  // D4: MDRO phenotype rare-event CUSUM per (ward, class).
  for (const f of mdroCusumScan(deduped, config)) {
    const wk = new Date(f.week).getTime();
    if (wk < anchor.getTime() - 14 * DAY_MS) continue;
    const ratio = f.cusum / 4;
    warnings.push(
      mk(
        "count-cusum",
        f.ward,
        f.organisms.join(" + ") || f.phenotype,
        null,
        severityOf(ratio),
        ratio * 2 + 1, // MDRO involvement boosts priority
        `${f.phenotype}: rising MDRO count on ${f.ward}`,
        `${f.count} ${f.phenotype}-phenotype isolate${f.count === 1 ? "" : "s"} this week vs ${f.expected}/week trailing baseline (CUSUM ${f.cusum}). Phenotype proxies from the susceptibility panel — confirm with the laboratory.`,
        true,
      ),
    );
  }

  const severityRank: Record<Warning["severity"], number> = { high: 0, moderate: 1, watch: 2 };
  warnings.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      b.score - a.score ||
      (a.id < b.id ? -1 : 1),
  );

  return {
    warnings,
    expectedPerMonth: bt.falseAlarmsPerMonth,
    cellsScanned: countTestedCells(deduped, windowStart.getTime()),
    config: { ...config, zThreshold: 3, dropPpThreshold: 5 },
    budget: `Thresholds tuned on the synthetic backtest harness for ≤2 false alarms/month hospital-wide (measured ${bt.falseAlarmsPerMonth}/month); latency targets verified against injected outbreaks.`,
    windowStart: windowStart.toISOString(),
    windowEnd: anchor.toISOString(),
    generatedAt: new Date().toISOString(),
  };
}

// ── Warning timeline (transmission-map replay) ────────────────────────
// One pass over history: for each of the last N weeks, the warnings that
// were live at that week's end. Powers the map replay without N round-trips.

export async function getWarningTimeline(opts: {
  weeks?: number;
  ward?: string;
  asOf?: string | null;
}): Promise<WarningTimelineResponse> {
  const weeks = Math.min(Math.max(opts.weeks ?? 13, 4), 26);
  const bt = await getBacktest();
  const config: DetectionConfig = bt.config;
  const compute = async (): Promise<WarningTimelineResponse> => {
    // 26 weeks of detector span + 393 days of D1 baseline.
    const { rows, deduped, anchor } = await loadDetIsolates(opts.asOf, 26 * 7 + 393, opts.ward);
    const points: TimelineWeek[] = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const weekEnd = anchor.getTime() - i * 7 * DAY_MS;
      const hist = rows.filter((r) => r.takenAt <= weekEnd);
      const histDeduped = deduped.filter((r) => r.takenAt <= weekEnd);
      const out: TimelineWarning[] = [];
      for (const s of proportionDropScan(hist)) {
        out.push({
          kind: "proportion-drop",
          ward: s.ward,
          organism: s.organism,
          antibiotic: s.antibiotic,
          severity: severityOf(Math.abs(s.z) / 2.5),
          headline: `${s.organism} / ${s.antibiotic}: %S down ${s.dropPp} pp on ${s.ward}`,
        });
      }
      for (const f of cusumScan(histDeduped, config)) {
        if (new Date(f.week).getTime() < weekEnd - 14 * DAY_MS) continue;
        out.push({
          kind: "count-cusum",
          ward: f.ward,
          organism: f.organism,
          antibiotic: null,
          severity: severityOf(f.cusum / config.cusumH),
          headline: `${f.organism}: ${f.count} isolates vs ${f.expected}/week on ${f.ward}`,
        });
      }
      for (const f of clusterScan(histDeduped, { ...DEFAULT_CLUSTER_CONFIG, ...config, recentDays: 3 })) {
        out.push({
          kind: "cluster",
          ward: f.ward,
          organism: f.organism,
          antibiotic: null,
          severity: severityOf(-Math.log10(Math.max(f.p, 1e-9)) / 3),
          headline: `${f.organism}: ${f.observed} isolates in 14 days on ${f.ward}`,
        });
      }
      for (const f of mdroCusumScan(histDeduped, config)) {
        if (new Date(f.week).getTime() < weekEnd - 14 * DAY_MS) continue;
        out.push({
          kind: "count-cusum",
          ward: f.ward,
          organism: f.organisms.join(" + "),
          antibiotic: null,
          severity: severityOf(f.cusum / 4),
          headline: `${f.phenotype}: ${f.count} MDRO isolates vs ${f.expected}/week on ${f.ward}`,
        });
      }
      const severityRank: Record<Warning["severity"], number> = { high: 0, moderate: 1, watch: 2 };
      out.sort(
        (a, b) => severityRank[a.severity] - severityRank[b.severity] || a.ward.localeCompare(b.ward),
      );
      points.push({ weekEnd: new Date(weekEnd).toISOString(), warnings: out });
    }
    const wardRows = await db.culture.findMany({ distinct: ["ward"], select: { ward: true } });
    return {
      points,
      wards: wardRows.map((w) => w.ward).sort(),
      generatedAt: new Date().toISOString(),
    };
  };
  return cachedByDataMax("warning-timeline", { weeks, ward: opts.ward ?? null }, compute);
}

// ── MDRO feed ─────────────────────────────────────────────────────────

export async function getMdroFeed(opts: {
  ward?: string;
  asOf?: string | null;
}): Promise<MdroResponse> {
  const { rows, anchor } = await loadDetIsolates(opts.asOf, 182, opts.ward);
  const windowFrom = anchor.getTime() - 28 * DAY_MS;
  const windowRows = rows.filter((r) => r.takenAt >= windowFrom);
  return {
    ward: opts.ward ?? "All wards",
    asOf: opts.asOf ?? null,
    windowStart: new Date(windowFrom).toISOString(),
    windowEnd: anchor.toISOString(),
    generatedAt: new Date().toISOString(),
    weeks: mdroWeekly(rows, anchor.getTime(), 26),
    wards: mdroByWard(windowRows),
    recent: recentMdro(windowRows, 12),
    totalIsolates: windowRows.length,
    mdroIsolates: windowRows.filter((r) => classifyIsolate(r).phenotypes.length > 0).length,
    definitions: MDRO_DEFINITIONS,
  };
}

// ── Patient-pathway transfer network ──────────────────────────────────

export async function getPathways(opts: { asOf?: string | null }): Promise<PathwaysResponse> {
  const agg = await db.culture.aggregate({ _max: { takenAt: true } });
  const dataMax = agg._max.takenAt ?? new Date();
  let anchor = dataMax;
  if (opts.asOf) {
    const t = new Date(opts.asOf);
    if (!Number.isNaN(t.getTime()) && t.getTime() < dataMax.getTime()) anchor = t;
  }
  const transferGapDays = 30;
  const from = new Date(anchor.getTime() - (transferGapDays + 30) * DAY_MS);
  const windowFrom = anchor.getTime() - transferGapDays * DAY_MS;

  const cultures = await db.culture.findMany({
    where: { takenAt: { gte: from, lte: anchor } },
    select: { patientId: true, ward: true, takenAt: true },
    orderBy: { takenAt: "asc" },
  });

  const byPatient = new Map<string, { ward: string; takenAt: number }[]>();
  for (const c of cultures) {
    const list = byPatient.get(c.patientId);
    if (list) list.push({ ward: c.ward, takenAt: c.takenAt.getTime() });
    else byPatient.set(c.patientId, [{ ward: c.ward, takenAt: c.takenAt.getTime() }]);
  }

  const edges = new Map<string, Set<string>>(); // "from|to" → patientIds
  for (const [patientId, seq] of byPatient) {
    for (let i = 1; i < seq.length; i++) {
      const prev = seq[i - 1]!;
      const cur = seq[i]!;
      if (prev.ward === cur.ward) continue;
      const gap = cur.takenAt - prev.takenAt;
      if (gap > transferGapDays * DAY_MS) continue;
      if (cur.takenAt < windowFrom) continue;
      const key = `${prev.ward}|${cur.ward}`;
      const patients = edges.get(key) ?? new Set<string>();
      patients.add(patientId);
      edges.set(key, patients);
    }
  }

  const edgeList: TransferEdge[] = [...edges.entries()]
    .map(([key, patients]) => {
      const [fromWard, toWard] = key.split("|");
      return { from: fromWard!, to: toWard!, patients: patients.size };
    })
    .sort((a, b) => b.patients - a.patients);

  const flows: PathwaysResponse["flows"] = [];
  const wards = [...new Set(edgeList.flatMap((e) => [e.from, e.to]))];
  for (const ward of wards) {
    const inbound = edgeList.filter((e) => e.to === ward);
    const outbound = edgeList.filter((e) => e.from === ward);
    flows.push({
      ward,
      inbound: inbound.reduce((s, e) => s + e.patients, 0),
      outbound: outbound.reduce((s, e) => s + e.patients, 0),
      topInbound: inbound.slice(0, 3).map((e) => ({ from: e.from, patients: e.patients })),
      topOutbound: outbound.slice(0, 3).map((e) => ({ to: e.to, patients: e.patients })),
    });
  }
  flows.sort((a, b) => b.inbound + b.outbound - (a.inbound + a.outbound));

  return {
    windowStart: new Date(windowFrom).toISOString(),
    windowEnd: anchor.toISOString(),
    transferGapDays,
    generatedAt: new Date().toISOString(),
    edges: edgeList,
    flows,
    note:
      "Ward-to-ward patient flows reconstructed from repeat cultures (same patient cultured on different wards within 30 days) — a proxy for patient transfer, since the dataset carries no admission records. Inbound patients can import resistance; this is hypothesis material for investigations, not proof of transmission.",
  };
}

// ── Weekly sitrep ─────────────────────────────────────────────────────

export async function getSitrep(opts: {
  ward?: string;
  asOf?: string | null;
}): Promise<{ markdown: string; windowStart: string; windowEnd: string; generatedAt: string; asOf: string | null; ward: string }> {
  const [overview, warnings, mdro] = await Promise.all([
    getOverview({ ward: opts.ward, asOf: opts.asOf ?? null }),
    getWarningFeed({ ward: opts.ward, asOf: opts.asOf }),
    getMdroFeed({ ward: opts.ward, asOf: opts.asOf }),
  ]);
  const fmt = (iso: string): string => iso.slice(0, 10);
  const lines: string[] = [];

  lines.push(`# AEI Pulse — resistance sitrep, ${overview.ward}`);
  lines.push(
    `Window ${fmt(overview.windowStart)} – ${fmt(overview.windowEnd)} (rolling 4 weeks) · generated ${fmt(overview.generatedAt)}${overview.asOf ? ` · HISTORICAL REPLAY as of ${fmt(overview.asOf)}` : ""}`,
  );
  lines.push("");
  lines.push("## Headline");
  const k = overview.kpis;
  lines.push(
    `- ${k.totalIsolates.value} first isolates (previous 4 weeks: ${k.totalIsolates.prevValue}, ${k.totalIsolates.delta > 0 ? "+" : ""}${k.totalIsolates.delta}%)`,
  );
  if (k.resistantPct)
    lines.push(
      `- ${k.resistantPct.value}% of isolates had ≥1 resistant result (prev ${k.resistantPct.prevValue}%, ${k.resistantPct.delta > 0 ? "+" : ""}${k.resistantPct.delta} pp)`,
    );
  if (k.mostCommonOrganism)
    lines.push(`- Most common organism: ${k.mostCommonOrganism.organism} (${k.mostCommonOrganism.sharePct}%)`);
  if (k.highestResistance)
    lines.push(
      `- Highest resistance: ${k.highestResistance.organism} — ${k.highestResistance.rPct}% to ${k.highestResistance.antibiotic} (n=${k.highestResistance.n})`,
    );
  lines.push("");
  lines.push("## Warnings under investigation");
  if (warnings.warnings.length === 0) {
    lines.push("- None this window (baseline false-alarm expectation: " + warnings.expectedPerMonth + "/month hospital-wide).");
  } else {
    for (const w of warnings.warnings.slice(0, 10)) {
      lines.push(`- **[${w.severity.toUpperCase()}] ${w.headline}** — ${w.evidence}`);
    }
    lines.push(
      `- Detection stack: proportion-drop (z, FDR) · count CUSUM · 14-day cluster scan · MDRO phenotype CUSUM. ${warnings.budget}`,
    );
  }
  lines.push("");
  lines.push("## MDRO / warning phenotypes");
  lines.push(
    `- ${mdro.mdroIsolates} of ${mdro.totalIsolates} isolates in window carried ≥1 warning phenotype (${mdro.totalIsolates > 0 ? Math.round((mdro.mdroIsolates / mdro.totalIsolates) * 1000) / 10 : 0}%)`,
  );
  for (const w of mdro.wards.slice(0, 5)) {
    lines.push(
      `- ${w.ward}: ${w.mdroCount}/${w.isolates} (${w.mdroPct ?? 0}%)` +
        (Object.keys(w.byClass).length > 0
          ? ` — ${Object.entries(w.byClass).map(([cls, n]) => `${cls} ${n}`).join(", ")}`
          : ""),
    );
  }
  lines.push("");
  lines.push("## Newest isolates (resistance findings)");
  for (const r of overview.recentIsolates.slice(0, 6)) {
    lines.push(
      `- ${fmt(r.date)} ${r.ward} ${r.organism}: ${r.resistant.length > 0 ? `R: ${r.resistant.join(", ")}` : `S: all tested (${r.susceptible.length})`}`,
    );
  }
  lines.push("");
  lines.push("## Method & safety");
  lines.push(
    "- Percentages from first isolates per patient per organism (EARS-Net); Wilson 95% CIs; cells with n<30 not reported.",
  );
  lines.push(
    "- All detections are statistical hypotheses for investigation. This is not a confirmed-outbreak declaration and not a treatment guideline; no patient-specific therapy decisions belong in this report.",
  );
  lines.push("- All data synthetic (Junction × Tyks challenge dataset).");

  return {
    ward: overview.ward,
    asOf: overview.asOf,
    windowStart: overview.windowStart,
    windowEnd: overview.windowEnd,
    generatedAt: overview.generatedAt,
    markdown: lines.join("\n"),
  };
}
