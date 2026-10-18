"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, Select, ToneLegend, toneColor } from "@/components/ui";
import type { FunnelPoint, WardCompareResponse, WardPair } from "@/lib/types";
import { MIN_ISOLATES } from "@/lib/types";

// SVG presentation attributes cannot use CSS var(), so chart colors are
// literals mirroring the tokens in globals.css.
const ACCENT = "#0f6b7c";
const DANGER = "#b3261e";
const WARNING = "#a85b00";
const MUTED = "#5b6472";

async function loadJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

const pct1 = (v: number) => Math.round(v * 10) / 10;

function flagColor(flag: FunnelPoint["flag"]): string {
  if (flag === "above998" || flag === "above95") return DANGER;
  if (flag === "below95") return WARNING;
  return ACCENT;
}

const FLAG_LABEL: Record<FunnelPoint["flag"], string> = {
  none: "within funnel limits",
  above95: "above 95% limit",
  above998: "above 99.8% limit",
  below95: "below 95% limit",
};

/** Forest row: ward rPct dot with Wilson CI whisker against the hospital mean. */
function ForestRow({
  ward,
  scaleMax,
  hospital,
}: {
  ward: FunnelPoint;
  scaleMax: number;
  hospital: WardCompareResponse["hospital"];
}) {
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / scaleMax) * 100))}%`;
  return (
    <div className="grid grid-cols-[190px_1fr_120px] items-center gap-3 py-1.5">
      <div className="truncate text-[12.5px] font-medium text-foreground" title={ward.ward}>
        {ward.ward}
        <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">n={ward.n}</span>
      </div>
      <div className="relative h-5">
        {/* hospital mean reference line */}
        <div
          aria-hidden
          className="absolute inset-y-0 z-0 w-px bg-primary/50"
          style={{ left: pct(hospital.rPct) }}
        />
        {/* Wilson CI whisker */}
        <div
          className="absolute top-1/2 z-10 h-1.5 -translate-y-1/2 rounded-full"
          style={{
            left: pct(ward.ciLo),
            width: `${Math.max(1, ((ward.ciHi - ward.ciLo) / scaleMax) * 100)}%`,
            backgroundColor: toneColor(ward.tone),
          }}
          title={`${ward.ward} — ${pct1(ward.rPct)}% (Wilson 95% CI ${pct1(ward.ciLo)}–${pct1(ward.ciHi)}), n=${ward.n}${ward.baselineR !== null ? `, 12-month baseline ${pct1(ward.baselineR)}%` : ""}`}
        />
        {/* rPct dot */}
        <div
          className={`absolute top-1/2 z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card ${
            ward.flag !== "none" ? "ring-2" : ""
          }`}
          style={{
            left: pct(ward.rPct),
            backgroundColor: flagColor(ward.flag),
            ...(ward.flag !== "none" ? { boxShadow: `0 0 0 2px ${flagColor(ward.flag)}33` } : {}),
          }}
        />
      </div>
      <div className="text-right font-mono text-[12.5px] tabular-nums">
        {pct1(ward.rPct)}%
        <span className="ml-1 text-[11px] text-muted-foreground">
          [{pct1(ward.ciLo)}–{pct1(ward.ciHi)}]
        </span>
      </div>
    </div>
  );
}

function FunnelTooltip({ payload }: { payload?: { payload?: FunnelPoint } }) {
  const w = payload?.payload;
  if (!w) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-[12px] shadow-sm">
      <div className="font-semibold text-foreground">{w.ward}</div>
      <div className="text-muted-foreground">
        {pct1(w.rPct)}% resistant · n={w.n} · {FLAG_LABEL[w.flag]}
      </div>
      <div className="text-muted-foreground">
        limits 95%: {pct1(w.lower95)}–{pct1(w.upper95)} · 99.8%: {pct1(w.lower998)}–
        {pct1(w.upper998)}
      </div>
    </div>
  );
}

export default function WardCompareCard({
  sample,
  asOf,
  organismOptions,
}: {
  sample: string;
  asOf: string;
  /** top-8 organism column order from the summary comparison */
  organismOptions: string[];
}) {
  const organism0 = organismOptions[0] ?? "";
  const [organism, setOrganism] = useState(organism0);
  const [antibiotic, setAntibiotic] = useState(""); // "" = overall panel
  const [antibiotics, setAntibiotics] = useState<string[]>([]);
  const [data, setData] = useState<WardCompareResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Keep the selection valid when the option list changes.
  useEffect(() => {
    if (organismOptions.length > 0 && !organismOptions.includes(organism)) {
      setOrganism(organismOptions[0]!);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organismOptions.join("|")]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/meta", { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ antibiotics: string[] }>) : null))
      .then((m) => m && setAntibiotics(m.antibiotics))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (organism === "") return;
    const controller = new AbortController();
    setError(null);
    setLoading(true);
    const params = new URLSearchParams({ organism });
    if (antibiotic !== "") params.set("antibiotic", antibiotic);
    if (sample !== "") params.set("sample", sample);
    if (asOf !== "") params.set("asOf", asOf);
    loadJson<WardCompareResponse>(
      `/api/ward-comparison/compare?${params.toString()}`,
      controller.signal,
    )
      .then((d) => setData(d))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [organism, antibiotic, sample, asOf, attempt]);

  // Funnel limit curves (binomial control limits around the hospital mean).
  const funnelData = useMemo(() => {
    if (!data) return { curve: [] as { n: number; up95: number; up998: number; lo95: number }[], yMax: 60 };
    const maxN = Math.max(...data.wards.map((w) => w.n), 50);
    const p = data.hospital.rPct / 100;
    const curve: { n: number; up95: number; up998: number; lo95: number }[] = [];
    for (let n = 10; n <= maxN * 1.1; n += Math.max(5, Math.round(maxN / 40))) {
      const se = Math.sqrt(p * (1 - p) / n) * 100;
      curve.push({
        n,
        up95: Math.min(100, data.hospital.rPct + 1.96 * se),
        up998: Math.min(100, data.hospital.rPct + 3.0 * se),
        lo95: Math.max(0, data.hospital.rPct - 1.96 * se),
      });
    }
    const yMax = Math.min(100, Math.max(50, ...data.wards.map((w) => w.ciHi)) + 10);
    return { curve, yMax };
  }, [data]);

  // Pairwise lookup: "a|b" with a = higher-rPct ward of the pair.
  const pairIndex = useMemo(() => {
    const map = new Map<string, WardPair>();
    for (const p of data?.pairs ?? []) map.set(`${p.a}|${p.b}`, p);
    return map;
  }, [data]);

  const testableWards = useMemo(
    () => (data?.wards ?? []).filter((w) => w.n >= MIN_ISOLATES),
    [data],
  );

  const scaleMax = useMemo(() => {
    const hi = Math.max(...(data?.wards.map((w) => w.ciHi) ?? [0]), data?.hospital.rPct ?? 0);
    return Math.max(30, Math.ceil(hi / 10) * 10 + 5);
  }, [data]);

  const outliers = (data?.wards ?? []).filter((w) => w.flag === "above998" || w.flag === "above95");

  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">
            Statistical comparison — {data ? data.metric : "…"} · {data?.organism ?? "…"}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Wilson 95% CIs · pairwise two-proportion z-tests (Benjamini–Hochberg FDR 5%) · funnel
            limits vs hospital mean
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="Organism"
            value={organism}
            options={organismOptions.map((o) => ({ value: o, label: o }))}
            onChange={setOrganism}
            className="w-52"
          />
          <Select
            label="Antibiotic"
            value={antibiotic}
            options={[
              { value: "", label: "Overall panel" },
              ...antibiotics.map((a) => ({ value: a, label: a })),
            ]}
            onChange={setAntibiotic}
            className="w-52"
          />
        </div>
      </div>

      {error ? (
        <div className="mt-4">
          <p className="text-sm font-medium text-danger">Couldn&apos;t load the comparison</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="mt-3 h-8 rounded-lg bg-primary px-3 text-[12.5px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      ) : loading && !data ? (
        <div aria-hidden className="mt-4 animate-pulse space-y-2">
          <div className="h-4 w-64 rounded bg-muted" />
          <div className="h-40 rounded-lg bg-muted" />
        </div>
      ) : data && data.wards.length > 0 ? (
        <div className={`mt-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {outliers.length > 0 && (
            <div className="mb-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">
              {outliers.map((w) => w.ward).join(", ")}{" "}
              {outliers.length === 1 ? "lies" : "lie"} above the hospital mean beyond the funnel
              limit{outliers.some((w) => w.flag === "above998") ? " (99.8%)" : " (95%)"} —
              significantly higher resistance than expected for that volume. Statistical finding
              for investigation, not an outbreak confirmation.
            </div>
          )}

          {/* Forest plot */}
          <div className="min-w-0">
            <div className="grid grid-cols-[190px_1fr_120px] gap-3 border-b border-border pb-1 text-[11px] font-medium text-muted-foreground">
              <span>Ward (rPct %R, n results)</span>
              <span>
                % resistant · vertical line = hospital mean {pct1(data.hospital.rPct)}%
              </span>
              <span className="text-right">rPct [95% CI]</span>
            </div>
            {data.wards.map((w) => (
              <ForestRow key={w.ward} ward={w} scaleMax={scaleMax} hospital={data.hospital} />
            ))}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* Funnel plot */}
            <div className="min-w-0">
              <h3 className="text-[12.5px] font-semibold tracking-tight">
                Funnel plot vs hospital mean
              </h3>
              <div className="mt-2 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={funnelData.curve} margin={{ top: 6, right: 12, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="n"
                      type="number"
                      domain={[0, Math.max(50, ...data.wards.map((w) => w.n)) * 1.05]}
                      tick={{ fontSize: 10, fill: MUTED }}
                      label={{ value: "n results", position: "insideBottomRight", fontSize: 10, fill: MUTED }}
                    />
                    <YAxis
                      domain={[0, funnelData.yMax]}
                      tick={{ fontSize: 10, fill: MUTED }}
                      tickFormatter={(v: number) => `${v}%`}
                      width={40}
                    />
                    <Tooltip content={<FunnelTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="up95"
                      stroke={MUTED}
                      strokeDasharray="4 3"
                      dot={false}
                      strokeWidth={1}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="up998"
                      stroke={DANGER}
                      strokeDasharray="4 3"
                      dot={false}
                      strokeWidth={1}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="lo95"
                      stroke={MUTED}
                      strokeDasharray="4 3"
                      dot={false}
                      strokeWidth={1}
                      isAnimationActive={false}
                    />
                    <ReferenceLine
                      y={data.hospital.rPct}
                      stroke={ACCENT}
                      strokeDasharray="6 3"
                      label={{ value: "hospital mean", position: "insideTopRight", fontSize: 10, fill: ACCENT }}
                    />
                    <Scatter data={data.wards} dataKey="rPct" isAnimationActive={false}
                      shape={(props: { cx?: number; cy?: number; payload?: FunnelPoint }) => {
                        const { cx, cy, payload } = props;
                        if (cx === undefined || cy === undefined || !payload) return <g />;
                        return (
                          <circle
                            cx={cx}
                            cy={cy}
                            r={payload.flag === "none" ? 4 : 5.5}
                            fill={flagColor(payload.flag)}
                            stroke="#ffffff"
                            strokeWidth={1}
                          />
                        );
                      }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Dashed: binomial 95% / 99.8% (3σ) control limits · red dots cross the upper limits
                · amber: unusually low (check reporting practices).
              </p>
            </div>

            {/* Pairwise significance matrix */}
            <div className="min-w-0">
              <h3 className="text-[12.5px] font-semibold tracking-tight">
                Pairwise differences ({data.pairsTested} tested · {data.pairsSignificant}{" "}
                significant at FDR 5%)
              </h3>
              {testableWards.length < 2 ? (
                <p className="mt-2 text-[12.5px] text-muted-foreground">
                  Fewer than two wards have n ≥ {MIN_ISOLATES} results for this metric — no valid
                  pairwise tests.
                </p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-max border-separate border-spacing-px text-[11px]">
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-10 bg-card px-1 text-left font-medium text-muted-foreground">
                          %R diff (row − col)
                        </th>
                        {testableWards.map((w) => (
                          <th key={w.ward} className="px-1 pb-1 font-medium text-muted-foreground">
                            {w.ward.split(" ").map((part) => (
                              <div key={part}>{part}</div>
                            ))}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {testableWards.map((row, i) => (
                        <tr key={row.ward}>
                          <th className="sticky left-0 z-10 bg-card px-1 text-right font-medium text-muted-foreground">
                            {row.ward}
                          </th>
                          {testableWards.map((col, j) => {
                            if (j === i) {
                              return (
                                <td key={col.ward} className="bg-muted/40 px-1.5 py-1 text-center text-muted-foreground/50">
                                  ·
                                </td>
                              );
                            }
                            if (j < i) {
                              return (
                                <td key={col.ward} className="px-1.5 py-1 text-center text-muted-foreground/30">
                                  ·
                                </td>
                              );
                            }
                            const pair =
                              pairIndex.get(`${row.ward}|${col.ward}`) ??
                              pairIndex.get(`${col.ward}|${row.ward}`);
                            if (!pair) {
                              return (
                                <td key={col.ward} className="px-1.5 py-1 text-center text-muted-foreground/40">
                                  ns
                                </td>
                              );
                            }
                            const diff = pair.a === row.ward ? pair.diffPp : -pair.diffPp;
                            const sig = pair.significant;
                            const higher = diff > 0;
                            return (
                              <td
                                key={col.ward}
                                className={`px-1.5 py-1 text-center font-medium tabular-nums ${
                                  sig
                                    ? higher
                                      ? "bg-danger/15 text-danger"
                                      : "bg-success/15 text-success"
                                    : "text-muted-foreground"
                                }`}
                                title={`${row.ward} vs ${col.ward}: ${pct1(diff)} pp, z=${pair.z}, pAdj=${pair.pAdj}${sig ? " (significant, FDR 5%)" : " (not significant)"}`}
                              >
                                {sig ? `${higher ? "+" : "−"}${pct1(Math.abs(diff))}` : "ns"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">
                +red: row ward significantly higher · −green: row ward significantly lower · ns:
                not significant after FDR correction. Hover for exact p.
              </p>
            </div>
          </div>

          <ToneLegend extra="whisker fill = tone of the ward's current level" />

          {/* Methodology */}
          <details className="mt-3 text-[12px] text-muted-foreground">
            <summary className="cursor-pointer select-none font-medium">Methodology</summary>
            <ul className="mt-1.5 list-disc space-y-1 pl-5">
              {data.methodology.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        </div>
      ) : data ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No isolates of {data.organism} in this window for the selected filters.
        </p>
      ) : null}
    </Card>
  );
}
