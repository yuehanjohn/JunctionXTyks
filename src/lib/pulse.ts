// ── AEI Pulse service layer ───────────────────────────────────────────
//
// Population-level surveillance aggregates for the Pulse screens (Overview,
// heatmap, alert investigation, ward comparison, organism profile, data
// explorer). All percentages derive from first isolates per (patient,
// organism) per period — the same EARS-Net methodology as stats.ts — and go
// through the shared dataMax-keyed result cache. `asOf` on every getter is
// the historical-replay anchor: windows are computed as if "now" were that
// instant.
//
// Clinical-safety invariant: nothing here produces patient-specific
// antibiotic recommendations, and no signal is ever labelled a confirmed
// outbreak. Narratives describe populations and explicitly frame signals as
// statistical findings for investigation.

import { Prisma } from "@prisma/client";

import { db } from "./db";
import { classifyIsolate } from "./mdro";
import {
  AGE_BANDS,
  AlertInvestigationResponse,
  ExploreResponse,
  FILTER_ALL,
  HeatmapCell,
  HeatmapResponse,
  MIN_ISOLATES,
  OrganismProfileResponse,
  OverviewResponse,
  ResistancePoint,
  Signal,
  SusCell,
  WardCompareResponse,
  WardComparisonResponse,
  Workbench,
  EXPLORE_PAGE_SIZE,
  toneForR,
  type FunnelPoint,
  type WardPair,
} from "./types";
import {
  ALL_WARDS,
  BASELINE_DAYS,
  IsoRec,
  ROLLING_DAYS,
  SusRec,
  cachedByDataMax,
  fetchIsolates,
  fetchSusceptibilities,
  firstIsolates,
  getMeta,
  getSignals,
  resolveAnchor,
  round1,
  tallySusceptibilities,
  twoProportionZ,
  windowRange,
  wilsonPct,
  Z95,
} from "./stats";

const DAY_MS = 86_400_000;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── Small helpers ─────────────────────────────────────────────────────

function dayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function dayLabel(d: Date): string {
  return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
}

function sharePct(part: number, total: number): number {
  return total > 0 ? round1((part / total) * 100) : 0;
}

function scopeWard(ward?: string): string | undefined {
  return ward && ward !== ALL_WARDS ? ward : undefined;
}

/** UI sentinel ("all") must never reach the DB as a real specimen filter. */
function normSample(sampleType?: string | null): string | null {
  return sampleType && sampleType !== FILTER_ALL ? sampleType : null;
}

/** Per-isolate susceptibility outcome: lists of R/S antibiotics plus totals. */
interface IsoResults {
  s: number;
  r: number;
  resistant: string[];
  susceptible: string[];
}

function resultsByIsolate(rows: SusRec[]): Map<string, IsoResults> {
  const byIsolate = new Map<string, IsoResults>();
  for (const row of rows) {
    if (row.result !== "S" && row.result !== "R") continue;
    let entry = byIsolate.get(row.isolateId);
    if (!entry) {
      entry = { s: 0, r: 0, resistant: [], susceptible: [] };
      byIsolate.set(row.isolateId, entry);
    }
    if (row.result === "S") {
      entry.s += 1;
      entry.susceptible.push(row.antibiotic);
    } else {
      entry.r += 1;
      entry.resistant.push(row.antibiotic);
    }
  }
  return byIsolate;
}

/** "isolateId|antibiotic" → S/R, for O(1) single-cell lookups over big panels. */
function resultIndex(rows: SusRec[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const row of rows) {
    if (row.result === "S" || row.result === "R") {
      index.set(`${row.isolateId}|${row.antibiotic}`, row.result);
    }
  }
  return index;
}

/** S/R tally of one organism×antibiotic cell over already-deduped isolates. */
function tallyCell(
  isolates: IsoRec[],
  index: Map<string, string>,
  organism: string,
  antibiotic: string,
): { s: number; r: number } {
  const cell = { s: 0, r: 0 };
  for (const iso of isolates) {
    if (iso.organism !== organism) continue;
    const result = index.get(`${iso.id}|${antibiotic}`);
    if (result === "S") cell.s += 1;
    else if (result === "R") cell.r += 1;
  }
  return cell;
}

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

// ── Overview ──────────────────────────────────────────────────────────

export async function getOverview(opts: {
  ward?: string;
  sampleType?: string | null;
  asOf?: string | null;
}): Promise<OverviewResponse> {
  return cachedByDataMax("overview", opts, () => computeOverview(opts));
}

