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
  window: WindowKey;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  rows: OrganismRow[];
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
  points: TrendPoint[];
}

export interface MetaResponse {
  wards: string[];
  organisms: string[];
  antibiotics: string[];
  sampleTypes: string[];
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

/** Rolling window in days. */
export const ROLLING_DAYS = 28;
/** Baseline = trailing 12 months before the rolling window. */
export const BASELINE_DAYS = 365;
