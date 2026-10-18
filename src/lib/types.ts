// ── Shared API contract ──────────────────────────────────────────────
// Every API route and UI slice implements/consumes exactly these shapes.

export type WindowKey = "4w" | "1y";

/** One organism × antibiotic susceptibility cell. sPct = % susceptible (S of S+R). */
export interface SusCell {
  antibiotic: string;
  /** % susceptible, 0–100 */
  sPct: number;
  /** number of first isolates (S+R) behind the percentage */
  n: number;
  /** Wilson 95% CI on sPct */
  ciLo: number;
  ciHi: number;
  /** n >= MIN_ISOLATES */
  sufficient: boolean;
}

export interface OrganismRow {
  organism: string;
  /** isolates for this organism in the period */
  n: number;
  cells: SusCell[];
}

export interface AntibiogramResponse {
  ward: string; // ward name or "All wards"
  sampleType: string | null;
  /** patient sex filter: "F" | "M" or null (all) */
  sex: string | null;
  /** age-band filter id (AGE_BANDS) or null (all) */
  ageBand: string | null;
  window: WindowKey;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  rows: OrganismRow[];
}

/** Age band over birth year, resolved against the window end. */
export interface AgeBand {
  id: string;
  label: string;
  minAge: number;
  /** undefined = open-ended upper bound */
  maxAge?: number;
}

/** Dataset patient demographics available as filters (challenge: "filter results
 *  based on dataset parameters" — patients carry sex and birth_year). */
export const AGE_BANDS: AgeBand[] = [
  { id: "0-17", label: "0–17", minAge: 0, maxAge: 17 },
  { id: "18-64", label: "18–64", minAge: 18, maxAge: 64 },
  { id: "65+", label: "65+", minAge: 65 },
];

/** Sentinel filter value meaning "no filter" (kept out of API params). */
export const FILTER_ALL = "all";

/** Prisma birth-year range for a band at a reference year (age ≈ year − birthYear). */
export function ageBandToBirthYearRange(
  band: AgeBand,
  refYear: number,
): { gte?: number; lte?: number } {
  return {
    ...(band.maxAge !== undefined ? { gte: refYear - band.maxAge } : {}),
    lte: refYear - band.minAge,
  };
}

/** A detected deviation: rolling window vs trailing baseline. */
export interface Signal {
  id: string;
  ward: string;
  organism: string;
  antibiotic: string;
  sampleType: string | null;
  windowS: number; // % susceptible in rolling window
  baselineS: number; // % susceptible in trailing baseline
  dropPp: number; // baselineS - windowS (percentage points)
  z: number;
  nWindow: number;
  nBaseline: number;
  severity: "high" | "moderate" | "watch";
  windowStart: string;
  windowEnd: string;
}

export interface SignalsResponse {
  signals: Signal[];
  scanned: number; // ward×organism×antibiotic cells scanned
  generatedAt: string;
}

export interface TrendPoint {
  /** ISO month start */
  month: string;
  label: string; // e.g. "Jan 24"
  sPct: number;
  n: number;
}

export interface TrendResponse {
  ward: string;
  organism: string;
  antibiotic: string;
  sampleType: string | null;
  sex: string | null;
  ageBand: string | null;
  points: TrendPoint[];
}

export interface MetaResponse {
  wards: string[];
  organisms: string[];
  antibiotics: string[];
  sampleTypes: string[];
  /** distinct patient sexes in the dataset ("F" / "M") */
  sexes: string[];
  dateMin: string;
  dateMax: string;
  generatedAt: string;
}

/** POST /api/advisor body */
export interface AdvisorQuestion {
  question: string;
  ward?: string;
}

/** POST /api/advisor response */
export interface AdvisorResponse {
  intent: string;
  answer: string;
  bullets: string[];
  table?: { label: string; sPct: number; n: number; sufficient: boolean }[];
  chips: string[]; // suggested follow-up questions
}

/** Minimum isolates for a statistically usable percentage. */
export const MIN_ISOLATES = 30;

// ── Resistance tone model ─────────────────────────────────────────────
// Coloring never maps raw %R onto a fixed green→red scale: what counts as
// "bad" depends on the antibiotic and on whether the level is new. Cells are
// therefore banded by SUSCEPTIBILITY (100 − %R), escalated by their own
// trailing-12-month baseline (WHO GLASS treats trend as a first-class signal)
// and held to a stricter scale for last-line agents (carbapenems: ECDC's
// "low" bound is <5% resistance).

