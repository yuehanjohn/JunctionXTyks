"use client";

import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, toneColor } from "@/components/ui";
import type { MdroResponse, MdroWeeklyPoint } from "@/lib/types";
import { toneForR } from "@/lib/types";

import {
  Busy,
  C,
  CardHeading,
  EmptyHint,
  LoadError,
  MdroClassChips,
  PhenotypeChips,
  SkeletonCard,
  fmtDay,
  fmtNum,
  fmtShort,
  fmtWindow,
} from "./bits";

type WeekRow = MdroWeeklyPoint & { label: string };

/** recharts clones this element with { active, payload, ... } per hover. */
function WeekTooltip(props: { active?: boolean; payload?: { payload?: unknown }[] }) {
  const { active, payload } = props;
  const row = active && payload?.[0]?.payload ? (payload[0].payload as WeekRow) : null;
  if (!row) return null;
  const classes = Object.entries(row.byClass)
    .map(([cls, n]) => [cls, n ?? 0] as const)
    .filter(([, n]) => n > 0);
  return (
    <div className="rounded-lg border border-border bg-card px-3.5 py-2.5">
      <p className="text-xs text-muted-foreground">week of {fmtDay(row.week)}</p>
      <p className="mt-1 font-mono text-sm font-medium tabular-nums">{row.isolates} isolates</p>
      <p className="font-mono text-sm tabular-nums text-danger">{row.mdro} MDRO</p>
      {classes.length > 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {classes.map(([cls, n]) => `${cls} ${n}`).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

/** Weekly isolate volume with the MDRO-carrying share overlaid (last 26 weeks).
 *  Same unit on both series, so one shared y-axis keeps the chart honest. */
export function MdroWeeklyCard({
  mdro,
  loading,
  refreshing,
  error,
  onRetry,
  className = "",
}: {
  mdro: MdroResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRetry: () => void;
  className?: string;
}) {
  const rows: WeekRow[] = useMemo(
    () => (mdro?.weeks ?? []).slice(-26).map((w) => ({ ...w, label: fmtShort(w.week) })),
    [mdro],
  );

  return (
    <Card className={className}>
      <CardHeading
        title="MDRO weekly prevalence"
        sub={
          mdro
            ? `Last 26 weeks · ${mdro.ward} · ${fmtWindow(mdro.windowStart, mdro.windowEnd)}`
            : undefined
        }
        right={refreshing ? <Busy label="Updating…" /> : null}
      />
      {error && !mdro ? (
        <LoadError message={error} onRetry={onRetry} />
      ) : loading && !mdro ? (
        <div className="mt-4">
          <SkeletonCard hint="Loading MDRO prevalence…" />
        </div>
      ) : mdro && rows.length === 0 ? (
        <EmptyHint>No isolates in the trailing 26 weeks.</EmptyHint>
      ) : mdro ? (
        <>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke={C.border} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#5B6472" }}
                  tickLine={false}
                  axisLine={{ stroke: C.border }}
                  interval="preserveStartEnd"
                  minTickGap={18}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#5B6472" }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  width={40}
                />
                <Tooltip content={<WeekTooltip />} cursor={{ fill: "rgba(15,107,124,0.06)" }} />
                <Bar
                  dataKey="isolates"
                  name="Isolates"
                  fill={C.primary}
                  fillOpacity={0.28}
                  stroke={C.primary}
                  strokeWidth={1}
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="mdro"
                  name="MDRO isolates"
                  stroke={C.danger}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-3.5 rounded-sm border"
                style={{ backgroundColor: "rgba(15,107,124,0.28)", borderColor: C.primary }}
              />
              isolates / week
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4" style={{ backgroundColor: C.danger }} />
              MDRO isolates / week
            </span>
          </div>
          <p className="mt-3 text-[12px] tabular-nums text-muted-foreground">
            Trailing 4 weeks: {fmtNum(mdro.mdroIsolates)} MDRO of {fmtNum(mdro.totalIsolates)}{" "}
            isolates
            {mdro.totalIsolates > 0
              ? ` (${fmtNum((mdro.mdroIsolates / mdro.totalIsolates) * 100)}%)`
              : ""}
            .
          </p>
        </>
      ) : null}
    </Card>
  );
}

/** Per-ward MDRO burden. MDRO % = share of isolates carrying ≥1 warning
 *  phenotype; the cell tint reuses the antibiogram tone bands applied to the
 *  MDRO-free share (toneForR(100 − mdroPct, n)) — deep red = high prevalence. */
export function MdroWardCard({
  mdro,
  loading,
  refreshing,
  error,
  onRetry,
  className = "",
}: {
  mdro: MdroResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeading
        title="MDRO by ward"
        sub={
          mdro ? `Trailing 4 weeks · ${fmtWindow(mdro.windowStart, mdro.windowEnd)}` : undefined
        }
        right={refreshing ? <Busy label="Updating…" /> : null}
      />
      {error && !mdro ? (
        <LoadError message={error} onRetry={onRetry} />
      ) : loading && !mdro ? (
        <div className="mt-4">
          <SkeletonCard hint="Loading per-ward MDRO burden…" />
        </div>
      ) : mdro && mdro.wards.length === 0 ? (
        <EmptyHint>No isolates in the trailing 4 weeks.</EmptyHint>
      ) : mdro ? (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Ward
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Isolates
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    MDRO
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    MDRO %
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Phenotype mix
                  </th>
                </tr>
              </thead>
              <tbody>
                {mdro.wards.map((w) => (
                  <tr
                    key={w.ward}
                    className="border-b border-border last:border-b-0 hover:bg-muted/40"
                  >
                    <td className="whitespace-nowrap py-2 pr-3 font-medium">{w.ward}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {fmtNum(w.isolates)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {fmtNum(w.mdroCount)}
                    </td>
                    <td
                      className="py-2 pr-3 text-right font-mono tabular-nums"
                      style={{
                        backgroundColor: toneColor(
                          w.mdroPct === null ? "insufficient" : toneForR(100 - w.mdroPct, w.isolates),
                        ),
                      }}
                    >
                      {w.mdroPct === null ? "—" : `${fmtNum(w.mdroPct)}%`}
                    </td>
                    <td className="py-2">
                      <MdroClassChips byClass={w.byClass} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            MDRO % = share of the ward&apos;s isolates carrying ≥1 warning phenotype. Cell tint
            reuses the antibiogram tone bands (deep red = high MDRO prevalence); n&lt;30 stays grey.
          </p>
        </>
      ) : null}
    </Card>
  );
}

/** Line-list of the most recent MDRO-carrying isolates, plus the phenotype
 *  definitions and their proxy status in a collapsible. */
export function RecentIsolatesCard({
  mdro,
  loading,
  refreshing,
  error,
  onRetry,
  className = "",
}: {
  mdro: MdroResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeading
        title="Recent MDRO isolates"
        sub={mdro ? `Most recent MDRO-carrying isolates · ${mdro.ward}` : undefined}
        right={refreshing ? <Busy label="Updating…" /> : null}
      />
      {error && !mdro ? (
        <LoadError message={error} onRetry={onRetry} />
      ) : loading && !mdro ? (
        <div className="mt-4">
          <SkeletonCard hint="Loading recent MDRO isolates…" />
        </div>
      ) : mdro && mdro.recent.length === 0 ? (
        <EmptyHint>No MDRO-phenotype isolates in the trailing 4 weeks.</EmptyHint>
      ) : mdro ? (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Date
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Ward
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Organism
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Phenotypes
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Resistant to
                  </th>
                </tr>
              </thead>
              <tbody>
                {mdro.recent.map((r) => (
                  <tr
                    key={r.isolateId}
                    className="border-b border-border last:border-b-0 hover:bg-muted/40"
                  >
                    <td className="whitespace-nowrap py-2 pr-3 font-mono text-[12px] tabular-nums">
                      {fmtDay(r.date)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3">{r.ward}</td>
                    <td className="py-2 pr-3 font-medium">{r.organism}</td>
                    <td className="py-2 pr-3">
                      <PhenotypeChips phenotypes={r.phenotypes} />
                    </td>
                    <td className="py-2">
                      {r.resistant.length > 0 ? (
                        <span className="text-[12px] text-danger">R: {r.resistant.join(", ")}</span>
                      ) : (
                        <span className="text-[12px] text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer select-none text-[12px] font-medium text-primary">
              Phenotype definitions
            </summary>
            <dl className="mt-2 space-y-1">
              {mdro.definitions.map((d) => (
                <div key={d.cls} className="text-[12px] leading-relaxed">
                  <dt className="inline font-semibold">{d.cls}</dt>
                  <dd className="inline text-muted-foreground"> — {d.definition}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Phenotype proxies computed from the susceptibility panel — not laboratory
              confirmation; no molecular typing exists in this dataset.
            </p>
          </details>
        </>
      ) : null}
    </Card>
  );
}
