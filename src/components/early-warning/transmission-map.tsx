"use client";

import { useEffect, useMemo, useState } from "react";

import { Card } from "@/components/ui";
import { toneColor } from "@/components/ui";
import { toneForR } from "@/lib/types";
import type { MdroResponse, PathwaysResponse, TimelineWarning, WarningTimelineResponse } from "@/lib/types";

// SVG presentation attributes cannot use CSS var(), so colors are literals
// mirroring the tokens in globals.css.
const PETROL = "#0f6b7c";
const DANGER = "#b3261e";
const WARNING = "#a85b00";
const MUTED = "#5b6472";
const BORDER = "#e3e6ea";

/** Schematic hospital layout: role-positioned, NOT geographic — ICU central,
 *  ED as entrance, health centres and long-term care on the periphery. */
const LAYOUT: Record<string, { x: number; y: number; label: string }> = {
  ICU: { x: 450, y: 215, label: "ICU" },
  "Emergency Department": { x: 150, y: 215, label: "ED" },
  "General Surgery": { x: 300, y: 105, label: "Gen Surgery" },
  "Internal Medicine A": { x: 300, y: 325, label: "Int Med A" },
  "Internal Medicine B": { x: 620, y: 105, label: "Int Med B" },
  "Infectious Diseases Ward": { x: 620, y: 325, label: "ID Ward" },
  "Health Centre East": { x: 80, y: 55, label: "HC East" },
  "Health Centre West": { x: 80, y: 375, label: "HC West" },
  "Long-term Care Facility": { x: 815, y: 215, label: "LTC" },
};

const NODE_W = 128;
const NODE_H = 34;

const SEVERITY_COLOR: Record<string, string> = {
  high: DANGER,
  moderate: WARNING,
  watch: MUTED,
};

interface Props {
  pathways: PathwaysResponse | null;
  mdro: MdroResponse | null;
  asOf: string;
  selectedWard: string;
  onSelectWard: (ward: string) => void;
}

async function loadJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
  return (await res.json()) as T;
}

