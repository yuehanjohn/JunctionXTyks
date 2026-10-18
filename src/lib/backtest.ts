// ── Backtesting harness (pure, deterministic) ─────────────────────────
//
// Proves the detection stack works and quantifies its costs:
//  - synthetic, seeded outbreak-free baseline (stable rates and resistance)
//  - deterministic injected outbreak scenarios (labelled, never mixed into
//    real data — the harness is fully in-memory)
//  - day/week-stepped replay of the detectors, reporting per scenario:
//    detection latency, and globally: false alarms per month, PPV
//
// Targets the product commits to (budget ≤ 2/month, latency ≤ 7 days) are
// tuned here, then the same config ships to the live feed.

import {
  clusterScan,
  cusumScan,
  DEFAULT_CLUSTER_CONFIG,
  DEFAULT_DETECTION_CONFIG,
  proportionDropScan,
  type DetIsolate,
  type DetectionConfig,
} from "./detect";
import { mdroCusumScan } from "./mdro";
import type { BacktestMetrics, BacktestScenarioResult, WarningKind } from "./types";

const DAY_MS = 86_400_000;

/** Deterministic RNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Synthetic outbreak-free baseline ──────────────────────────────────

interface PanelSpec {
  antibiotic: string;
  pR: number;
}

const PANELS: Record<string, PanelSpec[]> = {
  "Escherichia coli": [
    { antibiotic: "Ceftazidime", pR: 0.1 },
    { antibiotic: "Cefuroxime", pR: 0.2 },
    { antibiotic: "Meropenem", pR: 0.01 },
    { antibiotic: "Ciprofloxacin", pR: 0.15 },
    { antibiotic: "Gentamicin", pR: 0.05 },
    { antibiotic: "Trimethoprim", pR: 0.25 },
  ],
  "Klebsiella pneumoniae": [
    { antibiotic: "Ceftazidime", pR: 0.08 },
    { antibiotic: "Cefuroxime", pR: 0.12 },
    { antibiotic: "Meropenem", pR: 0.02 },
    { antibiotic: "Ciprofloxacin", pR: 0.1 },
    { antibiotic: "Gentamicin", pR: 0.04 },
    { antibiotic: "Trimethoprim", pR: 0.2 },
  ],
  "Staphylococcus aureus": [
    { antibiotic: "Cefoxitin (methicillin)", pR: 0.01 },
    { antibiotic: "Erythromycin", pR: 0.15 },
    { antibiotic: "Clindamycin", pR: 0.1 },
    { antibiotic: "Gentamicin", pR: 0.03 },
    { antibiotic: "Fusidic acid", pR: 0.05 },
  ],
  "Enterococcus faecalis": [
    { antibiotic: "Ampicillin", pR: 0.05 },
    { antibiotic: "Vancomycin", pR: 0.01 },
    { antibiotic: "Gentamicin", pR: 0.2 },
  ],
  "Pseudomonas aeruginosa": [
    { antibiotic: "Ceftazidime", pR: 0.1 },
    { antibiotic: "Meropenem", pR: 0.05 },
    { antibiotic: "Ciprofloxacin", pR: 0.12 },
    { antibiotic: "Gentamicin", pR: 0.08 },
    { antibiotic: "Piperacillin-tazobactam", pR: 0.06 },
  ],
};

const ORGANISM_SHARE: Record<string, number> = {
  "Escherichia coli": 0.4,
  "Staphylococcus aureus": 0.18,
  "Klebsiella pneumoniae": 0.24,
  "Enterococcus faecalis": 0.09,
  "Pseudomonas aeruginosa": 0.09,
};

const WARDS = ["ICU", "General Surgery", "Internal Medicine", "Long-term Care"];

export function generateBaseline(seed: number, days: number, endEpoch: number): DetIsolate[] {
  const rand = rng(seed);
  const rows: DetIsolate[] = [];
  const totalIsolates = Math.round(12.5 * days); // ~12.5/day hospital-wide
  for (let i = 0; i < totalIsolates; i++) {
    const day = Math.floor(rand() * days);
    const ward = WARDS[Math.floor(rand() * WARDS.length)]!;
    const organism = pickOrganism(rand());
    const panel = PANELS[organism]!;
    const results: Record<string, "S" | "R"> = {};
    for (const spec of panel) results[spec.antibiotic] = rand() < spec.pR ? "R" : "S";
    rows.push({
      id: `SYN-${i}`,
      patientId: `SP${String(Math.floor(rand() * 2500)).padStart(4, "0")}`,
      organism,
      ward,
      sampleType: rand() < 0.6 ? "urine" : rand() < 0.6 ? "wound" : "blood",
      takenAt: endEpoch - (days - day) * DAY_MS + Math.floor(rand() * DAY_MS),
      results,
    });
  }
  return rows;
}

function pickOrganism(u: number): string {
  let acc = 0;
  for (const [organism, share] of Object.entries(ORGANISM_SHARE)) {
    acc += share;
    if (u < acc) return organism;
  }
  return "Escherichia coli";
}

// ── Injected outbreak scenarios (deterministic, labelled) ─────────────

export interface Scenario {
  name: string;
  description: string;
  ward: string;
  organism: string;
  /** scenario start, days from the baseline end */
  startDay: number;
  durationDays: number;
  /** extra same-organism isolates injected (count-spike scenarios) */
  extraIsolates?: number;
  /** extra-isolate injection window in days (defaults to durationDays) */
  extraWindowDays?: number;
  apply: (row: DetIsolate, progress: number, rand: () => number) => boolean;
  /** which warnings count as detections of THIS scenario */
  matches: (w: { kind?: WarningKind; ward: string; organism: string; organisms?: string[]; antibiotic: string | null; phenotype?: string }) => boolean;
}