export type CellTone = "good" | "elevated" | "poor" | "insufficient";

/** ≥90% susceptible reads good (EUCAST-style antibiogram convention). */
export const TONE_GOOD_S = 90;
/** 70–90% susceptible reads elevated; below 70% reads poor. */
export const TONE_ELEVATED_S = 70;
/** A ≥10 pp resistance rise vs baseline escalates the tone one band: a level
 *  that is unremarkable when stable can be a serious deterioration when new
 *  (e.g. 3% → 15% on a carbapenem). */
export const TONE_ESCALATE_PP = 10;

/** Last-line agents (carbapenems) are judged on a stricter scale: ECDC/EARS-Net
 *  describes carbapenem resistance below 5% as "low" and counts ≥1% as
 *  notable, so ≥5% must never read as good. */
export const TONE_LASTLINE_LOW_R = 5;
/** ≥25% resistance to a last-line agent is always poor (ECDC treats ≥25%
 *  carbapenem resistance in K. pneumoniae as serious concern). */
export const TONE_LASTLINE_HIGH_R = 25;

const CARBAPENEM_RE = /\b(meropenem|imipenem|ertapenem|doripenem)\b/i;

/** Tone for a resistance percentage. `baselineR` = trailing-12-month %R for
 *  the same cell, or null when no baseline exists. `antibiotic` enables the
 *  last-line rule when a carbapenem is named. n < MIN_ISOLATES →
 *  "insufficient" (never colored). */
export function toneForR(
  rPct: number,
  n: number,
  baselineR: number | null = null,
  antibiotic: string | null = null,
): CellTone {
  if (n < MIN_ISOLATES) return "insufficient";
  const sPct = 100 - rPct;
  let tone: CellTone = sPct >= TONE_GOOD_S ? "good" : sPct >= TONE_ELEVATED_S ? "elevated" : "poor";
  if (baselineR !== null && rPct - baselineR >= TONE_ESCALATE_PP) {
    tone = tone === "good" ? "elevated" : "poor";
  }
  if (antibiotic !== null && CARBAPENEM_RE.test(antibiotic) && rPct >= TONE_LASTLINE_LOW_R) {
    tone = rPct >= TONE_LASTLINE_HIGH_R ? "poor" : tone === "good" ? "elevated" : tone;
  }
  return tone;
}

/** Rolling window in days. */
export const ROLLING_DAYS = 28;
/** Baseline = trailing 12 months before the rolling window. */
export const BASELINE_DAYS = 365;

// ── Live lab-feed demo (simulated LIS ingestion) ──────────────────────

export type IngestScenario = "routine" | "outbreak";

export interface IngestResponse {
  scenario: IngestScenario;
  cultures: number;
  isolates: number;
  susceptibilities: number;
  /** ward the samples landed on (outbreak drill) or null (routine spread) */
  ward: string | null;
  organism: string | null;
  antibiotic: string | null;
  /** newest culture timestamp after ingestion (cache invalidation marker) */
  dataMax: string;
}

/** DELETE /api/ingest — remove every simulated sample. */
export interface IngestResetResponse {
  removed: { cultures: number; isolates: number; susceptibilities: number };
  dataMax: string;
}

// ── AEI Pulse: Overview / heatmaps / investigation / comparison / explorer ──

/** Common filter set for Pulse endpoints. `asOf` = historical replay anchor:
 *  recompute every window as if "now" were that date (clamped into the data
 *  range). Omitted/null = live (newest sample in the data). */
export interface PulseFilters {
  ward?: string;
  sampleType?: string | null;
  /** ISO date-time; must lie within [dateMin, dateMax] to have any effect. */
  asOf?: string | null;
}

/** A bucketed resistance point: % of S/R results that are R. */
export interface ResistancePoint {
  /** bucket start, ISO date */
  date: string;
  label: string; // e.g. "24 Mar"
  rPct: number; // % resistant (R / (S+R))
  n: number; // S+R results behind the percentage
}

/** KPI strip on Overview: each metric carries its rolling-window value and the
 *  comparison against the immediately preceding equal-length window. */
export interface KpiComparison {
  value: number;
  prevValue: number;
  /** percentage change (total isolates) or percentage-point change (shares) */
  delta: number;
  deltaKind: "pct" | "pp";
}