async function computeOverview(opts: {
  ward?: string;
  sampleType?: string | null;
  asOf?: string | null;
}): Promise<OverviewResponse> {
  const end = await resolveAnchor(opts.asOf);
  const start = new Date(end.getTime() - ROLLING_DAYS * DAY_MS);
  const prevEnd = start;
  const prevStart = new Date(start.getTime() - ROLLING_DAYS * DAY_MS);
  const ward = scopeWard(opts.ward);
  const sampleType = normSample(opts.sampleType) || null;

  const [isolates, susRows, signals] = await Promise.all([
    fetchIsolates(prevStart, end, false, ward, sampleType),
    fetchSusceptibilities(prevStart, end, false, ward, sampleType),
    getSignals({ ward: opts.ward, asOf: opts.asOf }),
  ]);

  const windowIso = isolates.filter((i) => i.takenAt >= start);
  const prevIso = isolates.filter((i) => i.takenAt < start);
  const firstWin = firstIsolates(windowIso);
  const firstPrev = firstIsolates(prevIso);
  const idsWin = new Set(firstWin.map((i) => i.id));
  const idsPrev = new Set(firstPrev.map((i) => i.id));
  const results = resultsByIsolate(susRows);

  // KPI: total first isolates, % change vs the preceding 4 weeks.
  const totalNow = firstWin.length;
  const totalPrev = firstPrev.length;
  const totalKpi = {
    value: totalNow,
    prevValue: totalPrev,
    delta: totalPrev > 0 ? round1(((totalNow - totalPrev) / totalPrev) * 100) : 0,
    deltaKind: "pct" as const,
  };

  // KPI: resistant isolates = first isolates with ≥1 R result on their panel.
  const resistantCount = (isoList: IsoRec[]) => {
    let n = 0;
    for (const iso of isoList) {
      const r = results.get(iso.id);
      if (r && r.resistant.length > 0) n += 1;
    }
    return n;
  };
  const resNow = resistantCount(firstWin);
  const resPrev = resistantCount(firstPrev);
  const resistantKpi =
    totalNow > 0
      ? {
          value: sharePct(resNow, totalNow),
          prevValue: totalPrev > 0 ? sharePct(resPrev, totalPrev) : 0,
          delta: round1(sharePct(resNow, totalNow) - (totalPrev > 0 ? sharePct(resPrev, totalPrev) : 0)),
          deltaKind: "pp" as const,
        }
      : null;

  // KPI: most common organism in the window.
  const countByOrganism = new Map<string, number>();
  for (const iso of firstWin) {
    countByOrganism.set(iso.organism, (countByOrganism.get(iso.organism) ?? 0) + 1);
  }
  const topOrganism = [...countByOrganism.entries()].sort(
    ([oA, nA], [oB, nB]) => nB - nA || (oA < oB ? -1 : 1),
  )[0];

  // KPI: highest resistance cell (n ≥ MIN_ISOLATES) across the whole panel.
  const tallyWin = tallySusceptibilities(susRows, idsWin);
  let highest: { organism: string; antibiotic: string; rPct: number; n: number } | null = null;
  for (const [organism, byAntibiotic] of tallyWin) {
    for (const [antibiotic, cell] of byAntibiotic) {
      const n = cell.s + cell.r;
      if (n < MIN_ISOLATES) continue;
      const rPct = round1((cell.r / n) * 100);
      if (!highest || rPct > highest.rPct) highest = { organism, antibiotic, rPct, n };
    }
  }

  // Chart series: daily % resistant for the top 5 organisms in the window.
  const top5 = [...countByOrganism.entries()]
    .sort(([oA, nA], [oB, nB]) => nB - nA || (oA < oB ? -1 : 1))
    .slice(0, 5)
    .map(([organism]) => organism);
  const series = top5.map((organism) => {
    const isoByDay = new Map<number, IsoRec[]>();
    for (const iso of firstWin) {
      if (iso.organism !== organism) continue;
      const day = dayStart(iso.takenAt).getTime();
      const bucket = isoByDay.get(day);
      if (bucket) bucket.push(iso);
      else isoByDay.set(day, [iso]);
    }
    const points: ResistancePoint[] = [];
    // The window is [start, end] with both endpoints inclusive (engine
    // convention), so daily buckets run start … end → ROLLING_DAYS + 1.
    for (let d = 0; d <= ROLLING_DAYS; d++) {
      const day = dayStart(new Date(start.getTime() + d * DAY_MS));
      const bucket = isoByDay.get(day.getTime()) ?? [];
      let s = 0;
      let r = 0;
      for (const iso of bucket) {
        const res = results.get(iso.id);
        if (!res) continue;
        s += res.s;
        r += res.r;
      }
      const n = s + r;
      points.push({
        date: day.toISOString(),
        label: dayLabel(day),
        rPct: n > 0 ? round1((r / n) * 100) : 0,
        n,
      });
    }
    return { organism, n: countByOrganism.get(organism) ?? 0, points };
  });

  // Specimen mix over the window's first isolates.
  const bySample = new Map<string, number>();
  for (const iso of firstWin) {
    bySample.set(iso.sampleType, (bySample.get(iso.sampleType) ?? 0) + 1);
  }
  const specimen = [...bySample.entries()]
    .map(([st, n]) => ({ sampleType: st, n, sharePct: sharePct(n, totalNow) }))
    .sort((a, b) => b.n - a.n);

  const topOrganisms = [...countByOrganism.entries()]
    .sort(([oA, nA], [oB, nB]) => nB - nA || (oA < oB ? -1 : 1))
    .slice(0, 5)
    .map(([organism, n]) => ({ organism, n, sharePct: sharePct(n, totalNow) }));

  // Newest isolates in scope (no patient identifiers leave the service layer).
  const recentRows = await db.isolate.findMany({
    where: {
      culture: {
        ...(ward ? { ward } : {}),
        ...(sampleType ? { sampleType } : {}),
        takenAt: { gte: start, lte: end },
      },
    },
    orderBy: { culture: { takenAt: "desc" } },
    take: 8,
    select: {
      id: true,
      organism: true,
      culture: { select: { takenAt: true, ward: true } },
      susceptibilities: { select: { antibiotic: true, result: true } },
    },
  });
  const recentIsolates = recentRows.map((row) => {
    const resistant: string[] = [];
    const susceptible: string[] = [];
    for (const sus of row.susceptibilities) {
      if (sus.result === "R") resistant.push(sus.antibiotic);
      else if (sus.result === "S") susceptible.push(sus.antibiotic);
    }
    return {
      isolateId: row.id,
      date: row.culture.takenAt.toISOString(),
      ward: row.culture.ward,
      organism: row.organism,
      resistant,
      susceptible,
    };
  });

  return {
    ward: opts.ward || ALL_WARDS,
    sampleType,
    asOf: opts.asOf || null,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    prevStart: prevStart.toISOString(),
    prevEnd: prevEnd.toISOString(),
    generatedAt: new Date().toISOString(),
    kpis: {
      totalIsolates: totalKpi,
      resistantPct: resistantKpi,
      mostCommonOrganism: topOrganism
        ? { organism: topOrganism[0], sharePct: sharePct(topOrganism[1], totalNow), n: topOrganism[1] }
        : null,
      highestResistance: highest,
    },
    series,
    alerts: signals.signals,
    alertCount: signals.signals.length,
    specimen,
    topOrganisms,
    recentIsolates,
  };
}

// ── Heatmap: organism × antibiotic resistance per ward ────────────────

export async function getHeatmap(opts: {
  organism: string;
  ward?: string;
  sampleType?: string | null;
  asOf?: string | null;
}): Promise<HeatmapResponse> {
  return cachedByDataMax("heatmap", opts, () => computeHeatmap(opts));
}

