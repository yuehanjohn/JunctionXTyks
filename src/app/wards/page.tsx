"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Select, SeverityBadge, ToneLegend, toneColor } from "@/components/ui";
import WardCompareCard from "@/components/wards/compare-card";
import type { MetaResponse, WardComparisonResponse, WardSummary } from "@/lib/types";
import { MIN_ISOLATES, toneForR } from "@/lib/types";

const SEVERITIES = ["high", "moderate", "watch"] as const;

async function loadJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

const DAY_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** ISO instant → "24 Mar"; falls back to the raw string when unparseable. */
function fmtDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DAY_FMT.format(d);
}

// One-decimal display rounding shared by 6+ call sites in lockstep.
const pct1 = (v: number) => Math.round(v * 10) / 10;

function BulletIcon({ kind }: { kind: "peak" | "alert" | "spread" }) {
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden className="mt-0.5 shrink-0 text-primary">
      {kind === "peak" && <path d="M4 17 10 11 14 15 20 7" {...stroke} />}
      {kind === "alert" && (
        <g {...stroke}>
          <path d="M12 4a5 5 0 0 0-5 5v3l-1.5 3h13L17 12V9a5 5 0 0 0-5-5z" />
          <path d="M10 18a2 2 0 0 0 4 0" />
        </g>
      )}
      {kind === "spread" && (
        <g {...stroke}>
          <path d="M6 20V10" />
          <path d="M12 20V4" />
          <path d="M18 20v-8" />
        </g>
      )}
    </svg>
  );
}

interface Observation {
  icon: "peak" | "alert" | "spread";
  text: string;
}

