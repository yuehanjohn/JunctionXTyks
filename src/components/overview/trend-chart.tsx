"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card } from "@/components/ui";
import type { OverviewResponse } from "@/lib/types";

import { CardTitle, EmptyNote } from "./bits";
import { SERIES_COLORS, fmtNum } from "./format";

type TrendSeries = OverviewResponse["series"][number];

type TrendRow = Record<string, string | number | null>;

type TooltipEntry = {
  dataKey?: string;
  name?: string;
  value?: number | string | null;
  color?: string;
};

function TrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 font-semibold text-foreground">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: p.color ?? "var(--muted-foreground)" }}
          />
          <span className="text-foreground">{p.name}</span>
          <span className="ml-auto pl-3 tabular-nums text-muted-foreground">
            {typeof p.value === "number" ? `${fmtNum(p.value)}%` : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Chip that occupies the mockup's mode-toggle position (single shipped mode). */
function ModeChip() {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      By organism
    </span>
  );
}

/** Only the top-N organisms by isolate volume render initially — five lines
 *  read as spaghetti; the rest stay one click away in the legend. */
const DEFAULT_SHOWN = 3;

/**
 * Multi-line resistance trend: one line per top organism, daily % resistant
 * across the rolling window. Days with zero results become line gaps — the
 * server emits rPct=0 for them, which must never read as "0% measured".
 */
export function TrendChartCard({ series, busy }: { series: TrendSeries[]; busy?: boolean }) {
  // Organisms the user switched off; absent = visible. Defaults to the top-N
  // series (the server orders `series` by isolate volume).
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(series.slice(DEFAULT_SHOWN).map((s) => s.organism)),
  );

  const shown = useMemo(() => series.filter((s) => s.n > 0), [series]);

  const rows = useMemo<TrendRow[]>(() => {
    const byDate = new Map<string, TrendRow>();
    shown.forEach((s, i) => {
      const key = `s${i}`;
      for (const p of s.points) {
        const row = byDate.get(p.date) ?? { date: p.date, label: p.label };
        // Server emits rPct=0 for days with zero results — render those as gaps.
        row[key] = p.n > 0 ? p.rPct : null;
        byDate.set(p.date, row);
      }
    });
    return [...byDate.values()].sort((a, b) =>
      (a.date ?? "") < (b.date ?? "") ? -1 : (a.date ?? "") > (b.date ?? "") ? 1 : 0,
    );
  }, [shown]);

  const visible = shown.filter((s) => !hidden.has(s.organism));

  return (
    <Card className="min-w-0">
      <CardTitle
        title="Resistance trend over time"
        subtitle="Percentage of resistant isolates (first isolate per patient)"
        right={<ModeChip />}
      />
      {shown.length === 0 || rows.length === 0 ? (
        <EmptyNote />
      ) : (
        <>
          <div className={`h-72 transition-opacity ${busy ? "opacity-60" : ""}`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                  minTickGap={20}
                />
                <YAxis
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={38}
                />
                <Tooltip content={<TrendTooltip />} cursor={{ stroke: "var(--border)" }} />
                {visible.map((s) => {
                  const i = shown.indexOf(s);
                  return (
                    <Line
                      key={s.organism}
                      type="monotone"
                      dataKey={`s${i}`}
                      name={s.organism}
                      stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {shown.map((s) => {
              const i = shown.indexOf(s);
              const on = !hidden.has(s.organism);
              return (
                <label
                  key={s.organism}
                  className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground"
                >
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={on}
                    onChange={() =>
                      setHidden((h) => {
                        const next = new Set(h);
                        if (next.has(s.organism)) next.delete(s.organism);
                        else next.add(s.organism);
                        return next;
                      })
                    }
                  />
                  <span
                    className="inline-block h-0.5 w-4 rounded-full"
                    style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }}
                  />
                  <span className={on ? "" : "text-muted-foreground"}>{s.organism}</span>
                </label>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
