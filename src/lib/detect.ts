// ── Detection core (pure, DB-free) ────────────────────────────────────
//
// The early-warning detectors operate on in-memory isolate rows so the same
// code serves the live API, the backtesting harness and the alert-budget
// tuning. Two count-based detectors complement the existing proportion-drop
// z-test:
//
//   D2  count-cusum  — Poisson-style CUSUM on weekly first-isolate counts
//                      per (ward, organism); catches slow, sustained
//                      elevation that a 4-week proportion test averages away.
//   D3  cluster      — a 14-day scan window per (ward, organism) compared
//                      against the cell's own trailing 90-day rate with a
//                      Poisson tail; catches abrupt point-source spikes.
//
// Epidemiological honesty: these are statistical hypotheses. Molecular
// typing does not exist in this dataset, so "cluster" means "more same-
// species isolates in one place and time than the cell's own baseline
// predicts" — a candidate for investigation, never a confirmed outbreak.

export interface DetIsolate {
  id: string;
  patientId: string;
  organism: string;
  ward: string;
  sampleType: string;
  /** epoch ms */
  takenAt: number;
  /** antibiotic → "S" | "R" (intermediates dropped by the adapter) */
  results: Record<string, "S" | "R">;
}

export interface CusumFlag {
  ward: string;
  organism: string;
  /** full cell key the scan grouped by (e.g. ward|organism or ward|MDRO:class) */
  cell: string;
  /** ISO week start (Monday 00:00 UTC), ISO date */
  week: string;
  count: number;
  expected: number;
  cusum: number;
}

export interface ClusterFlag {
  ward: string;
  organism: string;
  /** scan window end, ISO date */
  windowEnd: string;
  observed: number;
  expected: number;
  p: number;
}

export interface DetectionConfig {
  /** CUSUM accumulation threshold */
  cusumH: number;
  /** cluster-scan Poisson p-value threshold */
  clusterP: number;
  /** cells with weekly mean below this never CUSUM (rare-event scans lower it) */
  minBaselineMean?: number;
  /** allowance in σ: accumulate counts above μ + kσ */
  kSigma?: number;
  /** floor for the weekly sd (1.5 default; rare-event scans lower it) */
  cusumSdFloor?: number;
  /** multiplier on cusumH for this scan (rare-event CUSUMs use <1) */
  hFactor?: number;
  /** absolute count allowance: accumulate c − (μ + kCount) instead of μ + kσ */
  kCount?: number;
  /** extra allowance proportional to the cell mean (used with kCount) */
  kCountScale?: number;
}

export const DEFAULT_DETECTION_CONFIG: DetectionConfig = { cusumH: 6, clusterP: 0.01 };

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

const cellOf = (row: DetIsolate): string => `${row.ward}|${row.organism}`;

/** Monday 00:00 UTC of the week containing `t`, epoch ms. */
export function weekStart(t: number): number {
  const d = new Date(t);
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return utc - dow * DAY_MS;
}

const isoDay = (t: number): string => new Date(t).toISOString().slice(0, 10);

// ── Poisson tail ──────────────────────────────────────────────────────

/** P(X ≥ k) for X ~ Poisson(λ). Normal approximation with continuity
 *  correction for large λ; exact iterated terms otherwise. */
export function poissonTail(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k <= 0) return 1;
  if (lambda > 30) {
    // normal approx, upper tail with continuity correction
    const z = (k - 0.5 - lambda) / Math.sqrt(lambda);
    return 1 - normalCdf(z);
  }
  // exact: 1 − CDF(k−1) via iterated pmf terms (stable, k is small here)
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let i = 1; i < k; i++) {
    term *= lambda / i;
    cdf += term;
  }
  return Math.min(1, Math.max(0, 1 - cdf));
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf approximation). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  const erf = z < 0 ? -poly : poly;
  return 0.5 * (1 + erf);
}

// ── D2: weekly CUSUM per (ward, organism) ─────────────────────────────

interface CellWeeks {
  key: string;
  ward: string;
  organism: string;
  weeks: number[]; // counts aligned to contiguous Mondays
  start: number; // first Monday epoch ms
}

