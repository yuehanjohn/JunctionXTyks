"use client";

import Link from "next/link";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { SeverityBadge, bandColor } from "@/components/ui";
import type { AlertInvestigationResponse, ResistancePoint, Signal } from "@/lib/types";

import { fmtNum, fmtSigned } from "./format";

type BarsTooltipEntry = { payload?: ResistancePoint };

function BarsTooltip({ active, payload }: { active?: boolean; payload?: BarsTooltipEntry[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-sm tabular-nums">
      <span className="font-semibold text-foreground">{p.label}</span>
      <span className="ml-2 text-muted-foreground">
        {fmtNum(p.rPct)}% · n={p.n}
      </span>
    </div>
  );
}

/** Daily % resistant across the current 4-week window, tinted by the shared heatmap scale. */
function SignalBars({ points, antibiotic }: { points: ResistancePoint[]; antibiotic: string | null }) {
  return (
    <div className="h-20">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <XAxis dataKey="label" hide />
          <YAxis domain={[0, 100]} hide />
          <Tooltip content={<BarsTooltip />} cursor={{ fill: "var(--muted)" }} />
          <Bar dataKey="rPct" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {points.map((p) => (
              <Cell key={p.date} fill={bandColor(p.rPct, antibiotic)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Shimmering placeholder while the investigation request is in flight. */
function BarsSkeleton() {
  return (
    <div className="flex h-20 items-end gap-[3px]" aria-hidden="true">
      {Array.from({ length: 28 }, (_, i) => (
        <div
          key={i}
          className="w-full min-w-0 flex-1 animate-pulse rounded-sm bg-muted"
          style={{ height: `${25 + ((i * 37) % 60)}%` }}
        />
      ))}
    </div>
  );
}

/**
 * Right-hand alert card. Tinted red while the scope has live signals; shows
 * the top signal plus its investigated daily series. The investigation fetch
 * lives in the page — this card only renders it, so the KPI row never waits.
 */
export function AlertCard({
  alertCount,
  topSignal,
  investigation,
  busy,
}: {
  alertCount: number;
  topSignal: Signal | null;
  investigation: AlertInvestigationResponse | null;
  busy: boolean;
}) {
  const tinted = alertCount > 0;
  // Window is [windowStart, windowEnd): 28 daily buckets, same span as the trend chart.
  const windowPoints =
    investigation?.points.filter(
      (p) => p.date >= investigation.signal.windowStart && p.date < investigation.signal.windowEnd,
    ) ?? [];

  return (
    <div
      className={`min-w-0 rounded-[10px] border p-5 ${
        tinted ? "border-danger/30 bg-danger/5" : "border-border bg-card"
      }`}
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-foreground">
          {tinted
            ? `${alertCount} significant ${alertCount === 1 ? "alert" : "alerts"}`
            : "No significant alerts"}
        </h2>
        <Link href="/alerts" className="text-xs font-medium text-primary hover:underline">
          View all →
        </Link>
      </div>

      {!topSignal ? (
        <p className="py-4 text-[13px] text-muted-foreground">
          No emerging resistance signals detected in this window.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {topSignal.organism} resistance to {topSignal.antibiotic}
            </span>
            <SeverityBadge severity={topSignal.severity} />
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            in {topSignal.ward} has changed from {fmtNum(topSignal.baselineS)}% to{" "}
            {fmtNum(topSignal.windowS)}% susceptible in the last 4 weeks (z{" "}
            {fmtSigned(topSignal.z)}).
          </p>
          <div className={`mt-3 ${busy ? "opacity-60" : ""}`}>
            {investigation ? (
              <>
                <SignalBars points={windowPoints} antibiotic={topSignal.antibiotic} />
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  Daily % resistant — current 4-week window
                </div>
              </>
            ) : (
              <BarsSkeleton />
            )}
          </div>
        </>
      )}
    </div>
  );
}