export interface HighestResistanceCell {
  organism: string;
  antibiotic: string;
  rPct: number;
  n: number;
}

export interface OverviewResponse {
  ward: string;
  sampleType: string | null;
  asOf: string | null;
  windowStart: string;
  windowEnd: string;
  prevStart: string;
  prevEnd: string;
  generatedAt: string;
  kpis: {
    totalIsolates: KpiComparison;
    resistantPct: KpiComparison | null; // null when either window has 0 isolates
    mostCommonOrganism: { organism: string; sharePct: number; n: number } | null;
    highestResistance: HighestResistanceCell | null;
  };
  /** daily % resistant for the top organisms in the window (chart series) */
  series: { organism: string; n: number; points: ResistancePoint[] }[];
  /** every signal currently flagged in scope, severity-ranked */
  alerts: Signal[];
  alertCount: number;
  specimen: { sampleType: string; n: number; sharePct: number }[];
  topOrganisms: { organism: string; n: number; sharePct: number }[];
  /** newest isolates, newest first (structured findings; UI composes text) */
  recentIsolates: {
    isolateId: string;
    date: string;
    ward: string;
    organism: string;
    resistant: string[];
    susceptible: string[];
  }[];
}

/** One organism×antibiotic cell broken down per ward ("Overall" included). */
export interface HeatmapCell {
  ward: string;
  rPct: number; // % resistant (R / (S+R))
  n: number;
  sufficient: boolean; // n >= MIN_ISOLATES
  /** trailing-12-month %R for the same cell, null when no baseline data */
  baselineR: number | null;
  /** band + baseline-escalation tone (toneForR) */
  tone: CellTone;
}

export interface HeatmapResponse {
  organism: string;
  ward: string;
  sampleType: string | null;
  asOf: string | null;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  wards: string[]; // column order: "Overall" first, then ward name order
  rows: { antibiotic: string; cells: HeatmapCell[]; overall: HeatmapCell }[];
}

export interface AlertInvestigationResponse {
  signal: Signal;
  /** daily % resistant around the window: windowStart − 60d … windowEnd */
  points: ResistancePoint[];
  /** same cell, hospital-wide, over the same window (context comparison) */
  hospital: { rPct: number; n: number };
  /** same organism+antibiotic, other wards, current window (rank context) */
  wardRank: { ward: string; rPct: number; n: number }[];
  pApprox: number; // two-sided normal-approximation p for the z statistic
  narrative: string; // population-level, surveillance-only wording
  /** investigation workbench: isolate timeline, patient pathways, co-location */
  workbench: Workbench;
  generatedAt: string;
}

export interface WardSummary {
  ward: string;
  isolates: number; // first isolates in window
  resistantPct: number | null; // isolates with ≥1 R, % of first isolates
  topOrganism: string | null;
  topOrganismSharePct: number;
  signals: { high: number; moderate: number; watch: number };
  /** per-organism overall resistance (R / (S+R)) across the standard panel */
  organismResistance: { organism: string; n: number; rPct: number | null; baselineR: number | null; tone: CellTone }[];
}

export interface WardComparisonResponse {
  sampleType: string | null;
  asOf: string | null;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  wards: WardSummary[];
  organisms: string[]; // column order for the ward×organism grid
}

export interface OrganismProfileResponse {
  organism: string;
  ward: string;
  sampleType: string | null;
  asOf: string | null;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  n: number; // first isolates in window
  sharePct: number; // of all first isolates in scope
  specimen: { sampleType: string; n: number; sharePct: number }[];
  cells: SusCell[]; // per-antibiotic susceptibility in window
  /** monthly % resistant per antibiotic, trailing 12 months */
  monthly: { antibiotic: string; points: ResistancePoint[] }[];
  wards: { ward: string; n: number; rPct: number | null; baselineR: number | null; tone: CellTone }[];
}

export interface ExploreRow {
  isolateId: string;
  date: string;
  ward: string;
  sampleType: string;
  organism: string;
  patientSex: string;
  patientAgeBand: string;
  resistant: string[];
  susceptible: string[];
  untested: number; // panel results neither S nor R (none in this dataset)
}