export function weeklyCellCounts(
  rows: DetIsolate[],
  keyOf: (row: DetIsolate) => string = cellOf,
): Map<string, CellWeeks> {
  const cells = new Map<string, { ward: string; organism: string; byWeek: Map<number, number> }>();
  for (const row of rows) {
    const key = keyOf(row);
    let cell = cells.get(key);
    if (!cell) {
      cell = { ward: row.ward, organism: row.organism, byWeek: new Map() };
      cells.set(key, cell);
    }
    const wk = weekStart(row.takenAt);
    cell.byWeek.set(wk, (cell.byWeek.get(wk) ?? 0) + 1);
  }
  const out = new Map<string, CellWeeks>();
  for (const [key, cell] of cells) {
    const starts = [...cell.byWeek.keys()].sort((a, b) => a - b);
    const start = starts[0]!;
    const end = starts[starts.length - 1]!;
    const weeks: number[] = [];
    for (let t = start; t <= end; t += WEEK_MS) weeks.push(cell.byWeek.get(t) ?? 0);
    out.set(key, { key, ward: cell.ward, organism: cell.organism, weeks, start });
  }
  return out;
}

const BASELINE_WEEKS = 10; // window t−10 … t−3 (recent weeks excluded: contamination)
const RECENT_EXCLUDED = 2;
const MIN_BASELINE_MEAN = 0.5; // cells rarer than this never CUSUM — cluster scan covers spikes
const K_SIGMA = 2; // allowance: accumulate only counts above μ + 2σ

export function cusumScan(
  rows: DetIsolate[],
  config: DetectionConfig,
  /** cell key override — e.g. ward|MDRO-class for rare-event surveillance */
  keyOf: (row: DetIsolate) => string = cellOf,
): CusumFlag[] {
  const flags: CusumFlag[] = [];
  for (const cell of weeklyCellCounts(rows, keyOf).values()) {
    const { weeks } = cell;
    let s = 0;
    for (let t = 0; t < weeks.length; t++) {
      const from = Math.max(0, t - BASELINE_WEEKS);
      const to = t - RECENT_EXCLUDED; // exclusive
      if (to - from >= 4) {
        const window = weeks.slice(from, to);
        const mean = window.reduce((a, b) => a + b, 0) / window.length;
        const minMean = config.minBaselineMean ?? MIN_BASELINE_MEAN;
        // With an absolute count allowance (kCount), a μ=0 baseline is safe:
        // zeros decrement to 0 and spikes accumulate. Only the σ-scaled
        // allowance needs a warm baseline.
        if (mean >= minMean || config.kCount !== undefined) {
          const variance =
            window.reduce((a, b) => a + (b - mean) * (b - mean), 0) / window.length;
          const sd = Math.max(config.cusumSdFloor ?? 1.5, Math.sqrt(variance));
          const k =
            config.kCount !== undefined
              ? config.kCount + (config.kCountScale ?? 0) * mean
              : (config.kSigma ?? K_SIGMA);
          const h = config.cusumH * (config.hFactor ?? 1);
          s = Math.max(0, s + weeks[t]! - (mean + k));
          if (s >= h) {
            flags.push({
              ward: cell.ward,
              organism: cell.organism,
              cell: cell.key,
              week: isoDay(cell.start + t * WEEK_MS),
              count: weeks[t]!,
              expected: Math.round(mean * 10) / 10,
              cusum: Math.round(s * 10) / 10,
            });
            s = 0; // reset after a signal
          }
        } else {
          s = 0;
        }
      } else {
        s = 0;
      }
    }
  }
  return flags;
}

// ── D3: 14-day cluster scan vs the cell's own trailing rate ───────────

export interface ClusterConfig extends DetectionConfig {
  windowDays: number;
  baselineDays: number;
  minObserved: number;
  minExpected: number;
  /** scan the last N days as window ends */
  recentDays: number;
}

export const DEFAULT_CLUSTER_CONFIG: ClusterConfig = {
  ...DEFAULT_DETECTION_CONFIG,
  windowDays: 14,
  baselineDays: 90,
  minObserved: 3,
  minExpected: 0.5,
  recentDays: 10,
};