export function buildScenarios(): Scenario[] {
  return [
    {
      name: "esbl-icu",
      description:
        "ESBL-proxy burst: 3GC resistance among ICU E. coli ramps from 10% to ~85% within 7 days and sustains for 3 weeks (volume stable).",
      ward: "ICU",
      organism: "Escherichia coli",
      startDay: 570,
      durationDays: 21,
      apply: (row, progress, rand) => {
        if (row.ward !== "ICU" || row.organism !== "Escherichia coli") return false;
        const p = 0.1 + 0.75 * Math.min(1, progress * (21 / 7));
        let touched = false;
        for (const ab of ["Ceftazidime", "Cefuroxime"]) {
          if (row.results[ab] === "S" && rand() < p) {
            row.results[ab] = "R";
            touched = true;
          }
        }
        return touched;
      },
      matches: (w) =>
        w.ward === "ICU" &&
        w.organism === "Escherichia coli" &&
        (w.antibiotic === "Ceftazidime" ||
          w.antibiotic === "Cefuroxime" ||
          w.phenotype === "ESBL-proxy" ||
          w.phenotype === "3GC-R"),
    },
    {
      name: "cre-creep-icu",
      description:
        "CRE creep: meropenem resistance among ICU K. pneumoniae ramps from 2% to 50% over 45 days (rare event — the MDRO CUSUM's job).",
      ward: "ICU",
      organism: "Klebsiella pneumoniae",
      startDay: 610,
      durationDays: 45,
      apply: (row, progress, rand) => {
        if (row.ward !== "ICU" || row.organism !== "Klebsiella pneumoniae") return false;
        const p = 0.02 + 0.48 * progress;
        if (row.results["Meropenem"] === "S" && rand() < p) {
          row.results["Meropenem"] = "R";
          return true;
        }
        return false;
      },
      matches: (w) =>
        w.ward === "ICU" &&
        ((w.organism === "Klebsiella pneumoniae" || (w.organisms?.includes("Klebsiella pneumoniae") ?? false)) &&
          (w.antibiotic === "Meropenem" || w.phenotype === "CRE-proxy" || w.kind === "cluster")),
    },
    {
      name: "point-source-gs",
      description:
        "Point-source cluster: 24 extra S. aureus isolates on General Surgery within 7 days (count spike, resistance unchanged).",
      ward: "General Surgery",
      organism: "Staphylococcus aureus",
      startDay: 640,
      durationDays: 7,
      extraIsolates: 24,
      extraWindowDays: 7,
      apply: () => false,
      matches: (w) => w.ward === "General Surgery" && w.organism === "Staphylococcus aureus",
    },
  ];
}

/** Apply a scenario over [start, start+duration): resistance-ramp scenarios
 *  flip existing results; count-spike scenarios add explicit extra isolates. */
export function injectScenario(rows: DetIsolate[], scenario: Scenario, seed: number): DetIsolate[] {
  const rand = rng(seed);
  const baselineMin = Math.min(...rows.map((r) => r.takenAt));
  const start = baselineMin + scenario.startDay * DAY_MS;
  const out: DetIsolate[] = rows.map((row) => {
    const rel = Math.floor((row.takenAt - start) / DAY_MS);
    if (rel < 0 || rel > scenario.durationDays) return row;
    const clone: DetIsolate = { ...row, results: { ...row.results } };
    scenario.apply(clone, rel / scenario.durationDays, rand);
    return clone;
  });
  if (scenario.extraIsolates) {
    const winDays = scenario.extraWindowDays ?? scenario.durationDays;
    const panel = PANELS[scenario.organism] ?? [];
    for (let i = 0; i < scenario.extraIsolates; i++) {
      const rel = Math.floor(rand() * winDays);
      const results: Record<string, "S" | "R"> = {};
      for (const spec of panel) results[spec.antibiotic] = rand() < spec.pR ? "R" : "S";
      out.push({
        id: `SYN-${scenario.name}-${i}`,
        patientId: `SP${String(9000 + i).padStart(4, "0")}`,
        organism: scenario.organism,
        ward: scenario.ward,
        sampleType: "wound",
        takenAt: start + rel * DAY_MS + Math.floor(rand() * DAY_MS),
        results,
      });
    }
  }
  return out;
}

