"use client";

import { useId } from "react";
import type { ReactNode } from "react";

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
