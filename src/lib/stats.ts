// ── Surveillance stats engine ────────────────────────────────────────
//
// Methodology (EARS-Net style):
// - First-isolate dedupe: within a period, only the FIRST isolate per
//   (patient, organism) counts (earliest takenAt, isolate id as tie-break).
//   Rolling "4w" = last ROLLING_DAYS days ending at the latest culture in the
//   data; annual "1y" = the calendar year of the latest culture in the data.
// - Cell metric = % susceptible S/(S+R) × 100; "I" results are ignored.
// - Wilson score 95% CI on the proportion.
// - Signals: pooled two-proportion z-test of the rolling window vs the
//   BASELINE_DAYS trailing before the window start; flagged when
//   z <= -2 AND drop >= 5 percentage points.
// Results are cached in memory keyed by the latest culture timestamp, so
// reseeds invalidate the cache automatically.

import { Prisma } from "@prisma/client";

import { db } from "./db";
import {
  AntibiogramResponse,
  BASELINE_DAYS,
  MetaResponse,
  MIN_ISOLATES,
  OrganismRow,
  ROLLING_DAYS,
  Signal,
  SignalsResponse,
  SusCell,
  TrendPoint,
  TrendResponse,
  WindowKey,
} from "./types";

export { BASELINE_DAYS, MIN_ISOLATES, ROLLING_DAYS };

const DAY_MS = 86_400_000;
const Z95 = 1.959963984540054;
const TREND_MONTHS = 24;

/** Sentinel ward value meaning "no ward filter" (hospital-wide). */
export const ALL_WARDS = "All wards";

// ── Math helpers ─────────────────────────────────────────────────────

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Wilson score 95% CI on a binomial proportion, in percent. */
function wilsonPct(successes: number, n: number): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 0 };
  const p = successes / n;
  const z2 = Z95 * Z95;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (Z95 / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { lo: Math.max(0, center - half) * 100, hi: Math.min(1, center + half) * 100 };
}

/** Pooled two-proportion z-test: x1/n1 (window) vs x2/n2 (baseline). */
function twoProportionZ(x1: number, n1: number, x2: number, n2: number): number {
  if (n1 === 0 || n2 === 0) return 0;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return 0;
  return (x1 / n1 - x2 / n2) / se;
}

// ── Window & filter helpers ──────────────────────────────────────────

export interface WindowRange {
  start: Date;
  end: Date;
}

/** Resolve a window key to [start, end], anchored at the latest culture in the data. */
export function windowRange(window: WindowKey, dataMax: Date | null): WindowRange {
  const end = dataMax ?? new Date();
  if (window === "4w") return { start: new Date(end.getTime() - ROLLING_DAYS * DAY_MS), end };
  // "1y": current calendar year (UTC) of the latest data.
  return { start: new Date(Date.UTC(end.getUTCFullYear(), 0, 1)), end };
}

function cultureWhere(ward?: string, sampleType?: string | null): Prisma.CultureWhereInput {
  const w = ward && ward !== ALL_WARDS ? ward : undefined;
  return {
    ...(w ? { ward: w } : {}),
    ...(sampleType ? { sampleType } : {}),
  };
}

// ── Row fetchers (pull minimal joined rows, aggregate in JS) ─────────

interface IsoRec {
  id: string;
  organism: string;
  patientId: string;
  ward: string;
  takenAt: Date;
}

interface SusRec {
  isolateId: string;
  organism: string;
  antibiotic: string;
  result: string;
}