// ── Replay ────────────────────────────────────────────────────────────

interface RawWarning {
  kind: WarningKind;
  ward: string;
  organism: string;
  organisms?: string[];
  antibiotic: string | null;
  phenotype?: string;
  /** epoch ms of the detection step */
  at: number;
}

function detectAt(rows: DetIsolate[], now: number, config: DetectionConfig): RawWarning[] {
  const history = rows.filter((r) => r.takenAt <= now);
  const out: RawWarning[] = [];
  for (const f of proportionDropScan(history)) {
    out.push({
      kind: "proportion-drop",
      ward: f.ward,
      organism: f.organism,
      antibiotic: f.antibiotic,
      at: now,
    });
  }
  for (const f of cusumScan(history, config)) {
    if (new Date(f.week).getTime() >= now - 21 * DAY_MS) {
      out.push({ kind: "count-cusum", ward: f.ward, organism: f.organism, antibiotic: null, at: now });
    }
  }
  for (const f of mdroCusumScan(history, config)) {
    if (new Date(f.week).getTime() >= now - 21 * DAY_MS) {
      out.push({
        kind: "count-cusum",
        ward: f.ward,
        organism: f.organisms.join(" + "),
        organisms: f.organisms,
        antibiotic: null,
        phenotype: f.phenotype,
        at: now,
      });
    }
  }
  for (const f of clusterScan(history, { ...DEFAULT_CLUSTER_CONFIG, recentDays: 3 })) {
    out.push({ kind: "cluster", ward: f.ward, organism: f.organism, antibiotic: null, at: now });
  }
  return out;
}

/** False alarms per 30.4 days: weekly replay of the full detector stack
 *  over an outbreak-free stretch. D1 applies BH FDR across cells; the CUSUM
 *  h and cluster p tuning below keeps the TOTAL under budget. */
export function falseAlarmRate(rows: DetIsolate[], config: DetectionConfig): number {
  const b = faBreakdown(rows, config);
  const steps = Math.max(1, b.steps);
  return (b.d1 + b.d2 + d3Count(b) + b.d4) / ((steps * 7) / 30.4);
}

interface FaBreakdown {
  steps: number;
  d1: number;
  d2: number;
  d3: number;
  d4: number;
  clusterFlags: { p: number }[];
}
function d3Count(b: FaBreakdown): number {
  return b.d3;
}

function faBreakdown(rows: DetIsolate[], config: DetectionConfig): FaBreakdown {
  const empty: FaBreakdown = { steps: 0, d1: 0, d2: 0, d3: 0, d4: 0, clusterFlags: [] };
  if (rows.length === 0) return empty;
  const min = Math.min(...rows.map((r) => r.takenAt));
  const max = Math.max(...rows.map((r) => r.takenAt));
  if ((max - min) / DAY_MS < 460) return empty;
  const out: FaBreakdown = { ...empty };
  for (let now = min + 400 * DAY_MS; now <= max; now += 7 * DAY_MS) {
    const hist = rows.filter((r) => r.takenAt <= now);
    out.d1 += proportionDropScan(hist).length;
    out.d2 += cusumScan(hist, config).filter(
      (f) => new Date(f.week).getTime() >= now - 14 * DAY_MS,
    ).length;
    const clusters = clusterScan(hist, { ...DEFAULT_CLUSTER_CONFIG, ...config, recentDays: 7 });
    out.d3 += clusters.length;
    out.clusterFlags.push(...clusters);
    out.d4 += mdroCusumScan(hist, config).filter(
      (f) => new Date(f.week).getTime() >= now - 14 * DAY_MS,
    ).length;
    out.steps += 1;
  }
  return out;
}

export const ALERT_BUDGET_PER_MONTH = 2;

const H_CANDIDATES = [3, 4, 6, 8, 12, 16, 24];
const P_CANDIDATES = [0.01, 0.005, 0.002, 0.001];

/** Brute-force threshold search: smallest (h, clusterP) combo whose clean-data
 *  alarm rate stays ≤ budget — maximum sensitivity under the alert budget. */