export default function WardsPage() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [data, setData] = useState<WardComparisonResponse | null>(null);
  const [sample, setSample] = useState("");
  const [asOf, setAsOf] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    loadJson<MetaResponse>("/api/meta", controller.signal)
      .then(setMeta)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setLoading(true);
    const params = new URLSearchParams();
    if (sample !== "") params.set("sample", sample);
    if (asOf !== "") params.set("asOf", asOf);
    const qs = params.toString();
    // Soft refresh: the previous comparison stays visible until this lands.
    loadJson<WardComparisonResponse>(`/api/ward-comparison${qs ? `?${qs}` : ""}`, controller.signal)
      .then((d) => setData(d))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [sample, asOf, attempt]);

  // Key observations computed client-side from the fetched comparison.
  const observations = useMemo<Observation[]>(() => {
    const wards = data?.wards ?? [];
    if (wards.length === 0) return [];
    const bullets: Observation[] = [];

    const withResistance = wards.filter((w) => w.resistantPct !== null);
    if (withResistance.length > 0) {
      const peak = withResistance.reduce((a, b) =>
        (b.resistantPct ?? 0) > (a.resistantPct ?? 0) ? b : a,
      );
      bullets.push({
        icon: "peak",
        text: `${peak.ward} has the highest share of resistant isolates this window (${pct1(
          peak.resistantPct ?? 0,
        )}%).`,
      });
    }

    const mostSignals = wards.reduce((a, b) => (b.signals.high > a.signals.high ? b : a));
    if (mostSignals.signals.high > 0) {
      bullets.push({
        icon: "alert",
        text: `${mostSignals.ward} carries the most high-severity signals (${mostSignals.signals.high}).`,
      });
    }

    // Largest per-organism spread across wards with a reportable (n≥30) cell.
    let best: { organism: string; hi: { ward: string; rPct: number }; lo: { ward: string; rPct: number } } | null =
      null;
    if (data) {
      for (const organism of data.organisms) {
        const values: { ward: string; rPct: number }[] = [];
        for (const w of wards) {
          const entry = w.organismResistance.find((o) => o.organism === organism);
          if (entry && entry.rPct !== null && entry.n >= MIN_ISOLATES) {
            values.push({ ward: w.ward, rPct: entry.rPct });
          }
        }
        if (values.length < 2) continue;
        const hi = values.reduce((a, b) => (b.rPct > a.rPct ? b : a));
        const lo = values.reduce((a, b) => (b.rPct < a.rPct ? b : a));
        if (best === null || hi.rPct - lo.rPct > best.hi.rPct - best.lo.rPct) {
          best = { organism, hi, lo };
        }
      }
    }
    if (best) {
      bullets.push({
        icon: "spread",
        text: `${best.organism} varies most between wards: ${pct1(best.hi.rPct)}% on ${
          best.hi.ward
        } vs ${pct1(best.lo.rPct)}% on ${best.lo.ward}.`,
      });
    }
    return bullets;
  }, [data]);

  const specimenOptions = useMemo(
    () => [
      { value: "", label: "All specimens" },
      ...(meta?.sampleTypes ?? []).map((t) => ({ value: t, label: t })),
    ],
    [meta],
  );

  const dateMin = meta?.dateMin.slice(0, 10);
  const dateMax = meta?.dateMax.slice(0, 10);

  return (
    <div>
      <header>
        <h1 className="text-xl font-bold tracking-tight">Ward Comparison</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {data
            ? `Window: ${fmtDay(data.windowStart)} – ${fmtDay(data.windowEnd)} · rolling 4 weeks · first isolate per patient`
            : "All wards side by side · rolling 4-week window · first isolate per patient"}
        </p>
      </header>

      <Card className="mt-5">
        <div className="flex flex-wrap items-end gap-4">
          <Select
            label="Specimen type"
            value={sample}
            options={specimenOptions}
            onChange={setSample}
            className="w-48"
          />
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
              Historical replay
            </span>
            <input
              type="date"
              value={asOf}
              min={dateMin}
              max={dateMax}
              onChange={(event) => setAsOf(event.target.value)}
              title="Recompute every window as if today were this date; leave empty for live data"
              className="h-9 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </label>
          <p className="pb-2 text-[12px] text-muted-foreground">
            Replay date empty = live data.
          </p>
        </div>
      </Card>

      {asOf !== "" && (
        <div
          role="status"
          className="mt-4 rounded-[10px] border border-warning/40 bg-warning/10 px-4 py-2.5 text-[13px] font-medium text-warning"
        >
          Historical replay — every window is recomputed as if today were {fmtDay(asOf)}. Clear
          the date to return to live data.
        </div>
      )}

      {error ? (
        <Card className="mt-4">
          <p className="text-sm font-medium text-danger">Couldn&apos;t load ward comparison</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="mt-4 h-9 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Retry
          </button>
        </Card>
      ) : loading && !data ? (
        <div aria-hidden className="mt-4 animate-pulse">
          <Card>
            <div className="h-4 w-56 rounded bg-muted" />
            <div className="mt-4 h-64 rounded-lg bg-muted" />
          </Card>
        </div>
      ) : data && data.wards.length === 0 ? (
        <Card className="mt-4">
          <p className="text-sm text-muted-foreground">No isolates in this window.</p>
        </Card>
      ) : data ? (
        <>
          <Card className="mt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold tracking-tight">Ward-by-ward resistance</h2>
              <p className="text-xs text-muted-foreground">
                Tinted cells: green = low resistance, red = high · grey = n&lt;{MIN_ISOLATES}
              </p>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-medium">
                      Ward
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Isolates
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Resistant isolates %
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Most common organism
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Active signals
                    </th>
                    {data.organisms.map((organism) => (
                      <th
                        key={organism}
                        scope="col"
                        className="px-3 py-2 text-center font-medium leading-tight"
                        title={`${organism} — % resistant (R/(S+R)) across the standard panel`}
                      >
                        {organism}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.wards.map((ward: WardSummary) => {
                    const signalTotal =
                      ward.signals.high + ward.signals.moderate + ward.signals.watch;
                    return (
                      <tr
                        key={ward.ward}
                        className="border-b border-border last:border-b-0 hover:bg-muted/40"
                      >
                        <td className="px-3 py-2.5 font-medium">{ward.ward}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                          {ward.isolates.toLocaleString("en-US")}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {ward.resistantPct === null ? (
                            <span
                              className="text-muted-foreground"
                              title={`${ward.ward} — no reportable resistance share (n=${ward.isolates} first isolates)`}
                            >
                              —
                            </span>
                          ) : (
                            <span
                              className="inline-block rounded px-2 py-0.5 tabular-nums"
                              style={{
                                backgroundColor: toneColor(
                                  toneForR(ward.resistantPct, ward.isolates),
                                ),
                              }}
                              title={`${ward.ward} — ${pct1(ward.resistantPct)}% of ${ward.isolates} first isolates had ≥1 R result`}
                            >
                              {pct1(ward.resistantPct)}%
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {ward.topOrganism ? (
                            <>
                              {ward.topOrganism}{" "}
                              <span className="text-muted-foreground">
                                ({pct1(ward.topOrganismSharePct)}%)
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {signalTotal === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              {SEVERITIES.map((severity) =>
                                ward.signals[severity] > 0 ? (
                                  <span key={severity} className="inline-flex items-center gap-1">
                                    <SeverityBadge severity={severity} />
                                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                      ×{ward.signals[severity]}
                                    </span>
                                  </span>
                                ) : null,
                              )}
                            </span>
                          )}
                        </td>
                        {data.organisms.map((organism) => {
                          const entry = ward.organismResistance.find(
                            (o) => o.organism === organism,
                          );
                          if (!entry || entry.rPct === null) {
                            return (
                              <td key={organism} className="px-3 py-2.5 text-center">
                                <span
                                  className="text-muted-foreground"
                                  title={
                                    entry
                                      ? `${ward.ward} · ${organism} — n=${entry.n} (<${MIN_ISOLATES}, not reported)`
                                      : `${ward.ward} · ${organism} — no results`
                                  }
                                >
                                  —
                                </span>
                              </td>
                            );
                          }
                          const sufficient = entry.n >= MIN_ISOLATES;
                          return (
                            <td key={organism} className="px-3 py-2.5 text-center">
                              <span
                                className="inline-block rounded px-2 py-0.5 tabular-nums"
                                style={{ backgroundColor: toneColor(entry.tone) }}
                                title={`${ward.ward} · ${organism} — ${entry.n} results${entry.baselineR !== null ? `, 12-month baseline ${Math.round(entry.baselineR)}%` : ""}`}
                              >
                                {Math.round(entry.rPct)}%
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <ToneLegend />
            </div>
          </Card>

          <Card className="mt-4">
            <h2 className="text-sm font-semibold tracking-tight">Key observations</h2>
            {observations.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted-foreground">
                Not enough reportable cells this window to rank wards.
              </p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {observations.map((observation) => (
                  <li key={observation.text} className="flex items-start gap-2.5">
                    <BulletIcon kind={observation.icon} />
                    <span className="text-[13px] leading-relaxed">{observation.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <WardCompareCard sample={sample} asOf={asOf} organismOptions={data.organisms} />

          <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
            Percentages from first isolates per patient; cells with n&lt;{MIN_ISOLATES} are not
            reported. &quot;Resistant isolates %&quot; = share of first isolates with ≥1 R result;
            per-organism grid cells = R/(S+R). All data synthetic — population-level surveillance
            only, not a treatment guideline.
          </p>
        </>
      ) : null}
    </div>
  );
}