async function computeHeatmap(opts: {
  organism: string;
  ward?: string;
  sampleType?: string | null;
  asOf?: string | null;
}): Promise<HeatmapResponse> {
  const { start, end } = windowRange("4w", await resolveAnchor(opts.asOf), opts.asOf);
  const ward = scopeWard(opts.ward);
  const baselineStart = new Date(start.getTime() - BASELINE_DAYS * DAY_MS);
  const [isolates, susRows, baselineIso, baselineSus, meta] = await Promise.all([
    fetchIsolates(start, end, false, ward, normSample(opts.sampleType)),
    fetchSusceptibilities(start, end, false, ward, normSample(opts.sampleType)),
    fetchIsolates(baselineStart, start, true, ward, normSample(opts.sampleType)),
    fetchSusceptibilities(baselineStart, start, true, ward, normSample(opts.sampleType)),
    getMeta(),
  ]);

  const firstIso = firstIsolates(isolates).filter((i) => i.organism === opts.organism);
  const overallIds = new Set(firstIso.map((i) => i.id));
  const tallyOverall = tallySusceptibilities(susRows, overallIds);
  const byOrganism = tallyOverall.get(opts.organism) ?? new Map();

  // Trailing-12-month baseline for the same cells (escalates the tone).
  const baselineFirst = firstIsolates(baselineIso).filter((i) => i.organism === opts.organism);
  const baselineTallyOverall =
    tallySusceptibilities(baselineSus, new Set(baselineFirst.map((i) => i.id))).get(opts.organism) ??
    new Map();

  // Per-ward tallies for the selected organism (window and baseline).
  const idsByWard = new Map<string, Set<string>>();
  for (const iso of firstIso) {
    let ids = idsByWard.get(iso.ward);
    if (!ids) idsByWard.set(iso.ward, (ids = new Set()));
    ids.add(iso.id);
  }
  const tallyByWard = new Map<string, Map<string, { s: number; r: number }>>();
  for (const [w, ids] of idsByWard) {
    tallyByWard.set(w, tallySusceptibilities(susRows, ids).get(opts.organism) ?? new Map());
  }
  const baselineIdsByWard = new Map<string, Set<string>>();
  for (const iso of baselineFirst) {
    let ids = baselineIdsByWard.get(iso.ward);
    if (!ids) baselineIdsByWard.set(iso.ward, (ids = new Set()));
    ids.add(iso.id);
  }
  const baselineTallyByWard = new Map<string, Map<string, { s: number; r: number }>>();
  for (const [w, ids] of baselineIdsByWard) {
    baselineTallyByWard.set(
      w,
      tallySusceptibilities(baselineSus, ids).get(opts.organism) ?? new Map(),
    );
  }

  const baselineROf = (
    tally: Map<string, Map<string, { s: number; r: number }>> | Map<string, { s: number; r: number }>,
    antibiotic: string,
    key?: string,
  ): number | null => {
    const cell = key
      ? (tally as Map<string, Map<string, { s: number; r: number }>>).get(key)?.get(antibiotic)
      : (tally as Map<string, { s: number; r: number }>).get(antibiotic);
    if (!cell) return null;
    const n = cell.s + cell.r;
    return n > 0 ? round1((cell.r / n) * 100) : null;
  };

  const toCell = (
    cell: { s: number; r: number } | undefined,
    baselineR: number | null,
    antibiotic: string,
  ): HeatmapCell => {
    const n = cell ? cell.s + cell.r : 0;
    const rPct = n > 0 ? round1((cell!.r / n) * 100) : 0;
    return {
      ward: "",
      rPct,
      n,
      sufficient: n >= MIN_ISOLATES,
      baselineR,
      tone: toneForR(rPct, n, baselineR, antibiotic),
    };
  };

  const antibiotics = new Set([...byOrganism.keys()]);
  for (const t of tallyByWard.values()) for (const ab of t.keys()) antibiotics.add(ab);

  const wards = ["Overall", ...meta.wards.filter((w) => w !== ALL_WARDS)];
  const rows = [...antibiotics]
    .map((antibiotic) => {
      const overall = {
        ...toCell(
          byOrganism.get(antibiotic),
          baselineROf(baselineTallyOverall, antibiotic),
          antibiotic,
        ),
        ward: "Overall",
      };
      const cells = meta.wards
        .filter((w) => (tallyByWard.get(w)?.get(antibiotic)?.s ?? 0) + (tallyByWard.get(w)?.get(antibiotic)?.r ?? 0) > 0)
        .map((w) => ({
          ...toCell(
            tallyByWard.get(w)?.get(antibiotic),
            baselineROf(baselineTallyByWard, antibiotic, w),
            antibiotic,
          ),
          ward: w,
        }));
      return { antibiotic, overall, cells };
    })
    .sort(
      (a, b) =>
        b.overall.rPct - a.overall.rPct ||
        b.overall.n - a.overall.n ||
        (a.antibiotic < b.antibiotic ? -1 : 1),
    );

  return {
    organism: opts.organism,
    ward: opts.ward || ALL_WARDS,
    sampleType: normSample(opts.sampleType) || null,
    asOf: opts.asOf || null,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    generatedAt: new Date().toISOString(),
    wards,
    rows,
  };
}

// ── Alert investigation ───────────────────────────────────────────────

export async function getAlertInvestigation(opts: {
  id: string;
  asOf?: string | null;
}): Promise<AlertInvestigationResponse> {
  return cachedByDataMax("investigation", opts, () => computeInvestigation(opts));
}