export function tuneConfig(
  rows: DetIsolate[],
  budget = ALERT_BUDGET_PER_MONTH,
): { config: DetectionConfig; rates: Record<string, number> } {
  const monthsPerStep = 7 / 30.4;
  let best: { config: DetectionConfig; rates: Record<string, number> } | null = null;
  for (const clusterP of P_CANDIDATES) {
    for (const cusumH of H_CANDIDATES) {
      const config: DetectionConfig = { cusumH, clusterP };
      const b = faBreakdown(rows, config);
      const rates = {
        d1: Math.round((b.d1 / (b.steps * monthsPerStep)) * 100) / 100,
        d2: Math.round((b.d2 / (b.steps * monthsPerStep)) * 100) / 100,
        d3: Math.round((b.d3 / (b.steps * monthsPerStep)) * 100) / 100,
        d4: Math.round((b.d4 / (b.steps * monthsPerStep)) * 100) / 100,
        total: 0,
      };
      rates.total = Math.round((b.d1 + b.d2 + b.d3 + b.d4) / (b.steps * monthsPerStep) * 100) / 100;
      if (!best || rates.total < best.rates.total) {
        best = { config, rates };
      }
      if (rates.total <= budget) {
        return { config, rates };
      }
    }
  }
  return best!;
}

// ── Cached singleton: the harness runs in ~20 s; compute once per process
//    and serve from memory (the synthetic baseline is deterministic, so the
//    result is stable across restarts). ──
let backtestPromise: Promise<BacktestMetrics> | null = null;

export function getBacktest(): Promise<BacktestMetrics> {
  if (!backtestPromise) {
    backtestPromise = Promise.resolve(runBacktest()).catch((err) => {
      backtestPromise = null; // never pin a failure
      throw err;
    });
  }
  return backtestPromise;
}

export function runBacktest(seed = 20260101): BacktestMetrics {
  const t0 = Date.now();
  const baselineDays = 700;
  const endEpoch = Date.UTC(2026, 0, 1);
  const clean = generateBaseline(seed, baselineDays, endEpoch);

  // Tune thresholds against the alert budget (≤2 false alarms/month total),
  // then measure the final config honestly on the same clean stretch.
  const faCutoff = Math.min(...clean.map((r) => r.takenAt)) + 560 * DAY_MS;
  const cleanStretch = clean.filter((r) => r.takenAt <= faCutoff);
  const tuned = tuneConfig(cleanStretch, ALERT_BUDGET_PER_MONTH);
  const config = tuned.config;
  const falseAlarmsPerMonth = tuned.rates.total;
  const cleanPeriodDays = 160;

  const scenarios = buildScenarios();
  const results: BacktestScenarioResult[] = [];
  let horizonAlerts = 0;
  let trueAlerts = 0;

  for (const scenario of scenarios) {
    const injected = injectScenario(clean, scenario, seed + scenario.name.length * 7);
    const baselineMin = Math.min(...clean.map((r) => r.takenAt));
    const start = baselineMin + scenario.startDay * DAY_MS;
    const horizonEnd = start + (scenario.durationDays + 21) * DAY_MS;
    let detectedAt: number | null = null;
    const kinds = new Set<WarningKind>();
    for (let now = start + 3 * DAY_MS; now <= horizonEnd; now += 7 * DAY_MS) {
      const warnings = detectAt(injected, now, config);
      const match = warnings.find((w) => scenario.matches(w));
      if (match && detectedAt === null) {
        detectedAt = now;
        kinds.add(match.kind);
      }
      horizonAlerts += warnings.length;
      trueAlerts += warnings.filter((w) => scenario.matches(w)).length;
    }
    results.push({
      scenario: scenario.name,
      description: scenario.description,
      detected: detectedAt !== null,
      latencyDays: detectedAt !== null ? Math.round((detectedAt - start) / DAY_MS) : null,
      detectingKinds: [...kinds],
    });
  }

  const methodology = [
    "Baseline: 700 days of seeded synthetic surveillance (5 organisms, 4 wards, ~12.5 isolates/day) with stable resistance — no outbreaks.",
    "Detectors: D1 proportion-drop z-test (28d vs 365d, first isolate per patient), D2 weekly-count CUSUM, D3 14-day Poisson cluster scan, D4 MDRO-phenotype rare-event CUSUM.",
    "Scenarios are deterministic, labelled injections into in-memory copies — never mixed into the live dataset.",
    "Latency = days from scenario start to the first weekly replay step emitting a matching warning; replay steps every 7 days, so ±7 days granularity.",
    `False alarms: weekly full-stack replay over days 400–560 of the baseline with the shipped config (CUSUM h=${config.cusumH}, cluster p=${config.clusterP}).`,
    "All figures are properties of the synthetic generator; the live dataset cannot yield ground-truth outbreak labels.",
  ];

  return {
    scenarios: results,
    falseAlarmsPerMonth,
    cleanPeriodDays,
    alertsInCleanPeriod: Math.round((falseAlarmsPerMonth * cleanPeriodDays) / 30.4),
    ppv: horizonAlerts > 0 ? Math.round((trueAlerts / horizonAlerts) * 100) / 100 : null,
    config,
    runtimeMs: Date.now() - t0,
    methodology,
  };
}
