// Page-scoped formatting + palette helpers for the Overview screen.
// Pure functions only (no JSX) so both .tsx components and the page import freely.

/** Sentinel ward value meaning "no ward filter" (hospital-wide scope). */
export const ALL_WARDS = "All wards";

/** Fixed per-organism line palette for the trend chart (spec-ordered). */
export const SERIES_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ca8a04"];

/** Donut colors per specimen type; anything else falls back to petrol. */
export const SPECIMEN_COLORS: Record<string, string> = {
  urine: "#2563eb",
  blood: "#dc2626",
  wound: "#16a34a",
};
export const FALLBACK_SPECIMEN_COLOR = "#0f6b7c";

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const HOUR_MINUTE = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

function dateOf(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "24 Mar" */
export function fmtDayMonth(iso: string): string {
  const d = dateOf(iso);
  return d ? DAY_MONTH.format(d) : "—";
}

/** "18 Sep – 16 Oct" within one year, "28 Dec 2025 – 24 Jan 2026" across years. */
export function fmtWindow(startIso: string, endIso: string): string {
  const start = dateOf(startIso);
  const end = dateOf(endIso);
  if (!start || !end) return "—";
  if (start.getFullYear() === end.getFullYear()) {
    return `${DAY_MONTH.format(start)} – ${DAY_MONTH.format(end)}`;
  }
  return `${DAY_MONTH_YEAR.format(start)} – ${DAY_MONTH_YEAR.format(end)}`;
}

/** "14:32" for "Last updated" footer. */
export function fmtTime(iso: string): string {
  const d = dateOf(iso);
  return d ? HOUR_MINUTE.format(d) : "—";
}

/** One decimal max, trailing ".0" stripped — lockstep rounding across the page. */
export function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Signed value with a typographic minus, e.g. "z −3.4". */
export function fmtSigned(v: number): string {
  return `${v < 0 ? "−" : "+"}${fmtNum(Math.abs(v))}`;
}