async function computeInvestigation(opts: {
  id: string;
  asOf?: string | null;
}): Promise<AlertInvestigationResponse> {
  const [ward, organism, antibiotic] = opts.id.split("|");
  const windowEnd = await resolveAnchor(opts.asOf);
  const windowStart = new Date(windowEnd.getTime() - ROLLING_DAYS * DAY_MS);
  const baselineStart = new Date(windowStart.getTime() - BASELINE_DAYS * DAY_MS);
  const seriesStart = new Date(windowStart.getTime() - 60 * DAY_MS);

  const [isolates, susRows, meta] = await Promise.all([
    fetchIsolates(baselineStart, windowEnd, false, ward),
    fetchSusceptibilities(baselineStart, windowEnd, false, ward),
    getMeta(),
  ]);
  const index = resultIndex(susRows);

  // firstIsolates dedupes per (patient, organism); the cell tally then
  // restricts to the investigated organism and its result on `antibiotic`.
  const cellOf = (isoList: IsoRec[]): { s: number; r: number } =>
    tallyCell(firstIsolates(isoList), index, organism, antibiotic);

  const wc = cellOf(isolates.filter((i) => i.takenAt >= windowStart));
  const bc = cellOf(isolates.filter((i) => i.takenAt < windowStart));
  const nWindow = wc.s + wc.r;
  const nBaseline = bc.s + bc.r;
  const windowS = nWindow > 0 ? (wc.s / nWindow) * 100 : 0;
  const baselineS = nBaseline > 0 ? (bc.s / nBaseline) * 100 : 0;
  const z = twoProportionZ(wc.s, nWindow, bc.s, nBaseline);
  const dropPp = baselineS - windowS;
  const signal: Signal = {
    id: opts.id,
    ward,
    organism,
    antibiotic,
    sampleType: null,
    windowS: round1(windowS),
    baselineS: round1(baselineS),
    dropPp: round1(dropPp),
    z: Math.round(z * 100) / 100,
    nWindow,
    nBaseline,
    severity: z <= -4 || dropPp >= 15 ? "high" : z <= -3 || dropPp >= 10 ? "moderate" : "watch",
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  };
  const pApprox = normalTwoSidedP(z);

  // Daily % resistant for this cell across the last 88 days (window + 60d lead-in).
  const spanIso = firstIsolates(isolates.filter((i) => i.takenAt >= seriesStart)).filter(
    (i) => i.organism === organism,
  );
  const byDay = new Map<number, { s: number; r: number }>();
  for (const iso of spanIso) {
    const result = index.get(`${iso.id}|${antibiotic}`);
    if (result !== "S" && result !== "R") continue;
    const day = dayStart(iso.takenAt).getTime();
    const cell = byDay.get(day) ?? { s: 0, r: 0 };
    if (result === "S") cell.s += 1;
    else cell.r += 1;
    byDay.set(day, cell);
  }
  const points: ResistancePoint[] = [];
  // 60-day lead-in + window, both endpoints inclusive → 89 buckets.
  for (let d = 0; d <= 88; d++) {
    const day = dayStart(new Date(seriesStart.getTime() + d * DAY_MS));
    const cell = byDay.get(day.getTime());
    const n = cell ? cell.s + cell.r : 0;
    points.push({
      date: day.toISOString(),
      label: dayLabel(day),
      rPct: n > 0 ? round1((cell!.r / n) * 100) : 0,
      n,
    });
  }

  // Context: same cell hospital-wide in the window, and the ward rank.
  const hospitalIso = await fetchIsolates(windowStart, windowEnd, false, undefined);
  const hospitalSus = await fetchSusceptibilities(windowStart, windowEnd, false, undefined);
  const hospitalIndex = resultIndex(hospitalSus);
  const firstHospital = firstIsolates(hospitalIso);
  const hospitalCell = tallyCell(firstHospital, hospitalIndex, organism, antibiotic);
  const nHospital = hospitalCell.s + hospitalCell.r;

  const wardRank: { ward: string; rPct: number; n: number }[] = [];
  for (const w of meta.wards.filter((x) => x !== ALL_WARDS)) {
    const cell = tallyCell(
      firstHospital.filter((i) => i.ward === w),
      hospitalIndex,
      organism,
      antibiotic,
    );
    const n = cell.s + cell.r;
    if (n > 0) wardRank.push({ ward: w, rPct: round1((cell.r / n) * 100), n });
  }
  wardRank.sort((a, b) => b.rPct - a.rPct || b.n - a.n);

  const narrative =
    `In the rolling 4-week window (${windowStart.toISOString().slice(0, 10)} – ${windowEnd.toISOString().slice(0, 10)}), ` +
    `susceptibility to ${antibiotic} among ${organism} isolates on ${ward} was ${round1(windowS)}% ` +
    `(n=${nWindow}), compared with ${round1(baselineS)}% over the trailing 12 months (n=${nBaseline}). ` +
    `The difference is ${round1(dropPp)} percentage points, two-proportion z=${Math.round(z * 100) / 100}, p≈${pApprox < 0.001 ? "<0.001" : round1(pApprox * 1000) / 1000}. ` +
    `This is a statistical surveillance signal that warrants investigation — it does not by itself confirm an outbreak. ` +
    `Consider reviewing sampling and reporting practices on the ward, laboratory confirmation of recent results, and ` +
    `infection-prevention context; epidemiological assessment is required before any outbreak conclusion.`;

  // ── Investigation workbench ──────────────────────────────────────────
  // Isolate timeline for the same organism+ward (trailing 60 days), the
  // involved patients' ward movements, co-location counts, and putative
  // import attribution — hypothesis material for the investigating team.
  const wbFrom = new Date(windowEnd.getTime() - 60 * DAY_MS);
  const wbIsolates = await db.isolate.findMany({
    where: {
      organism,
      culture: { ward, takenAt: { gte: wbFrom, lte: windowEnd } },
    },
    select: {
      id: true,
      culture: {
        select: {
          patientId: true,
          takenAt: true,
          sampleType: true,
          ward: true,
        },
      },
      susceptibilities: { select: { antibiotic: true, result: true } },
    },
    orderBy: { culture: { takenAt: "desc" } },
    take: 60,
  });
  const wbRows = wbIsolates.map((row) => {
    const results: Record<string, "S" | "R"> = {};
    for (const sus of row.susceptibilities) {
      if (sus.result === "S" || sus.result === "R") results[sus.antibiotic] = sus.result;
    }
    return { row, results };
  });
  // repeat = same patient had a same-organism isolate in the previous 30 days
  const seenPatientAt = new Map<string, number>();
  const timeline = [...wbRows]
    .sort((a, b) => a.row.culture.takenAt.getTime() - b.row.culture.takenAt.getTime())
    .map(({ row, results }) => {
      const t = row.culture.takenAt.getTime();
      const prev = seenPatientAt.get(row.culture.patientId);
      const repeat = prev !== undefined && t - prev <= 30 * DAY_MS;
      seenPatientAt.set(row.culture.patientId, t);
      const assessment = classifyIsolate({
        id: row.id,
        patientId: row.culture.patientId,
        organism,
        ward: row.culture.ward,
        sampleType: row.culture.sampleType,
        takenAt: t,
        results,
      });
      return {
        isolateId: row.id,
        date: row.culture.takenAt.toISOString(),
        ward: row.culture.ward,
        sampleType: row.culture.sampleType,
        organism,
        phenotypes: assessment.phenotypes,
        resistant: Object.entries(results).filter(([, v]) => v === "R").map(([ab]) => ab),
        patientRef: row.culture.patientId,
        repeat,
      };
    });

  const involvedPatients = [
    ...new Set(timeline.slice(0, 12).map((i) => i.patientRef)),
  ].slice(0, 8);
  const pathwayCultures =
    involvedPatients.length > 0
      ? await db.culture.findMany({
          where: { patientId: { in: involvedPatients }, takenAt: { gte: wbFrom, lte: windowEnd } },
          select: { patientId: true, ward: true, takenAt: true },
          orderBy: { takenAt: "asc" },
        })
      : [];
  const pathway = pathwayCultures
    .sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime())
    .map((c) => ({ patientRef: c.patientId, ward: c.ward, date: c.takenAt.toISOString() }));

  const recentFrom = windowEnd.getTime() - 14 * DAY_MS;
  const colocatedPatients = new Set(
    timeline.filter((i) => new Date(i.date).getTime() >= recentFrom).map((i) => i.patientRef),
  ).size;

  const importCounts = new Map<string, number>();
  if (involvedPatients.length > 0) {
    const priorCultures = await db.culture.findMany({
      where: {
        patientId: { in: involvedPatients },
        takenAt: { gte: new Date(windowEnd.getTime() - 74 * DAY_MS), lte: windowEnd },
      },
      select: { patientId: true, ward: true, takenAt: true },
      orderBy: { takenAt: "asc" },
    });
    const byPatient = new Map<string, { ward: string; takenAt: number }[]>();
    for (const c of priorCultures) {
      const list = byPatient.get(c.patientId);
      if (list) list.push({ ward: c.ward, takenAt: c.takenAt.getTime() });
      else byPatient.set(c.patientId, [{ ward: c.ward, takenAt: c.takenAt.getTime() }]);
    }
    for (const iso of timeline) {
      const t = new Date(iso.date).getTime();
      const seq = byPatient.get(iso.patientRef) ?? [];
      const prior = seq.filter((c) => c.ward !== iso.ward && c.takenAt < t && t - c.takenAt <= 14 * DAY_MS);
      const last = prior[prior.length - 1];
      if (last) importCounts.set(last.ward, (importCounts.get(last.ward) ?? 0) + 1);
    }
  }
  const importAttribution = [...importCounts.entries()]
    .map(([from, patients]) => ({ from, patients }))
    .sort((a, b) => b.patients - a.patients);

  const workbench: Workbench = {
    isolates: timeline,
    pathway,
    colocatedPatients,
    importAttribution,
    checklist: [
      "Verify the laboratory results and sampling dates for the flagged isolates.",
      "Check for duplicate/repeat cultures vs genuinely new infections in the timeline above.",
      "Review recent ward transfers of the involved patients (pathway map) for putative import/export.",
      "Consider contact screening and environmental sampling on the ward if transmission is suspected.",
      "Correlate with infection-prevention observations before any epidemiological conclusion.",
    ],
  };

  return {
    signal,
    points,
    hospital: {
      rPct: nHospital > 0 ? round1((hospitalCell.r / nHospital) * 100) : 0,
      n: nHospital,
    },
    wardRank,
    pApprox,
    narrative,
    workbench,
    generatedAt: new Date().toISOString(),
  };
}

