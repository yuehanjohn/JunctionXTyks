"use client";

import type { ReactNode } from "react";

import { Delta } from "@/components/ui";
import type { OverviewResponse } from "@/lib/types";

import { TintedIcon } from "./bits";
import { fmtNum } from "./format";

function FlaskIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3v6l-5.4 9A2 2 0 0 0 5.3 21h13.4a2 2 0 0 0 1.7-3L15 9V3" />
      <path d="M8 3h8" />
    </svg>
  );
}

function AlertTriangleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function MicroscopeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 18h8" />
      <path d="M3 22h18" />
      <path d="M14 22a7 7 0 1 0 0-14h-1" />
      <path d="M9 14h2" />
      <path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z" />
      <path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3" />
    </svg>
  );
}

function TrendingUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 7 13.5 15.5 8.5 10.5 2 17" />
      <path d="M16 7h6v6" />
    </svg>
  );
}

/** One white KPI card: label, big tabular value, small comparison line, tinted icon. */
function KpiCard({
  label,
  tone,
  icon,
  value,
  sub,
}: {
  label: string;
  tone: string;
  icon: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[10px] border border-border bg-card p-5">
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold leading-tight text-foreground tabular-nums">
          {value}
        </div>
        {sub ? <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">{sub}</div> : null}
      </div>
      <TintedIcon tone={tone}>{icon}</TintedIcon>
    </div>
  );
}

/** No-data wording for one KPI slot instead of a fake zero. */
function NoData() {
  return <span className="text-sm font-normal text-muted-foreground">No isolates in this window</span>;
}

/** "vs previous 4 weeks" tail shared by the delta KPIs. */
function VsPrev({ delta, kind, goodWhenUp }: { delta: number; kind: "pct" | "pp"; goodWhenUp: boolean }) {
  return (
    <>
      <Delta delta={delta} kind={kind} goodWhenUp={goodWhenUp} />
      <span>vs previous 4 weeks</span>
    </>
  );
}

export function KpiRow({ overview }: { overview: OverviewResponse }) {
  const k = overview.kpis;
  // Every KPI derives from the same window; if it holds no isolates none of
  // them has data — render the explicit empty state instead of zeros.
  const noData = k.totalIsolates.value === 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label="Total isolates (first isolates)"
        tone="bg-primary/10 text-primary"
        icon={<FlaskIcon />}
        value={noData ? <NoData /> : String(k.totalIsolates.value)}
        sub={noData ? undefined : <VsPrev delta={k.totalIsolates.delta} kind={k.totalIsolates.deltaKind} goodWhenUp />}
      />
      <KpiCard
        label="Resistant isolates (all antibiotics)"
        tone="bg-danger/10 text-danger"
        icon={<AlertTriangleIcon />}
        value={
          noData ? (
            <NoData />
          ) : k.resistantPct ? (
            `${fmtNum(k.resistantPct.value)}%`
          ) : (
            "—"
          )
        }
        sub={
          noData || !k.resistantPct ? undefined : (
            <VsPrev delta={k.resistantPct.delta} kind={k.resistantPct.deltaKind} goodWhenUp={false} />
          )
        }
      />
      <KpiCard
        label="Most common organism"
        tone="bg-muted text-muted-foreground"
        icon={<MicroscopeIcon />}
        value={
          noData ? (
            <NoData />
          ) : k.mostCommonOrganism ? (
            <span className="text-xl">{k.mostCommonOrganism.organism}</span>
          ) : (
            "—"
          )
        }
        sub={
          noData || !k.mostCommonOrganism ? undefined : (
            <span>
              {fmtNum(k.mostCommonOrganism.sharePct)}% of isolates · n={k.mostCommonOrganism.n}
            </span>
          )
        }
      />
      <KpiCard
        label="Highest resistance"
        tone="bg-danger/10 text-danger"
        icon={<TrendingUpIcon />}
        value={
          noData ? (
            <NoData />
          ) : k.highestResistance ? (
            `${fmtNum(k.highestResistance.rPct)}%`
          ) : (
            "—"
          )
        }
        sub={
          noData ? undefined : k.highestResistance ? (
            <span className="truncate">
              {k.highestResistance.organism} to {k.highestResistance.antibiotic}
            </span>
          ) : (
            <span>No cell reached 30 isolates</span>
          )
        }
      />
    </div>
  );
}