export function clusterScan(rows: DetIsolate[], config: ClusterConfig): ClusterFlag[] {
  if (rows.length === 0) return [];
  const dataMax = Math.max(...rows.map((r) => r.takenAt));
  const byCell = new Map<string, DetIsolate[]>();
  for (const row of rows) {
    const key = cellOf(row);
    const list = byCell.get(key);
    if (list) list.push(row);
    else byCell.set(key, [row]);
  }
  const flags: ClusterFlag[] = [];
  for (const cell of byCell.values()) {
    const days = cell.map((r) => Math.floor(r.takenAt / DAY_MS)).sort((a, b) => a - b);
    // Keep the worst (lowest-p) window per cell: overlapping windows dedupe.
    let best: ClusterFlag | null = null;
    for (let d = 0; d < config.recentDays; d++) {
      const endDay = Math.floor(dataMax / DAY_MS) - d;
      const winFrom = endDay - config.windowDays + 1;
      const baseFrom = winFrom - config.baselineDays;
      const observed = days.filter((x) => x >= winFrom && x <= endDay).length;
      if (observed < config.minObserved) continue;
      const baseline = days.filter((x) => x >= baseFrom && x < winFrom).length;
      const expected = Math.max(config.minExpected, (baseline / config.baselineDays) * config.windowDays);
      const p = poissonTail(expected, observed);
      if (p < config.clusterP && (!best || p < best.p)) {
        best = {
          ward: cell[0]!.ward,
          organism: cell[0]!.organism,
          windowEnd: isoDay(endDay * DAY_MS),
          observed,
          expected: Math.round(expected * 10) / 10,
          p,
        };
      }
    }
    if (best) flags.push(best);
  }
  return flags;
}

// ── D1: proportion-drop test (pure port of the stats-engine z-test) ───

/** Two-sided p-value for a z statistic (Abramowitz–Stegun erf approximation). */
export function normalTwoSidedP(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  const erf = x < 0 ? -poly : poly; // erf approximation magnitude `poly` for |x|
  const p = 1 - erf; // two-sided: 2·(1−Φ(|z|)) = 1 − erf(|z|/√2)
  return Math.min(1, Math.max(0, p));
}

/** Benjamini–Hochberg step-up adjusted p-values (FDR control); input order
 *  preserved. Returns values rounded to 4 decimals, capped at 1. */
export function benjaminiHochberg(ps: number[]): number[] {
  const m = ps.length;
  const order = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const out = new Array<number>(m).fill(1);
  let running = 1;
  for (let k = m; k >= 1; k--) {
    const entry = order[k - 1]!;
    running = Math.min(running, (entry.p * m) / k);
    out[entry.i] = Math.min(1, Math.round(running * 10_000) / 10_000);
  }
  return out;
}

export interface ProportionDropFlag {
  ward: string;
  organism: string;
  antibiotic: string;
  windowS: number;
  baselineS: number;
  dropPp: number;
  z: number;
  nWindow: number;
  nBaseline: number;
}

export interface ProportionConfig {
  zThreshold: number;
  dropPpThreshold: number;
  windowDays: number;
  baselineDays: number;
  minWindowN: number;
}

export const DEFAULT_PROPORTION_CONFIG: ProportionConfig = {
  // Raw gate z ≤ −3 paired with BH FDR across the scan: at z ≤ −2 the scan
  // fires constantly on ~35-isolate windows (measured 4+ FAs/month), while
  // genuine outbreaks land at z ≤ −5.
  zThreshold: 3,
  dropPpThreshold: 5,
  windowDays: 28,
  baselineDays: 365,
  minWindowN: 30,
};

function twoProportionZ(x1: number, n1: number, x2: number, n2: number): number {
  if (n1 === 0 || n2 === 0) return 0;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return 0;
  return (x1 / n1 - x2 / n2) / se;
}