// ── Ward comparison ───────────────────────────────────────────────────

export async function getWardComparison(opts: {
  sampleType?: string | null;
  asOf?: string | null;
}): Promise<WardComparisonResponse> {
  return cachedByDataMax("ward-comparison", opts, () => computeWardComparison(opts));
}

async function computeWardComparison(opts: {
  sampleType?: string | null;
  asOf?: string | null;
}): Promise<WardComparisonResponse> {
  const { start, end } = windowRange("4w", await resolveAnchor(opts.asOf), opts.asOf);
  const baselineStart = new Date(start.getTime() - BASELINE_DAYS * DAY_MS);
  const [isolates, susRows, baselineIso, baselineSus, meta, signals] = await Promise.all([
    fetchIsolates(start, end, false, undefined, normSample(opts.sampleType)),
    fetchSusceptibilities(start, end, false, undefined, normSample(opts.sampleType)),
    fetchIsolates(baselineStart, start, true, undefined, normSample(opts.sampleType)),
    fetchSusceptibilities(baselineStart, start, true, undefined, normSample(opts.sampleType)),
    getMeta(),
    getSignals({ asOf: opts.asOf }),
  ]);
  const results = resultsByIsolate(susRows);
  const baselineResults = resultsByIsolate(baselineSus);
  const baselineFirst = firstIsolates(baselineIso);

  const isolatesByWard = new Map<string, IsoRec[]>();
  for (const iso of firstIsolates(isolates)) {
    const list = isolatesByWard.get(iso.ward);
    if (list) list.push(iso);
    else isolatesByWard.set(iso.ward, [iso]);
  }

  // Top 8 organisms hospital-wide define the grid columns.
  const hospitalCounts = new Map<string, number>();
  for (const iso of isolatesByWard.values()) {
    for (const iso2 of iso) hospitalCounts.set(iso2.organism, (hospitalCounts.get(iso2.organism) ?? 0) + 1);
  }
  const organisms = [...hospitalCounts.entries()]
    .sort(([oA, nA], [oB, nB]) => nB - nA || (oA < oB ? -1 : 1))
    .slice(0, 8)
    .map(([organism]) => organism);

  const signalCounts = new Map<string, { high: number; moderate: number; watch: number }>();
  for (const s of signals.signals) {
    const entry = signalCounts.get(s.ward) ?? { high: 0, moderate: 0, watch: 0 };
    entry[s.severity] += 1;
    signalCounts.set(s.ward, entry);
  }

  const wards = meta.wards
    .filter((w) => w !== ALL_WARDS)
    .map((w) => {
      const wardIso = isolatesByWard.get(w) ?? [];
      const n = wardIso.length;
      let resistant = 0;
      for (const iso of wardIso) {
        const res = results.get(iso.id);
        if (res && res.resistant.length > 0) resistant += 1;
      }
      const orgCounts = new Map<string, number>();
      for (const iso of wardIso) orgCounts.set(iso.organism, (orgCounts.get(iso.organism) ?? 0) + 1);
      const top = [...orgCounts.entries()].sort(([oA, nA], [oB, nB]) => nB - nA || (oA < oB ? -1 : 1))[0];

      const organismResistance = organisms.map((organism) => {
        const tallyWardOrganism = (pool: IsoRec[], resMap: Map<string, IsoResults>) => {
          let s = 0;
          let r = 0;
          for (const iso of pool) {
            if (iso.organism !== organism) continue;
            const res = resMap.get(iso.id);
            if (!res) continue;
            s += res.s;
            r += res.r;
          }
          return { s, r };
        };
        const win = tallyWardOrganism(wardIso, results);
        const base = tallyWardOrganism(
          baselineFirst.filter((iso) => iso.ward === w),
          baselineResults,
        );
        const nCell = win.s + win.r;
        const rPct = nCell > 0 ? round1((win.r / nCell) * 100) : null;
        const baseN = base.s + base.r;
        const baselineR = baseN > 0 ? round1((base.r / baseN) * 100) : null;
        return {
          organism,
          n: nCell,
          rPct,
          baselineR,
          tone: toneForR(rPct ?? 0, nCell, baselineR),
        };
      });

      return {
        ward: w,
        isolates: n,
        resistantPct: n > 0 ? sharePct(resistant, n) : null,
        topOrganism: top ? top[0] : null,
        topOrganismSharePct: top ? sharePct(top[1], n) : 0,
        signals: signalCounts.get(w) ?? { high: 0, moderate: 0, watch: 0 },
        organismResistance,
      };
    })
    .sort((a, b) => b.isolates - a.isolates || (a.ward < b.ward ? -1 : 1));

  return {
    sampleType: normSample(opts.sampleType) || null,
    asOf: opts.asOf || null,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    generatedAt: new Date().toISOString(),
    wards,
    organisms,
  };
}

