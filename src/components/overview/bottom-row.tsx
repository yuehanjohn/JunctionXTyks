"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { Card } from "@/components/ui";
import type { OverviewResponse } from "@/lib/types";

import { CardTitle, EmptyNote } from "./bits";
import { FALLBACK_SPECIMEN_COLOR, SPECIMEN_COLORS, fmtDayMonth, fmtNum } from "./format";

// ── Specimen type distribution ────────────────────────────────────────

type DonutEntry = { sampleType?: string; n?: number; sharePct?: number };

function DonutTooltip({ active, payload }: { active?: boolean; payload?: { payload?: DonutEntry }[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p?.sampleType) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-sm tabular-nums">
      <span className="font-semibold capitalize text-foreground">{p.sampleType}</span>
      <span className="ml-2 text-muted-foreground">
        {p.n} · {fmtNum(p.sharePct ?? 0)}%
      </span>
    </div>
  );
}

export function SpecimenCard({ specimen }: { specimen: OverviewResponse["specimen"] }) {
  const total = specimen.reduce((sum, s) => sum + s.n, 0);
  return (
    <Card className="min-w-0">
      <CardTitle title="Specimen type distribution" subtitle="First isolates, current window" />
      {specimen.length === 0 ? (
        <EmptyNote />
      ) : (
        <>
          <div className="relative">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={specimen}
                    dataKey="n"
                    nameKey="sampleType"
                    innerRadius="62%"
                    outerRadius="88%"
                    paddingAngle={2}
                    stroke="var(--card)"
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    {specimen.map((s) => (
                      <Cell
                        key={s.sampleType}
                        fill={SPECIMEN_COLORS[s.sampleType] ?? FALLBACK_SPECIMEN_COLOR}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<DonutTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-semibold tabular-nums text-foreground">{total}</span>
              <span className="text-[11px] text-muted-foreground">isolates</span>
            </div>
          </div>
          <ul className="mt-2 space-y-1">
            {specimen.map((s) => (
              <li key={s.sampleType} className="flex items-center gap-2 text-xs">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: SPECIMEN_COLORS[s.sampleType] ?? FALLBACK_SPECIMEN_COLOR }}
                />
                <span className="capitalize text-foreground">{s.sampleType}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">
                  {fmtNum(s.sharePct)}% ({s.n})
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

// ── Top organisms ─────────────────────────────────────────────────────

export function TopOrganismsCard({
  topOrganisms,
}: {
  topOrganisms: OverviewResponse["topOrganisms"];
}) {
  return (
    <Card className="min-w-0">
      <CardTitle title="Top organisms" subtitle="First isolates, current window" />
      {topOrganisms.length === 0 ? (
        <EmptyNote />
      ) : (
        <div className="space-y-2.5">
          {topOrganisms.map((t) => (
            <div key={t.organism} className="flex items-center gap-3">
              <span className="w-36 shrink-0 truncate text-xs text-foreground" title={t.organism}>
                {t.organism}
              </span>
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/70"
                  style={{ width: `${Math.min(100, Math.max(0, t.sharePct))}%` }}
                />
              </div>
              <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {t.n} ({fmtNum(t.sharePct)}%)
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Recent isolates ───────────────────────────────────────────────────

const RECENT_HEAD = "py-1.5 pr-2 text-left text-[11px] font-medium text-muted-foreground";

export function RecentIsolatesCard({
  recentIsolates,
}: {
  recentIsolates: OverviewResponse["recentIsolates"];
}) {
  return (
    <Card className="min-w-0">
      <CardTitle title="Recent isolates" subtitle="Newest first" />
      {recentIsolates.length === 0 ? (
        <EmptyNote />
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className={RECENT_HEAD}>Date</th>
              <th className={RECENT_HEAD}>Ward</th>
              <th className={RECENT_HEAD}>Organism</th>
              <th className={`${RECENT_HEAD} pr-0`}>Key resistance findings</th>
            </tr>
          </thead>
          <tbody>
            {recentIsolates.map((iso) => (
              <tr key={iso.isolateId} className="border-b border-border/60 last:border-0">
                <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums text-muted-foreground">
                  {fmtDayMonth(iso.date)}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-2 text-foreground">{iso.ward}</td>
                <td className="whitespace-nowrap py-1.5 pr-2 text-foreground">{iso.organism}</td>
                <td className="py-1.5 text-muted-foreground">
                  {iso.resistant.length > 0 ? (
                    <span>
                      <span className="font-semibold text-danger">R:</span> {iso.resistant.join(", ")}
                    </span>
                  ) : (
                    <span>
                      <span className="font-semibold text-success">S:</span> all tested (
                      {iso.susceptible.length})
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