async function fetchIsolates(
  start: Date,
  end: Date,
  endExclusive: boolean,
  ward?: string,
  sampleType?: string | null,
): Promise<IsoRec[]> {
  const rows = await db.isolate.findMany({
    where: {
      culture: {
        ...cultureWhere(ward, sampleType),
        takenAt: endExclusive ? { gte: start, lt: end } : { gte: start, lte: end },
      },
    },
    select: {
      id: true,
      organism: true,
      culture: { select: { patientId: true, ward: true, takenAt: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    organism: r.organism,
    patientId: r.culture.patientId,
    ward: r.culture.ward,
    takenAt: r.culture.takenAt,
  }));
}

async function fetchSusceptibilities(
  start: Date,
  end: Date,
  endExclusive: boolean,
  ward?: string,
  sampleType?: string | null,
): Promise<SusRec[]> {
  const rows = await db.susceptibility.findMany({
    where: {
      isolate: {
        culture: {
          ...cultureWhere(ward, sampleType),
          takenAt: endExclusive ? { gte: start, lt: end } : { gte: start, lte: end },
        },
      },
    },
    select: {
      isolateId: true,
      antibiotic: true,
      result: true,
      isolate: { select: { organism: true } },
    },
  });
  return rows.map((r) => ({
    isolateId: r.isolateId,
    organism: r.isolate.organism,
    antibiotic: r.antibiotic,
    result: r.result,
  }));
}

// ── Dedupe & tally ───────────────────────────────────────────────────

/** First isolate per (patient, organism) — earliest takenAt wins, isolate id breaks ties. */
function firstIsolates(isolates: IsoRec[]): IsoRec[] {
  const first = new Map<string, IsoRec>();
  for (const iso of [...isolates].sort(
    (a, b) => a.takenAt.getTime() - b.takenAt.getTime() || (a.id < b.id ? -1 : 1),
  )) {
    const key = `${iso.patientId}|${iso.organism}`;
    if (!first.has(key)) first.set(key, iso);
  }
  return [...first.values()];
}

type Tally = Map<string, Map<string, { s: number; r: number }>>;

/** Count S/R results per (organism, antibiotic) over isolates in `ids`; "I" is ignored. */
function tallySusceptibilities(rows: SusRec[], ids: Set<string>): Tally {
  const tally: Tally = new Map();
  for (const row of rows) {
    if (!ids.has(row.isolateId)) continue;
    if (row.result !== "S" && row.result !== "R") continue;
    let byAntibiotic = tally.get(row.organism);
    if (!byAntibiotic) tally.set(row.organism, (byAntibiotic = new Map()));
    const cell = byAntibiotic.get(row.antibiotic) ?? { s: 0, r: 0 };
    if (row.result === "S") cell.s += 1;
    else cell.r += 1;
    byAntibiotic.set(row.antibiotic, cell);
  }
  return tally;
}

// ── DB listing helpers (memoized: dataset is static between reseeds) ─

function memoize<T>(fn: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => {
    if (!cached) {
      cached = fn().catch((err) => {
        cached = null; // never pin a failed lookup
        throw err;
      });
    }
    return cached;
  };
}

const maxTakenAt = memoize(async () => {
  const agg = await db.culture.aggregate({ _max: { takenAt: true } });
  return agg._max.takenAt;
});

const distinctWards = memoize(async () => {
  const rows = await db.culture.findMany({
    distinct: ["ward"],
    select: { ward: true },
    orderBy: { ward: "asc" },
  });
  return rows.map((r) => r.ward);
});

const distinctOrganisms = memoize(async () => {
  const rows = await db.isolate.findMany({
    distinct: ["organism"],
    select: { organism: true },
    orderBy: { organism: "asc" },
  });
  return rows.map((r) => r.organism);
});

/** Fixed antibiotic order used by both meta and antibiogram cell ordering. */
const distinctAntibiotics = memoize(async () => {
  const rows = await db.susceptibility.findMany({
    distinct: ["antibiotic"],
    select: { antibiotic: true },
    orderBy: { antibiotic: "asc" },
  });
  return rows.map((r) => r.antibiotic);
});

const distinctSampleTypes = memoize(async () => {
  const rows = await db.culture.findMany({
    distinct: ["sampleType"],
    select: { sampleType: true },
    orderBy: { sampleType: "asc" },
  });
  return rows.map((r) => r.sampleType);
});

// ── Result cache ─────────────────────────────────────────────────────
// Public results are keyed by the latest culture timestamp (one cheap
// memoized aggregate) plus the JSON of the args: identical requests share
// one cached promise (concurrent calls dedupe), and a reseed — which moves
// the latest timestamp — invalidates every entry without a restart.

let cacheDataMaxIso = "";
const resultCache = new Map<string, Promise<unknown>>();

async function cachedByDataMax<T>(args: unknown, compute: () => Promise<T>): Promise<T> {
  const dataMaxIso = (await maxTakenAt())?.toISOString() ?? "";
  if (dataMaxIso !== cacheDataMaxIso) {
    resultCache.clear();
    cacheDataMaxIso = dataMaxIso;
  }
  const key = `${dataMaxIso}|${JSON.stringify(args)}`;
  const hit = resultCache.get(key);
  if (hit) return hit as Promise<T>;
  const promise = compute().catch((err) => {
    resultCache.delete(key); // failures must not stay cached
    throw err;
  });
  resultCache.set(key, promise);
  return promise;
}

// ── Public API ───────────────────────────────────────────────────────

export async function getMeta(): Promise<MetaResponse> {
  return cachedByDataMax(null, computeMeta);
}

async function computeMeta(): Promise<MetaResponse> {
  const [wards, sampleTypes, organisms, antibiotics, dates] = await Promise.all([
    distinctWards(),
    distinctSampleTypes(),
    distinctOrganisms(),
    distinctAntibiotics(),
    db.culture.aggregate({ _min: { takenAt: true }, _max: { takenAt: true } }),
  ]);
  return {
    wards,
    organisms,
    antibiotics,
    sampleTypes,
    dateMin: dates._min.takenAt ? dates._min.takenAt.toISOString() : "",
    dateMax: dates._max.takenAt ? dates._max.takenAt.toISOString() : "",
    generatedAt: new Date().toISOString(),
  };
}

export async function getAntibiogram(opts: {
  ward?: string;
  sampleType?: string | null;
  window: WindowKey;
}): Promise<AntibiogramResponse> {
  return cachedByDataMax(opts, () => computeAntibiogram(opts));
}

async function computeAntibiogram(opts: {
  ward?: string;
  sampleType?: string | null;
  window: WindowKey;
}): Promise<AntibiogramResponse> {
  const dataMax = await maxTakenAt();
  const { start, end } = windowRange(opts.window, dataMax);
  const [isolates, susRows, antibioticOrder] = await Promise.all([
    fetchIsolates(start, end, false, opts.ward, opts.sampleType),
    fetchSusceptibilities(start, end, false, opts.ward, opts.sampleType),
    distinctAntibiotics(),
  ]);

  const firstIso = firstIsolates(isolates);
  const firstIds = new Set(firstIso.map((i) => i.id));

  const nByOrganism = new Map<string, number>();
  for (const iso of firstIso) {
    nByOrganism.set(iso.organism, (nByOrganism.get(iso.organism) ?? 0) + 1);
  }
  const cellsByOrganism = tallySusceptibilities(susRows, firstIds);

  // Fixed antibiotic order from meta; rows sorted by n desc.
  const abRank = new Map(antibioticOrder.map((ab, i) => [ab, i]));

  const rows: OrganismRow[] = [...nByOrganism.entries()]
    .sort(
      ([orgA, nA], [orgB, nB]) =>
        nB - nA || (orgA < orgB ? -1 : orgA > orgB ? 1 : 0),
    )
    .map(([organism, n]) => {
      const byAntibiotic = cellsByOrganism.get(organism);
      const cells: SusCell[] = (byAntibiotic ? [...byAntibiotic.entries()] : [])
        .filter(([, cell]) => cell.s + cell.r > 0)
        .sort(
          ([abA], [abB]) =>
            (abRank.get(abA) ?? antibioticOrder.length) -
              (abRank.get(abB) ?? antibioticOrder.length) ||
            (abA < abB ? -1 : abA > abB ? 1 : 0),
        )
        .map(([antibiotic, cell]) => {
          const nCell = cell.s + cell.r;
          const { lo, hi } = wilsonPct(cell.s, nCell);
          return {
            antibiotic,
            sPct: round1((cell.s / nCell) * 100),
            n: nCell,
            ciLo: round1(lo),
            ciHi: round1(hi),
            sufficient: nCell >= MIN_ISOLATES,
          };
        });
      return { organism, n, cells };
    });

  return {
    ward: opts.ward || ALL_WARDS,
    sampleType: opts.sampleType || null,
    window: opts.window,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    generatedAt: new Date().toISOString(),
    rows,
  };
}

export async function getSignals(opts: { ward?: string } = {}): Promise<SignalsResponse> {
  return cachedByDataMax(opts, () => computeSignals(opts));
}

async function computeSignals(opts: { ward?: string }): Promise<SignalsResponse> {
  const scope = opts.ward && opts.ward !== ALL_WARDS ? opts.ward : undefined;
  const dataMax = await maxTakenAt();
  const { start: windowStart, end: windowEnd } = windowRange("4w", dataMax);
  const baselineStart = new Date(windowStart.getTime() - BASELINE_DAYS * DAY_MS);

  // One range query per table covering window + baseline; partition in JS.
  const [isolates, susRows, wards] = await Promise.all([
    fetchIsolates(baselineStart, windowEnd, false),
    fetchSusceptibilities(baselineStart, windowEnd, false),
    scope ? Promise.resolve([scope]) : distinctWards(),
  ]);
  // Per-ward cells, plus hospital-wide when scanning the whole hospital.
  const scopes = scope ? [scope] : [...wards, ALL_WARDS];

  const signals: Signal[] = [];
  let scanned = 0;

  for (const scopeWard of scopes) {
    const hospitalWide = scopeWard === ALL_WARDS;
    const scopeIsolates = hospitalWide ? isolates : isolates.filter((i) => i.ward === scopeWard);
    const windowIso = firstIsolates(scopeIsolates.filter((i) => i.takenAt >= windowStart));
    const baselineIso = firstIsolates(scopeIsolates.filter((i) => i.takenAt < windowStart));
    const windowTally = tallySusceptibilities(susRows, new Set(windowIso.map((i) => i.id)));
    const baselineTally = tallySusceptibilities(susRows, new Set(baselineIso.map((i) => i.id)));

    const organisms = new Set([...windowTally.keys(), ...baselineTally.keys()]);
    for (const organism of organisms) {
      const windowByAb = windowTally.get(organism);
      const baselineByAb = baselineTally.get(organism);
      const antibiotics = new Set([
        ...(windowByAb?.keys() ?? []),
        ...(baselineByAb?.keys() ?? []),
      ]);
      for (const antibiotic of antibiotics) {
        scanned += 1;
        const wc = windowByAb?.get(antibiotic);
        const bc = baselineByAb?.get(antibiotic);
        if (!wc || !bc) continue; // both proportions needed for the z-test
        const nWindow = wc.s + wc.r;
        const nBaseline = bc.s + bc.r;
        if (nWindow < MIN_ISOLATES || nBaseline === 0) continue;
        const windowS = (wc.s / nWindow) * 100;
        const baselineS = (bc.s / nBaseline) * 100;
        const z = twoProportionZ(wc.s, nWindow, bc.s, nBaseline);
        const dropPp = baselineS - windowS;
        if (z > -2 || dropPp < 5) continue; // flag threshold
        signals.push({
          id: `${scopeWard}|${organism}|${antibiotic}`,
          ward: scopeWard,
          organism,
          antibiotic,
          sampleType: null,
          windowS: round1(windowS),
          baselineS: round1(baselineS),
          dropPp: round1(dropPp),
          z: Math.round(z * 100) / 100,
          nWindow,
          nBaseline,
          severity:
            z <= -4 || dropPp >= 15 ? "high" : z <= -3 || dropPp >= 10 ? "moderate" : "watch",
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
        });
      }
    }
  }

  const severityRank: Record<Signal["severity"], number> = { high: 0, moderate: 1, watch: 2 };
  signals.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      Math.abs(b.z) - Math.abs(a.z) ||
      b.dropPp - a.dropPp ||
      (a.id < b.id ? -1 : 1),
  );

  return { signals, scanned, generatedAt: new Date().toISOString() };
}

export async function getTrend(opts: {
  ward?: string;
  organism: string;
  antibiotic: string;
  sampleType?: string | null;
}): Promise<TrendResponse> {
  return cachedByDataMax(opts, () => computeTrend(opts));
}

async function computeTrend(opts: {
  ward?: string;
  organism: string;
  antibiotic: string;
  sampleType?: string | null;
}): Promise<TrendResponse> {
  const { organism, antibiotic } = opts;
  const anchor = (await maxTakenAt()) ?? new Date();
  const firstMonth = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - (TREND_MONTHS - 1), 1),
  );

  const [isolates, susRows] = await Promise.all([
    db.isolate.findMany({
      where: {
        organism,
        culture: { ...cultureWhere(opts.ward, opts.sampleType), takenAt: { gte: firstMonth } },
      },
      select: { id: true, culture: { select: { patientId: true, takenAt: true } } },
    }),
    db.susceptibility.findMany({
      where: {
        antibiotic,
        isolate: {
          organism,
          culture: { ...cultureWhere(opts.ward, opts.sampleType), takenAt: { gte: firstMonth } },
        },
      },
      select: { isolateId: true, result: true },
    }),
  ]);

  // First isolate per (patient, organism) per month bucket.
  const seen = new Set<string>(); // `${patientId}|${monthIndex}`
  const monthById = new Map<string, number>(); // isolateId → monthIndex
  for (const iso of [...isolates].sort(
    (a, b) =>
      a.culture.takenAt.getTime() - b.culture.takenAt.getTime() || (a.id < b.id ? -1 : 1),
  )) {
    const takenAt = iso.culture.takenAt;
    const m =
      (takenAt.getUTCFullYear() - firstMonth.getUTCFullYear()) * 12 +
      (takenAt.getUTCMonth() - firstMonth.getUTCMonth());
    if (m < 0 || m >= TREND_MONTHS) continue;
    const key = `${iso.culture.patientId}|${m}`;
    if (seen.has(key)) continue;
    seen.add(key);
    monthById.set(iso.id, m);
  }

  const byMonth = new Map<number, { s: number; r: number }>();
  for (const row of susRows) {
    const m = monthById.get(row.isolateId);
    if (m === undefined) continue;
    if (row.result !== "S" && row.result !== "R") continue;
    const cell = byMonth.get(m) ?? { s: 0, r: 0 };
    if (row.result === "S") cell.s += 1;
    else cell.r += 1;
    byMonth.set(m, cell);
  }

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const points: TrendPoint[] = [];
  for (let m = 0; m < TREND_MONTHS; m++) {
    const d = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + m, 1));
    const cell = byMonth.get(m) ?? { s: 0, r: 0 };
    const n = cell.s + cell.r;
    points.push({
      month: d.toISOString().slice(0, 10),
      label: `${monthNames[d.getUTCMonth()]} ${String(d.getUTCFullYear() % 100).padStart(2, "0")}`,
      sPct: n > 0 ? round1((cell.s / n) * 100) : 0,
      n,
    });
  }

  return {
    ward: opts.ward || ALL_WARDS,
    organism,
    antibiotic,
    sampleType: opts.sampleType || null,
    points,
  };
}