/** %S drop per (ward, organism, antibiotic): rolling window vs trailing
 *  baseline, first isolate per (patient, organism) per period. Mirrors the
 *  DB-backed engine in stats.ts so the backtest exercises the same test. */
export function proportionDropScan(
  rows: DetIsolate[],
  config: ProportionConfig = DEFAULT_PROPORTION_CONFIG,
): ProportionDropFlag[] {
  if (rows.length === 0) return [];
  const dataMax = Math.max(...rows.map((r) => r.takenAt));
  const windowFrom = dataMax - config.windowDays * DAY_MS;
  const baselineFrom = dataMax - (config.windowDays + config.baselineDays) * DAY_MS;

  const dedupe = (pool: DetIsolate[]): DetIsolate[] => {
    const first = new Map<string, DetIsolate>();
    for (const row of [...pool].sort((a, b) => a.takenAt - b.takenAt || (a.id < b.id ? -1 : 1))) {
      const key = `${row.patientId}|${row.organism}`;
      if (!first.has(key)) first.set(key, row);
    }
    return [...first.values()];
  };

  const windowRows = dedupe(rows.filter((r) => r.takenAt >= windowFrom));
  const baselineRows = dedupe(rows.filter((r) => r.takenAt >= baselineFrom && r.takenAt < windowFrom));

  const tally = (pool: DetIsolate[]): Map<string, Map<string, { s: number; r: number }>> => {
    const out = new Map<string, Map<string, { s: number; r: number }>>();
    for (const row of pool) {
      const wardKey = row.ward;
      let byAb = out.get(wardKey);
      if (!byAb) out.set(wardKey, (byAb = new Map()));
      for (const [ab, result] of Object.entries(row.results)) {
        if (result !== "S" && result !== "R") continue;
        // organism rides on the row; key extends to organism below
        const cell = byAb.get(`${row.organism}|${ab}`) ?? { s: 0, r: 0 };
        if (result === "S") cell.s += 1;
        else cell.r += 1;
        byAb.set(`${row.organism}|${ab}`, cell);
      }
    }
    return out;
  };

  const windowTally = tally(windowRows);
  const baselineTally = tally(baselineRows);
  const flags: ProportionDropFlag[] = [];
  const pending: { flag: ProportionDropFlag; p: number }[] = [];
  for (const [ward, byCell] of windowTally) {
    const baselineByCell = baselineTally.get(ward);
    if (!baselineByCell) continue;
    for (const [cellKey, wc] of byCell) {
      const bc = baselineByCell.get(cellKey);
      if (!bc) continue;
      const nWindow = wc.s + wc.r;
      const nBaseline = bc.s + bc.r;
      if (nWindow < config.minWindowN || nBaseline === 0) continue;
      const windowS = (wc.s / nWindow) * 100;
      const baselineS = (bc.s / nBaseline) * 100;
      // z on SUSCEPTIBLE counts (drop in %S → negative z), matching stats.ts.
      const z = twoProportionZ(wc.s, nWindow, bc.s, nBaseline);
      const dropPp = baselineS - windowS;
      if (z > -config.zThreshold || dropPp < config.dropPpThreshold) continue;
      const [organism, antibiotic] = cellKey.split("|");
      pending.push({
        flag: {
          ward,
          organism: organism!,
          antibiotic: antibiotic!,
          windowS: Math.round(windowS * 10) / 10,
          baselineS: Math.round(baselineS * 10) / 10,
          dropPp: Math.round(dropPp * 10) / 10,
          z: Math.round(z * 100) / 100,
          nWindow,
          nBaseline,
        },
        p: normalTwoSidedP(z),
      });
    }
  }
  // Multiple-testing control: a scan tests every cell with n ≥ 30, so raw
  // z ≤ −2 fires constantly. Only FDR-significant cells (BH 5%) survive.
  const adjusted = benjaminiHochberg(pending.map((x) => x.p));
  pending.forEach((x, i) => {
    if (adjusted[i]! < 0.05) flags.push(x.flag);
  });
  return flags;
}


// ── Alert-budget tuning lives in backtest.ts (needs mdroCusumScan; kept
//    out of detect.ts to avoid a circular import).