// ── Organism profile ──────────────────────────────────────────────────

export async function getOrganismProfile(opts: {
  organism: string;
  ward?: string;
  sampleType?: string | null;
  asOf?: string | null;
}): Promise<OrganismProfileResponse> {
  return cachedByDataMax("organism-profile", opts, () => computeOrganismProfile(opts));
}

async function computeOrganismProfile(opts: {
  organism: string;
  ward?: string;
  sampleType?: string | null;
  asOf?: string | null;
}): Promise<OrganismProfileResponse> {
  const { start, end } = windowRange("4w", await resolveAnchor(opts.asOf), opts.asOf);
  const ward = scopeWard(opts.ward);
  const [windowIsoAll, windowSusAll, meta] = await Promise.all([
    fetchIsolates(start, end, false, ward, normSample(opts.sampleType)),
    fetchSusceptibilities(start, end, false, ward, normSample(opts.sampleType)),
    getMeta(),
  ]);
  const firstAll = firstIsolates(windowIsoAll);
  const firstOrg = firstAll.filter((i) => i.organism === opts.organism);
  const idsOrg = new Set(firstOrg.map((i) => i.id));
  const tally = tallySusceptibilities(windowSusAll, idsOrg).get(opts.organism) ?? new Map();

  const cells: SusCell[] = [...tally.entries()]
    .filter(([, cell]) => cell.s + cell.r > 0)
    .map(([antibiotic, cell]) => {
      const n = cell.s + cell.r;
      const { lo, hi } = wilsonPct(cell.s, n);
      return {
        antibiotic,
        sPct: round1((cell.s / n) * 100),
        n,
        ciLo: round1(lo),
        ciHi: round1(hi),
        sufficient: n >= MIN_ISOLATES,
      };
    })
    .sort((a, b) => b.sPct - a.sPct || (a.antibiotic < b.antibiotic ? -1 : 1));

  // Monthly % resistant per antibiotic over the trailing 12 months.
  const monthlyStart = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
  const [monthIso, monthSus] = await Promise.all([
    fetchIsolates(monthlyStart, end, false, ward, normSample(opts.sampleType)),
    fetchSusceptibilities(monthlyStart, end, false, ward, normSample(opts.sampleType)),
  ]);
  // First isolate per (patient, organism) per month bucket.
  const seen = new Set<string>();
  const monthOf = new Map<string, number>();
  const sortedMonthIso = [...monthIso]
    .filter((i) => i.organism === opts.organism)
    .sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime() || (a.id < b.id ? -1 : 1));
  for (const iso of sortedMonthIso) {
    const m =
      (iso.takenAt.getUTCFullYear() - monthlyStart.getUTCFullYear()) * 12 +
      (iso.takenAt.getUTCMonth() - monthlyStart.getUTCMonth());
    if (m < 0 || m > 11) continue;
    const key = `${iso.patientId}|${m}`;
    if (seen.has(key)) continue;
    seen.add(key);
    monthOf.set(iso.id, m);
  }
  const monthTally = new Map<string, Map<number, { s: number; r: number }>>();
  for (const row of monthSus) {
    const m = monthOf.get(row.isolateId);
    if (m === undefined || (row.result !== "S" && row.result !== "R")) continue;
    let byMonth = monthTally.get(row.antibiotic);
    if (!byMonth) monthTally.set(row.antibiotic, (byMonth = new Map()));
    const cell = byMonth.get(m) ?? { s: 0, r: 0 };
    if (row.result === "S") cell.s += 1;
    else cell.r += 1;
    byMonth.set(m, cell);
  }
  const monthly = [...monthTally.entries()]
    .map(([antibiotic, byMonth]) => {
      const points: ResistancePoint[] = [];
      for (let m = 0; m < 12; m++) {
        const d = new Date(Date.UTC(monthlyStart.getUTCFullYear(), monthlyStart.getUTCMonth() + m, 1));
        const cell = byMonth.get(m);
        const n = cell ? cell.s + cell.r : 0;
        points.push({
          date: d.toISOString(),
          label: `${MONTH_NAMES[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`,
          rPct: n > 0 ? round1((cell!.r / n) * 100) : 0,
          n,
        });
      }
      return { antibiotic, points };
    })
    .sort((a, b) => (a.antibiotic < b.antibiotic ? -1 : 1));

  // Specimen mix and per-ward breakdown for this organism in the window.
  const bySample = new Map<string, number>();
  for (const iso of firstOrg) bySample.set(iso.sampleType, (bySample.get(iso.sampleType) ?? 0) + 1);
  const specimen = [...bySample.entries()]
    .map(([st, n]) => ({ sampleType: st, n, sharePct: sharePct(n, firstOrg.length) }))
    .sort((a, b) => b.n - a.n);

  const resultsAll = resultsByIsolate(windowSusAll);
  // Baseline (trailing 12 months before the window) per ward, same organism.
  const baselineStart = new Date(start.getTime() - BASELINE_DAYS * DAY_MS);
  const [baselineIso, baselineSus] = await Promise.all([
    fetchIsolates(baselineStart, start, true, ward, normSample(opts.sampleType)),
    fetchSusceptibilities(baselineStart, start, true, ward, normSample(opts.sampleType)),
  ]);
  const baselineResults = resultsByIsolate(baselineSus);
  const baselineFirst = firstIsolates(baselineIso).filter((i) => i.organism === opts.organism);

  const wardRows = meta.wards
    .filter((w) => w !== ALL_WARDS)
    .map((w) => {
      const wardOrg = firstOrg.filter((i) => i.ward === w);
      let s = 0;
      let r = 0;
      for (const iso of wardOrg) {
        const res = resultsAll.get(iso.id);
        if (!res) continue;
        s += res.s;
        r += res.r;
      }
      const nCell = s + r;
      const rPct = nCell > 0 ? round1((r / nCell) * 100) : null;
      let bs = 0;
      let br = 0;
      for (const iso of baselineFirst) {
        if (iso.ward !== w) continue;
        const res = baselineResults.get(iso.id);
        if (!res) continue;
        bs += res.s;
        br += res.r;
      }
      const baseN = bs + br;
      const baselineR = baseN > 0 ? round1((br / baseN) * 100) : null;
      return {
        ward: w,
        n: wardOrg.length,
        rPct,
        baselineR,
        tone: toneForR(rPct ?? 0, nCell, baselineR),
      };
    })
    .sort((a, b) => b.n - a.n || (a.ward < b.ward ? -1 : 1));

  return {
    organism: opts.organism,
    ward: opts.ward || ALL_WARDS,
    sampleType: normSample(opts.sampleType) || null,
    asOf: opts.asOf || null,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    generatedAt: new Date().toISOString(),
    n: firstOrg.length,
    sharePct: sharePct(firstOrg.length, firstAll.length),
    specimen,
    cells,
    monthly,
    wards: wardRows,
  };
}