export function TransmissionMap({ pathways, mdro, asOf, selectedWard, onSelectWard }: Props) {
  const [timeline, setTimeline] = useState<WarningTimelineResponse | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [weekIndex, setWeekIndex] = useState<number | null>(null); // null = live
  const [playing, setPlaying] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setTimelineError(null);
    const params = new URLSearchParams({ weeks: "13" });
    if (asOf) params.set("asOf", asOf);
    loadJson<WarningTimelineResponse>(`/api/warning/timeline?${params.toString()}`, controller.signal)
      .then((d) => {
        setTimeline(d);
        setWeekIndex(null); // new timeline → back to live
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setTimelineError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [asOf, attempt]);

  // Playback: advance one week per 700 ms, stop at the live week.
  useEffect(() => {
    if (!playing || !timeline) return;
    if (weekIndex !== null && weekIndex >= timeline.points.length - 1) {
      setPlaying(false);
      return;
    }
    const interval = setInterval(() => {
      setWeekIndex((idx) => {
        const next = (idx ?? timeline.points.length - 2) + 1;
        if (next >= timeline.points.length - 1) setPlaying(false);
        return Math.min(next, timeline.points.length - 1);
      });
    }, 700);
    return () => {
      clearInterval(interval);
    };
  }, [playing, timeline, weekIndex]);

  const mdroByWard = useMemo(() => {
    const map = new Map<string, { mdroPct: number | null; isolates: number }>();
    for (const w of mdro?.wards ?? []) map.set(w.ward, { mdroPct: w.mdroPct, isolates: w.isolates });
    return map;
  }, [mdro]);

  const currentWeek: { weekEnd: string; warnings: TimelineWarning[] } | null = useMemo(() => {
    if (!timeline) return null;
    if (weekIndex === null) return timeline.points[timeline.points.length - 1] ?? null;
    return timeline.points[weekIndex] ?? null;
  }, [timeline, weekIndex]);

  const warningsByWard = useMemo(() => {
    const map = new Map<string, TimelineWarning[]>();
    for (const w of currentWeek?.warnings ?? []) {
      const list = map.get(w.ward);
      if (list) list.push(w);
      else map.set(w.ward, [w]);
    }
    return map;
  }, [currentWeek]);

  const worstSeverity = (ward: string): string | null => {
    const list = warningsByWard.get(ward);
    if (!list || list.length === 0) return null;
    if (list.some((w) => w.severity === "high")) return "high";
    if (list.some((w) => w.severity === "moderate")) return "moderate";
    return "watch";
  };

  const nodeFill = (ward: string): string => {
    const m = mdroByWard.get(ward);
    if (!m || m.isolates === 0) return "#ffffff";
    return toneColor(toneForR(100 - (m.mdroPct ?? 0), m.isolates));
  };

  const maxPatients = Math.max(1, ...(pathways?.edges ?? []).map((e) => e.patients));
  const isLive = weekIndex === null;

  return (
    <Card className="mt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Transmission map</h2>
        <p className="text-xs text-muted-foreground">
          Schematic hospital layout — node tint = current MDRO prevalence · ring = warnings live in
          the selected week · edge width = patients transferred. Click a ward to filter the page.
        </p>
      </div>

      {/* Replay controls */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!timeline || (weekIndex ?? timeline?.points.length ?? 1) - 1 >= (timeline?.points.length ?? 1) - 1 && !playing}
          onClick={() => {
            if (playing) {
              setPlaying(false);
            } else {
              if (weekIndex === null || weekIndex >= (timeline?.points.length ?? 1) - 1) setWeekIndex(0);
              setPlaying(true);
            }
          }}
          className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-3 text-[12.5px] font-medium text-foreground hover:border-primary/40 disabled:opacity-40"
          title="Replay the warning timeline week by week"
        >
          {playing ? "⏸ Pause" : "▶ Replay"}
        </button>
        <input
          type="range"
          min={0}
          max={(timeline?.points.length ?? 2) - 1}
          value={weekIndex ?? (timeline?.points.length ?? 2) - 1}
          onChange={(event) => {
            setPlaying(false);
            setWeekIndex(Number(event.target.value));
          }}
          className="h-1.5 w-64 accent-[var(--primary)]"
          aria-label="Replay week"
        />
        <span className="text-[12.5px] font-medium tabular-nums text-foreground">
          {currentWeek ? currentWeek.weekEnd.slice(0, 10) : "—"}
        </span>
        {!isLive && (
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              setWeekIndex(null);
            }}
            className="text-xs font-medium text-primary hover:underline"
          >
            Back to live
          </button>
        )}
        {isLive && <Badge tone="success">live</Badge>}
        <span className="text-[12px] tabular-nums text-muted-foreground">
          {currentWeek
            ? `${currentWeek.warnings.length} warning${currentWeek.warnings.length === 1 ? "" : "s"} live this week`
            : ""}
        </span>
      </div>

      {timelineError ? (
        <div className="mt-3">
          <p className="text-sm text-danger">Couldn&apos;t load the warning timeline: {timelineError}</p>
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="mt-2 h-8 rounded-lg bg-primary px-3 text-[12.5px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      ) : loading && !timeline ? (
        <div aria-hidden className="mt-4 animate-pulse">
          <div className="h-[430px] rounded-lg bg-muted" />
        </div>
      ) : timeline ? (
        <div className="mt-2 overflow-x-auto">
          <svg viewBox="0 0 900 440" className="h-[430px] w-full min-w-[760px]" role="img" aria-label="Schematic hospital transmission map">
            <defs>
              <marker id="wb-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 8 4 0 8z" fill={PETROL} opacity="0.55" />
              </marker>
            </defs>

            {/* transfer edges */}
            {(pathways?.edges ?? []).map((e) => {
              const a = LAYOUT[e.from];
              const b = LAYOUT[e.to];
              if (!a || !b) return null;
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2 - 24;
              return (
                <path
                  key={`${e.from}|${e.to}`}
                  d={`M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`}
                  fill="none"
                  stroke={PETROL}
                  strokeOpacity={0.4}
                  strokeWidth={Math.min(6, 1 + (e.patients / maxPatients) * 4)}
                  markerEnd="url(#wb-arrow)"
                >
                  <title>{`${e.from} → ${e.to}: ${e.patients} patients transferred within ${pathways?.transferGapDays ?? 30} days`}</title>
                </path>
              );
            })}

            {/* ward nodes */}
            {Object.entries(LAYOUT).map(([ward, pos]) => {
              const sev = worstSeverity(ward);
              const counts = warningsByWard.get(ward);
              const m = mdroByWard.get(ward);
              const ring = sev ? SEVERITY_COLOR[sev]! : BORDER;
              const ringWidth = sev === "high" ? 3.5 : sev ? 2.5 : 1.5;
              const selected = selectedWard === ward;
              return (
                <g
                  key={ward}
                  onClick={() => onSelectWard(ward)}
                  className="cursor-pointer"
                  role="button"
                  aria-label={`Filter page by ${ward}`}
                >
                  {counts && counts.length > 0 ? (
                    <g>
                      <circle cx={pos.x + NODE_W / 2 - 8} cy={pos.y - NODE_H / 2 - 4} r={11} fill={SEVERITY_COLOR[sev ?? "watch"]} />
                      <text
                        x={pos.x + NODE_W / 2 - 8}
                        y={pos.y - NODE_H / 2 - 0.5}
                        textAnchor="middle"
                        fontSize="11"
                        fontWeight="700"
                        fill="#ffffff"
                      >
                        {counts.length}
                      </text>
                    </g>
                  ) : null}
                  <rect
                    x={pos.x - NODE_W / 2}
                    y={pos.y - NODE_H / 2}
                    width={NODE_W}
                    height={NODE_H}
                    rx={8}
                    fill={nodeFill(ward)}
                    stroke={selected ? PETROL : ring}
                    strokeWidth={selected ? 3 : ringWidth}
                  />
                  <text x={pos.x} y={pos.y + 4} textAnchor="middle" fontSize="12" fontWeight="600" fill="#14171c">
                    {pos.label}
                  </text>
                  <title>
                    {`${ward} — MDRO prevalence ${m?.mdroPct ?? 0}% of ${m?.isolates ?? 0} isolates${
                      counts && counts.length > 0 ? ` · ${counts.length} warning${counts.length === 1 ? "" : "s"}: ${counts.map((w) => w.headline).join("; ")}` : ""
                    }`}
                  </title>
                </g>
              );
            })}
          </svg>
        </div>
      ) : null}

      {/* Selected-week warning chips */}
      {currentWeek && currentWeek.warnings.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {currentWeek.warnings.map((w, i) => (
            <span
              key={`${w.kind}-${w.ward}-${w.organism}-${i}`}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${w.severity === "high" ? "bg-danger/10 text-danger" : w.severity === "moderate" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"}`}
            >
              {w.headline}
            </span>
          ))}
        </div>
      ) : null}

      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Layout is schematic (role-positioned), not geographic — the dataset carries no coordinates.
        Flows are reconstructed from repeat cultures (same patient, different ward, ≤
        {pathways?.transferGapDays ?? 30} days); a warning ring means the detectors fired that week
        — a hypothesis for investigation, not a confirmed outbreak.
      </p>
    </Card>
  );
}

function Badge({ tone, children }: { tone: "success"; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        tone === "success" ? "bg-success/10 text-success" : ""
      }`}
    >
      {children}
    </span>
  );
}
