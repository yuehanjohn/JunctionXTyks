"use client";

import type { ReactNode } from "react";

import { Badge } from "@/components/ui";
import type { MdroClass, WarningConfig, WarningKind } from "@/lib/types";

/**
 * JSON fetch with error unwrapping, shared by the early-warning page and the
 * lazy backtest card (same pattern as the trends page).
 */
export async function loadJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

/** SVG presentation attributes cannot use CSS var(), so chart colors are
 *  literals mirroring the tokens in globals.css (same pattern as trends). */
export const C = {
  primary: "#0F6B7C",
  danger: "#B3261E",
  border: "#E3E6EA",
} as const;

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const NUM_1 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

/** ISO datetime → "2 Feb". */
export function fmtShort(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DAY_MONTH.format(d);
}

/** ISO datetime → "2 Feb 2026". */
export function fmtDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DAY_MONTH_YEAR.format(d);
}

/** "2 Feb 2026 – 1 Mar 2026" for a window pair. */
export function fmtWindow(startIso: string, endIso: string): string {
  return `${fmtDay(startIso)} – ${fmtDay(endIso)}`;
}

/** Shared 1-decimal formatting for counts and rates. */
export function fmtNum(v: number): string {
  return NUM_1.format(v);
}

export const KIND_LABELS: Record<WarningKind, string> = {
  "proportion-drop": "proportion-drop",
  "count-cusum": "count-CUSUM",
  cluster: "cluster",
};

/** Detector-kind pill (count-cusum renders with the API's spelling). */
export function KindChip({ kind }: { kind: WarningKind }) {
  return <Badge tone="neutral">{KIND_LABELS[kind]}</Badge>;
}

/** Tuning-parameter chips so readers know which thresholds produced the feed. */
export function ConfigChips({ config }: { config: WarningConfig }) {
  return (
    <>
      <Badge tone="neutral">CUSUM h = {config.cusumH}</Badge>
      <Badge tone="neutral">cluster p &lt; {config.clusterP}</Badge>
      <Badge tone="neutral">z ≥ {config.zThreshold}</Badge>
      <Badge tone="neutral">drop ≥ {config.dropPpThreshold} pp</Badge>
    </>
  );
}

const MDRO_CLASS_ORDER: MdroClass[] = [
  "MRSA-type",
  "VRE",
  "CRE-proxy",
  "ESBL-proxy",
  "3GC-R",
  "MDR",
];

/** Count chips for a per-ward MDRO class mix; em dash when empty. */
export function MdroClassChips({ byClass }: { byClass: Partial<Record<MdroClass, number>> }) {
  const entries = MDRO_CLASS_ORDER.map((cls) => [cls, byClass[cls] ?? 0] as const).filter(
    ([, n]) => n > 0,
  );
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([cls, n]) => (
        <Badge key={cls} tone="neutral">
          {cls} {n}
        </Badge>
      ))}
    </div>
  );
}

/** Phenotype pills for a recent isolate; em dash when none. */
export function PhenotypeChips({ phenotypes }: { phenotypes: MdroClass[] }) {
  if (phenotypes.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {phenotypes.map((p) => (
        <Badge key={p} tone="neutral">
          {p}
        </Badge>
      ))}
    </div>
  );
}

/** Card heading row: title (+ optional sub) left, meta right. */
export function CardHeading({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {sub ? <p className="mt-0.5 text-[12px] text-muted-foreground">{sub}</p> : null}
      </div>
      {right ? (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          {right}
        </div>
      ) : null}
    </div>
  );
}

/** Soft-refresh indicator: pulsing petrol dot + label. */
export function Busy({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
      {label}
    </span>
  );
}

/** Skeleton placeholder for a first load, with an optional progress hint. */
export function SkeletonCard({ hint, rows = 3 }: { hint?: string; rows?: number }) {
  return (
    <div>
      <div aria-hidden className="animate-pulse">
        <div className="h-4 w-52 rounded bg-muted" />
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="mt-3 h-3 rounded bg-muted"
            style={{ width: `${86 - i * 17}%` }}
          />
        ))}
      </div>
      {hint ? <p className="mt-4 text-[12px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Inline "this section failed" block with a retry (rendered inside a Card). */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="py-6 text-center">
      <p className="text-sm font-medium text-danger">Couldn&apos;t load this section</p>
      <p className="mt-1 text-[12px] text-muted-foreground">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 h-8 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
      >
        Retry
      </button>
    </div>
  );
}