// ── Data explorer ─────────────────────────────────────────────────────

/** Age-band label from birth year at a reference year (dataset has no birth dates). */
function ageBandLabel(birthYear: number, refYear: number): string {
  const age = refYear - birthYear;
  const band = AGE_BANDS.find(
    (b) => age >= b.minAge && (b.maxAge === undefined || age <= b.maxAge),
  );
  return band ? band.label : "—";
}

export async function getExplore(opts: {
  ward?: string;
  sampleType?: string | null;
  organism?: string | null;
  antibiotic?: string | null;
  result?: string | null; // "S" | "R"
  sex?: string | null;
  ageBand?: string | null;
  from?: string | null;
  to?: string | null;
  page?: number;
  pageSize?: number;
}): Promise<ExploreResponse> {
  return cachedByDataMax("explore", opts, () => computeExplore(opts));
}

async function computeExplore(opts: {
  ward?: string;
  sampleType?: string | null;
  organism?: string | null;
  antibiotic?: string | null;
  result?: string | null;
  sex?: string | null;
  ageBand?: string | null;
  from?: string | null;
  to?: string | null;
  page?: number;
  pageSize?: number;
}): Promise<ExploreResponse> {
  const ward = scopeWard(opts.ward);
  const sampleType = normSample(opts.sampleType) && normSample(opts.sampleType) !== FILTER_ALL ? normSample(opts.sampleType) : null;
  const organism = opts.organism && opts.organism !== FILTER_ALL ? opts.organism : null;
  const antibiotic = opts.antibiotic && opts.antibiotic !== FILTER_ALL ? opts.antibiotic : null;
  const result = opts.result === "S" || opts.result === "R" ? opts.result : null;
  const sex = opts.sex && opts.sex !== FILTER_ALL ? opts.sex : null;
  const ageBandId = opts.ageBand && opts.ageBand !== FILTER_ALL ? opts.ageBand : null;
  const band = AGE_BANDS.find((b) => b.id === ageBandId);
  const from = opts.from ? new Date(opts.from) : null;
  const to = opts.to ? new Date(opts.to) : null;
  const refYear = (to ?? (await resolveAnchor(null))).getUTCFullYear();

  const cultureWhere: Prisma.CultureWhereInput = {
    ...(ward ? { ward } : {}),
    ...(sampleType ? { sampleType } : {}),
    ...(sex || band
      ? {
          patient: {
            ...(sex ? { sex } : {}),
            ...(band
              ? {
                  birthYear: {
                    gte: refYear - (band.maxAge ?? 999),
                    lte: refYear - band.minAge,
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(from || to
      ? { takenAt: { ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}), ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}) } }
      : {}),
  };

  const isolateWhere: Prisma.IsolateWhereInput = {
    ...(organism ? { organism } : {}),
    // result works standalone (≥1 R or S on the panel); combined with an
    // antibiotic it requires that specific pair.
    ...(antibiotic && result
      ? { susceptibilities: { some: { antibiotic, result } } }
      : result
        ? { susceptibilities: { some: { result } } }
        : antibiotic
          ? { susceptibilities: { some: { antibiotic } } }
          : {}),
    culture: cultureWhere,
  };

  const pageSize = Math.min(Math.max(opts.pageSize ?? EXPLORE_PAGE_SIZE, 10), 200);
  const page = Math.max(opts.page ?? 1, 1);

  const [total, isolateRows] = await Promise.all([
    db.isolate.count({ where: isolateWhere }),
    db.isolate.findMany({
      where: isolateWhere,
      orderBy: { culture: { takenAt: "desc" } },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        organism: true,
        culture: {
          select: {
            takenAt: true,
            ward: true,
            sampleType: true,
            patient: { select: { sex: true, birthYear: true } },
          },
        },
        susceptibilities: { select: { antibiotic: true, result: true } },
      },
    }),
  ]);

  const rows = isolateRows.map((row) => {
    const resistant: string[] = [];
    const susceptible: string[] = [];
    let untested = 0;
    for (const sus of row.susceptibilities) {
      if (sus.result === "R") resistant.push(sus.antibiotic);
      else if (sus.result === "S") susceptible.push(sus.antibiotic);
      else untested += 1;
    }
    return {
      isolateId: row.id,
      date: row.culture.takenAt.toISOString(),
      ward: row.culture.ward,
      sampleType: row.culture.sampleType,
      organism: row.organism,
      patientSex: row.culture.patient.sex,
      patientAgeBand: ageBandLabel(row.culture.patient.birthYear, refYear),
      resistant,
      susceptible,
      untested,
    };
  });

  return { rows, total, page, pageSize, generatedAt: new Date().toISOString() };
}

// ── Ward-vs-ward statistical comparison ───────────────────────────────
// Between-unit benchmarking per surveillance practice (EARS-Net / NHSN /
// PHE funnel methodology): Wilson CIs everywhere, pairwise two-proportion
// z-tests with Benjamini–Hochberg FDR control, binomial funnel limits
// against the hospital mean. Comparisons stay within one organism (+
// optional antibiotic) to limit case-mix confounding.

export async function getWardCompare(opts: {
  organism: string;
  antibiotic?: string | null;
  sampleType?: string | null;
  asOf?: string | null;
}): Promise<WardCompareResponse> {
  return cachedByDataMax("ward-compare", opts, () => computeWardCompare(opts));
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

async function computeWardCompare(opts: {
  organism: string;
  antibiotic?: string | null;
  sampleType?: string | null;
  asOf?: string | null;
}): Promise<WardCompareResponse> {
  const { start, end } = windowRange("4w", await resolveAnchor(opts.asOf), opts.asOf);
  const baselineStart = new Date(start.getTime() - BASELINE_DAYS * DAY_MS);
  const [isolates, susRows, baselineIso, baselineSus, meta] = await Promise.all([
    fetchIsolates(start, end, false, undefined, normSample(opts.sampleType)),
    fetchSusceptibilities(start, end, false, undefined, normSample(opts.sampleType)),
    fetchIsolates(baselineStart, start, true, undefined, normSample(opts.sampleType)),
    fetchSusceptibilities(baselineStart, start, true, undefined, normSample(opts.sampleType)),
    getMeta(),
  ]);
  const firstAll = firstIsolates(isolates);
  const orgIso = firstAll.filter((i) => i.organism === opts.organism);
  const baselineFirst = firstIsolates(baselineIso).filter((i) => i.organism === opts.organism);
  const results = resultsByIsolate(susRows);
  const baselineResults = resultsByIsolate(baselineSus);
  const index = resultIndex(susRows);
  const baselineIndex = resultIndex(baselineSus);
  const antibiotic =
    opts.antibiotic && opts.antibiotic !== FILTER_ALL ? opts.antibiotic : null;

  // S/R counts for the compared metric over a deduped isolate pool.
  const statFor = (
    pool: IsoRec[],
    resMap: Map<string, IsoResults>,
    resIndex: Map<string, string>,
  ): { r: number; n: number } => {
    let s = 0;
    let r = 0;
    for (const iso of pool) {
      if (antibiotic) {
        const result = resIndex.get(`${iso.id}|${antibiotic}`);
        if (result === "S") s += 1;
        else if (result === "R") r += 1;
      } else {
        const res = resMap.get(iso.id);
        if (!res) continue;
        s += res.s;
        r += res.r;
      }
    }
    return { r, n: s + r };
  };

  const hospitalStat = statFor(orgIso, results, index);
  const hospitalPct = hospitalStat.n > 0 ? (hospitalStat.r / hospitalStat.n) * 100 : 0;
  const hospitalCi = wilsonPct(hospitalStat.r, hospitalStat.n);
  const Z998 = 3.0; // 3σ funnel limit ("99.8%")

  const wards: FunnelPoint[] = [];
  for (const w of meta.wards.filter((x) => x !== ALL_WARDS)) {
    const pool = orgIso.filter((i) => i.ward === w);
    if (pool.length === 0) continue;
    const { r, n } = statFor(pool, results, index);
    if (n === 0) continue;
    const baseline = statFor(
      baselineFirst.filter((i) => i.ward === w),
      baselineResults,
      baselineIndex,
    );
    const baselineR = baseline.n > 0 ? round1((baseline.r / baseline.n) * 100) : null;
    const rPct = round1((r / n) * 100);
    const ci = wilsonPct(r, n);
    // Binomial control limits around the hospital mean, scaled to n.
    const se = Math.sqrt((hospitalPct / 100) * (1 - hospitalPct / 100) / n) * 100;
    const lower95 = Math.max(0, hospitalPct - Z95 * se);
    const upper95 = Math.min(100, hospitalPct + Z95 * se);
    const lower998 = Math.max(0, hospitalPct - Z998 * se);
    const upper998 = Math.min(100, hospitalPct + Z998 * se);
    const flag: FunnelPoint["flag"] =
      rPct > upper998
        ? "above998"
        : rPct > upper95
          ? "above95"
          : rPct < lower95
            ? "below95"
            : "none";
    wards.push({
      ward: w,
      isolates: pool.length,
      n,
      r,
      rPct,
      ciLo: round1(ci.lo),
      ciHi: round1(ci.hi),
      baselineR,
      tone: toneForR(rPct, n, baselineR, antibiotic),
      lower95: round1(lower95),
      upper95: round1(upper95),
      lower998: round1(lower998),
      upper998: round1(upper998),
      flag,
    });
  }
  wards.sort((a, b) => b.rPct - a.rPct || b.n - a.n || (a.ward < b.ward ? -1 : 1));

  // Pairwise tests only between wards with reportable cells (n ≥ MIN).
  const testable = wards.filter((w) => w.n >= MIN_ISOLATES);
  const pairs: WardPair[] = [];
  for (let i = 0; i < testable.length; i++) {
    for (let j = i + 1; j < testable.length; j++) {
      const a = testable[i]!;
      const b = testable[j]!;
      const z = twoProportionZ(a.r, a.n, b.r, b.n);
      const p = normalTwoSidedP(z);
      pairs.push({
        a: a.ward,
        b: b.ward,
        rPctA: a.rPct,
        rPctB: b.rPct,
        diffPp: round1(a.rPct - b.rPct),
        z: Math.round(z * 100) / 100,
        p,
        pAdj: 0, // filled by the BH step-up below
        significant: false,
      });
    }
  }
  // Benjamini–Hochberg FDR adjustment across all tested pairs.
  const adjusted = benjaminiHochberg(pairs.map((p) => p.p));
  pairs.forEach((p, i) => {
    p.pAdj = adjusted[i]!;
    p.significant = p.pAdj < 0.05;
  });
  pairs.sort((a, b) => a.p - b.p || (a.a < b.a ? -1 : 1));

  return {
    organism: opts.organism,
    antibiotic,
    sampleType: normSample(opts.sampleType) || null,
    asOf: opts.asOf || null,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    generatedAt: new Date().toISOString(),
    metric: antibiotic ?? "Overall panel",
    wards,
    hospital: {
      rPct: round1(hospitalPct),
      ciLo: round1(hospitalCi.lo),
      ciHi: round1(hospitalCi.hi),
      n: hospitalStat.n,
      r: hospitalStat.r,
    },
    pairs,
    pairsTested: pairs.length,
    pairsSignificant: pairs.filter((p) => p.significant).length,
    methodology: [
      "% resistant = R/(S+R) on first isolates per patient per organism (EARS-Net); intermediate results ignored.",
      `Wilson 95% confidence intervals per ward; hospital-wide mean computed over all first isolates in scope.`,
      `Pairwise two-proportion z-tests (pooled), Benjamini–Hochberg FDR 5% across all ${pairs.length} pairs; only wards with n ≥ ${MIN_ISOLATES} results are tested.`,
      "Funnel limits: binomial 95% and 99.8% (3σ) control limits around the hospital-wide mean — wards above the upper limit have significantly higher resistance than expected for their volume.",
      "Comparisons stay within one organism (and antibiotic) to limit case-mix confounding; specimen-type and patient mix can still differ between wards.",
      "Population-level surveillance only — statistical differences do not establish cause, responsibility, or outbreak status.",
    ],
  };
}