export interface ExploreResponse {
  rows: ExploreRow[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
}

/** Default page size for the Data Explorer. */
export const EXPLORE_PAGE_SIZE = 50;

// ── Ward-vs-ward statistical comparison ───────────────────────────────
// Industry practice for between-unit AMR benchmarking (EARS-Net / NHSN /
// PHE funnel-plot methodology): every proportion carries a Wilson 95% CI,
// pairwise differences are z-tested with Benjamini–Hochberg FDR control,
// and each ward is benchmarked against the hospital mean with binomial
// funnel limits. Percentages are never compared bare.

/** One ward's resistance stat for the compared metric. Wards with no data
 *  for the metric are omitted entirely, so n and rPct are always present. */
export interface WardResistanceStat {
  ward: string;
  /** first isolates of the organism on the ward in the window */
  isolates: number;
  /** S+R results behind rPct */
  n: number;
  /** resistant results */
  r: number;
  rPct: number;
  /** Wilson 95% CI on rPct */
  ciLo: number;
  ciHi: number;
  /** trailing-12-month %R for the same ward/metric, null without baseline */
  baselineR: number | null;
  tone: CellTone;
}

/** Funnel benchmark of one ward against the hospital mean. */
export interface FunnelPoint extends WardResistanceStat {
  /** binomial 95%/99.8% control limits around the hospital mean */
  lower95: number;
  upper95: number;
  lower998: number;
  upper998: number;
  /** which limit the ward's rPct crosses, in the adverse (above) direction */
  flag: "none" | "above95" | "above998" | "below95";
}

/** One pairwise ward comparison (two-proportion z-test, BH-adjusted). */
export interface WardPair {
  a: string;
  b: string;
  rPctA: number;
  rPctB: number;
  /** rPctA − rPctB in percentage points */
  diffPp: number;
  z: number;
  p: number;
  /** Benjamini–Hochberg FDR-adjusted p across all tested pairs */
  pAdj: number;
  /** pAdj < 0.05 */
  significant: boolean;
}

export interface WardCompareResponse {
  organism: string;
  /** null = overall panel resistance (R share of all S/R results) */
  antibiotic: string | null;
  sampleType: string | null;
  asOf: string | null;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  /** human-readable metric label, e.g. "Ciprofloxacin" or "Overall panel" */
  metric: string;
  /** one entry per ward with any data, rPct desc (funnel-ready) */
  wards: FunnelPoint[];
  hospital: { rPct: number; ciLo: number; ciHi: number; n: number; r: number };
  /** every pair of wards with n ≥ MIN_ISOLATES, p-ascending */
  pairs: WardPair[];
  pairsTested: number;
  pairsSignificant: number;
  methodology: string[];
}

// ── Early-warning system: MDRO, detection stack, pathways, sitrep ─────
//
// All detections are statistical hypotheses with evidence attached — never
// confirmed outbreaks, never ward blame, never patient-specific therapy.

// ── MDRO / warning-phenotype engine ───────────────────────────────────

export type MdroClass =
  | "MRSA-type"
  | "VRE"
  | "CRE-proxy"
  | "ESBL-proxy"
  | "3GC-R"
  | "MDR";

export interface MdroDefinition {
  cls: MdroClass;
  definition: string;
}

/** Phenotype assessment of one isolate from its susceptibility panel. */
export interface MdroAssessment {
  phenotypes: MdroClass[];
  /** resistance classes hit (antibiotic-class names), deduped */
  resistantClasses: string[];
  /** total S+R results on the panel */
  n: number;
  /** resistant results */
  r: number;
}

export interface MdroWeeklyPoint {
  /** ISO week start (Monday), ISO date */
  week: string;
  isolates: number;
  /** isolates with ≥1 warning phenotype */
  mdro: number;
  byClass: Partial<Record<MdroClass, number>>;
}

export interface MdroWardRow {
  ward: string;
  isolates: number;
  mdroCount: number;
  mdroPct: number | null;
  byClass: Partial<Record<MdroClass, number>>;
}

export interface MdroRecentIsolate {
  isolateId: string;
  date: string;
  ward: string;
  sampleType: string;
  organism: string;
  phenotypes: MdroClass[];
  resistant: string[];
}

export interface MdroResponse {
  ward: string;
  asOf: string | null;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  weeks: MdroWeeklyPoint[];
  wards: MdroWardRow[];
  recent: MdroRecentIsolate[];
  totalIsolates: number;
  mdroIsolates: number;
  definitions: MdroDefinition[];
}

// ── Unified warning feed (detection stack) ────────────────────────────

export type WarningKind = "proportion-drop" | "count-cusum" | "cluster";

export interface Warning {
  id: string;
  kind: WarningKind;
  ward: string;
  organism: string;
  antibiotic: string | null;
  severity: "high" | "moderate" | "watch";
  /** evidence score, higher = stronger; rank order for the feed */
  score: number;
  headline: string;
  evidence: string;
  windowStart: string;
  windowEnd: string;
  /** involves an MDRO/warning phenotype or a warning organism */
  mdro: boolean;
}

export interface WarningConfig {
  /** CUSUM threshold (accumulated count deviations) */
  cusumH: number;
  /** cluster-scan Poisson p-value threshold */
  clusterP: number;
  /** proportion-drop detector thresholds (existing engine) */
  zThreshold: number;
  dropPpThreshold: number;
}

export interface WarningFeedResponse {
  warnings: Warning[];
  /** tuned baseline false-alarm rate the config was selected against */
  expectedPerMonth: number;
  cellsScanned: number;
  config: WarningConfig;
  /** how the config was chosen */
  budget: string;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
}

// ── Warning timeline (transmission-map replay) ────────────────────────

export interface TimelineWarning {
  kind: WarningKind;
  ward: string;
  organism: string;
  antibiotic: string | null;
  severity: Warning["severity"];
  headline: string;
}

/** One replay step: the warnings that were live at that week's end. */
export interface TimelineWeek {
  weekEnd: string;
  warnings: TimelineWarning[];
}

export interface WarningTimelineResponse {
  /** chronological; the last point is the live week */
  points: TimelineWeek[];
  wards: string[];
  generatedAt: string;
}

// ── Patient-pathway transmission analysis ─────────────────────────────

export interface TransferEdge {
  from: string;
  to: string;
  patients: number;
}

export interface WardFlow {
  ward: string;
  inbound: number;
  outbound: number;
  topInbound: { from: string; patients: number }[];
  topOutbound: { to: string; patients: number }[];
}

export interface PathwaysResponse {
  windowStart: string;
  windowEnd: string;
  /** max days between two cultures for a ward change to count as a transfer */
  transferGapDays: number;
  generatedAt: string;
  edges: TransferEdge[];
  flows: WardFlow[];
  note: string;
}

// ── Alert investigation workbench ─────────────────────────────────────

export interface WorkbenchIsolate {
  isolateId: string;
  date: string;
  ward: string;
  sampleType: string;
  organism: string;
  phenotypes: MdroClass[];
  resistant: string[];
  /** anonymized reference (dataset patient id, no names exist) */
  patientRef: string;
  /** same patient had a same-organism isolate in the previous 30 days */
  repeat: boolean;
}

export interface WorkbenchPathwayStep {
  patientRef: string;
  ward: string;
  date: string;
}

export interface Workbench {
  /** same organism + ward isolates over the trailing 60 days */
  isolates: WorkbenchIsolate[];
  /** ward movements of the involved patients (trailing 60 days) */
  pathway: WorkbenchPathwayStep[];
  /** distinct patients with the same organism on the ward within 14 days */
  colocatedPatients: number;
  /** inbound ward transfers among involved patients, by source ward */
  importAttribution: { from: string; patients: number }[];
  checklist: string[];
}

// ── Automated sitrep ──────────────────────────────────────────────────

export interface SitrepResponse {
  ward: string;
  asOf: string | null;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  markdown: string;
}

// ── Backtesting harness ───────────────────────────────────────────────

export interface BacktestScenarioResult {
  scenario: string;
  description: string;
  detected: boolean;
  /** days from scenario start to first matching warning; null if missed */
  latencyDays: number | null;
  detectingKinds: WarningKind[];
}

export interface BacktestMetrics {
  scenarios: BacktestScenarioResult[];
  /** false alarms per month over the outbreak-free synthetic baseline */
  falseAlarmsPerMonth: number;
  cleanPeriodDays: number;
  alertsInCleanPeriod: number;
  /** TP / (TP + FP) across scenario horizon, null when no alerts fired */
  ppv: number | null;
  config: { cusumH: number; clusterP: number };
  runtimeMs: number;
  methodology: string[];
}

export interface BacktestResponse extends BacktestMetrics {
  generatedAt: string;
}
