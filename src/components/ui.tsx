"use client";

import { useId } from "react";
import type { ReactNode } from "react";
import type { CellTone } from "@/lib/types";
import { toneForR } from "@/lib/types";

/** Light clinical card: white surface, 10px radius, border only. */
export function Card({
  className = "",
  children,
  padding = "p-5",
}: {
  className?: string;
  children: ReactNode;
  /** p-6 is reserved for the antibiogram matrix card; everything else stays p-5. */
  padding?: "p-5" | "p-6";
}) {
  return (
    <div className={`rounded-[10px] border border-border bg-card ${padding} ${className}`}>
      {children}
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

/** Labeled native select with the app's control styling. */
export function Select({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-[12px] font-medium text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export type BadgeTone = "neutral" | "success" | "warning" | "danger";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
};

/** Small pill for statuses and cautions. */
export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Signed change indicator: ▲/▼ with pp or % suffix. `goodWhenUp` flips the
 *  color semantics (susceptibility up = good; resistance up = bad). */
export function Delta({
  delta,
  kind,
  goodWhenUp = true,
}: {
  delta: number;
  kind: "pct" | "pp";
  goodWhenUp?: boolean;
}) {
  if (!Number.isFinite(delta)) return null;
  const up = delta > 0;
  const good = up === goodWhenUp;
  const color = delta === 0 ? "text-muted-foreground" : good ? "text-success" : "text-danger";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[13px] font-semibold ${color}`}>
      {delta === 0 ? "±" : up ? "↑" : "↓"}
      {Math.abs(delta).toFixed(1)}
      {kind === "pp" ? " pp" : "%"}
    </span>
  );
}

const SEVERITY_TONE: Record<"high" | "moderate" | "watch", BadgeTone> = {
  high: "danger",
  moderate: "warning",
  watch: "neutral",
};

/** Signal severity pill with the same wording as the Alerts screen. */
export function SeverityBadge({ severity }: { severity: "high" | "moderate" | "watch" }) {
  return <Badge tone={SEVERITY_TONE[severity]}>{severity}</Badge>;
}

/**
 * Tone fills for resistance cells. Semantics live in toneForR (types.ts):
 * ≥90% S good, 70–90% elevated, <70% poor; ≥10 pp rise vs the cell's own
 * trailing-12-month baseline escalates one band; ≥5% resistance to a last-line
 * agent (carbapenems) escalates one band and ≥25% is always poor; n<30 never
 * gets colored.
 *
 * Palette: Okabe–Ito-derived tints (bluish green / orange / vermillion) with
 * a lightness ramp (89% → 84% → 82%) so the bands stay ordered and
 * distinguishable under red–green vision deficiency (~8% of men) — hue and
 * lightness both encode rank.
 */
const TONE_FILL: Record<CellTone, string> = {
  good: "hsl(165 55% 89%)",
  elevated: "hsl(38 100% 84%)",
  poor: "hsl(12 85% 82%)",
  insufficient: "hsl(220 10% 93%)",
};

export function toneColor(tone: CellTone): string {
  return TONE_FILL[tone];
}

/** Band-only tone color for bucketed series points (no per-point baseline). */
export function bandColor(rPct: number, antibiotic: string | null = null): string {
  return toneColor(toneForR(rPct, Number.MAX_SAFE_INTEGER, null, antibiotic));
}

/** Shared legend explaining the tone bands; add under any tone-tinted table. */
export function ToneLegend({ extra }: { extra?: string }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {(
        [
          ["good", "≥90% S"],
          ["elevated", "70–90% S"],
          ["poor", "<70% S"],
        ] as [CellTone, string][]
      ).map(([tone, label]) => (
        <span key={tone} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-4 rounded-sm border border-border"
            style={{ backgroundColor: TONE_FILL[tone] }}
          />
          {label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block h-2.5 w-4 rounded-sm border border-border"
          style={{ backgroundColor: TONE_FILL.insufficient }}
        />
        n&lt;30
      </span>
      <span>
        ≥10 pp rise vs 12-month baseline escalates one band · carbapenems: ≥5% R escalates, ≥25% R
        always poor{extra ? ` · ${extra}` : ""}
      </span>
    </div>
  );
}

