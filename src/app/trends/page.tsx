"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MetaResponse, TrendPoint, TrendResponse } from "@/lib/types";
import { MIN_ISOLATES } from "@/lib/types";

// SVG presentation attributes cannot use CSS var(), so chart colors are literals
// mirroring the tokens in globals.css.
const C = {
  primary: "#0F6B7C",
  success: "#177245",
  border: "#E3E6EA",
  mutedForeground: "#5B6472",
  card: "#ffffff",
  lowDot: "#9CA3AF",
} as const;

const MONTH_FULL = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

type TrendRow = TrendPoint & { fullMonth: string };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status} ${res.statusText})`);
  return (await res.json()) as T;
}

/** Custom dot: size grows with n; open grey circle when n < MIN_ISOLATES. */
function TrendDot(props: { cx?: number; cy?: number; payload?: TrendRow }) {
  const { cx, cy, payload } = props;
  if (typeof cx !== "number" || typeof cy !== "number" || !payload) return <g />;
  const low = payload.n < MIN_ISOLATES;
  const r = Math.min(7, Math.max(2.5, 2 + Math.sqrt(payload.n) * 0.45));
  return (
    <circle
      key={`dot-${payload.month}`}
      cx={cx}
      cy={cy}
      r={r}
      fill={low ? C.card : C.primary}
      stroke={low ? C.lowDot : C.primary}
      strokeWidth={low ? 1.5 : 0}
    />
  );
}

/** recharts clones this element with { active, payload, label, ... } per hover. */
function TrendTooltip(props: { active?: boolean; payload?: { payload?: unknown }[] }) {
  const { active, payload } = props;
  const row =
    active && payload && payload[0] && payload[0].payload
      ? (payload[0].payload as TrendRow)
      : null;
  if (!row) return null;
  const low = row.n < MIN_ISOLATES;
  return (
    <div className="rounded-lg border border-border bg-card px-3.5 py-2.5">
      <p className="text-xs text-muted-foreground">{row.fullMonth}</p>
      <p className="mt-1 font-mono text-sm font-medium tabular-nums">
        {Math.round(row.sPct * 10) / 10}% susceptible
      </p>
      <p className="font-mono text-sm tabular-nums text-muted-foreground">n = {row.n}</p>
      {low && (
        <p className="mt-1 text-xs font-medium text-warning">
          n&lt;{MIN_ISOLATES} — interpret with caution
        </p>
      )}
    </div>
  );
}

/** Ward/organism/antibiotic selector (three call sites share this shape). */
function Selector(props: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const options = props.options.length > 0 ? props.options : [props.value];
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-muted-foreground">{props.label}</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function TrendsPage() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [data, setData] = useState<TrendResponse | null>(null);
  const [ward, setWard] = useState("All wards");
  // Initialized to the preferred combo so the first /api/trends request fires in
  // parallel with /api/meta instead of waiting for it (avoids a load waterfall).
  const [organism, setOrganism] = useState("Escherichia coli");
  const [antibiotic, setAntibiotic] = useState("Ciprofloxacin");
  const [sampleType, setSampleType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Meta arrives after (or alongside) the parallel trends fetch; reconcile the
  // selections once: keep any pick that exists in the meta lists, otherwise fall
  // back to the preferred combo (or the first available entry) — triggering a
  // single refetch when the initial default was not valid.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchJson<MetaResponse>("/api/meta")
      .then((m) => {
        if (cancelled) return;
        setMeta(m);
        const wantOrganism = m.organisms.includes("Escherichia coli")
          ? "Escherichia coli"
          : (m.organisms[0] ?? "");
        const wantAntibiotic = m.antibiotics.includes("Ciprofloxacin")
          ? "Ciprofloxacin"
          : (m.antibiotics[0] ?? "");
        setOrganism((prev) => (prev === "" || !m.organisms.includes(prev) ? wantOrganism : prev));
        setAntibiotic((prev) =>
          prev === "" || !m.antibiotics.includes(prev) ? wantAntibiotic : prev,
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Trend series — runs on mount in parallel with the meta request.
  useEffect(() => {
    if (organism === "" || antibiotic === "") return;
    let cancelled = false;
    setError(null);
    setData(null);
    setLoading(true);
    const params = new URLSearchParams({ ward, organism, antibiotic });
    if (sampleType !== "") params.set("sample", sampleType);
    fetchJson<TrendResponse>(`/api/trends?${params.toString()}`)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ward, organism, antibiotic, sampleType, attempt]);

  const rows: TrendRow[] = useMemo(() => {
    const points = data?.points ?? [];
    return points.map((p) => {
      const d = new Date(p.month);
      return {
        ...p,
        fullMonth: Number.isNaN(d.getTime()) ? p.month : MONTH_FULL.format(d),
      };
    });
  }, [data]);

  const nRange = useMemo(() => {
    if (rows.length === 0) return null;
    const ns = rows.map((r) => r.n);
    return { min: Math.min(...ns), max: Math.max(...ns) };
  }, [rows]);

  const wardOptions = useMemo(() => {
    const wards = meta?.wards ?? [];
    const list = wards.includes("All wards") ? wards : ["All wards", ...wards];
    return list.length > 0 ? list : ["All wards"];
  }, [meta]);

  const metaEmpty = meta !== null && (meta.organisms.length === 0 || meta.antibiotics.length === 0);

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Trends</h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          monthly % susceptible (S of S+R) · target ≥ 90% · hollow points n&lt;{MIN_ISOLATES}
        </p>
      </header>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Selector label="Ward" value={ward} options={wardOptions} onChange={setWard} />
        <Selector
          label="Organism"
          value={organism}
          options={meta?.organisms ?? []}
          onChange={setOrganism}
        />
        <Selector
          label="Antibiotic"
          value={antibiotic}
          options={meta?.antibiotics ?? []}
          onChange={setAntibiotic}
        />
        <label className="block">
          <span className="mb-1.5 block text-xs text-muted-foreground">Specimen type</span>
          <select
            value={sampleType}
            onChange={(e) => setSampleType(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
          >
            <option value="">All specimens</option>
            {(meta?.sampleTypes ?? []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <div className="mt-6 rounded-[10px] border border-border bg-card p-5">
          <p className="text-sm font-medium text-danger">Couldn&apos;t load trends</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="mt-4 h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      ) : loading || !data ? (
        metaEmpty ? (
          <p className="mt-6 rounded-[10px] border border-border bg-card p-5 text-sm text-muted-foreground">
            No organisms or antibiotics are available in the dataset yet.
          </p>
        ) : (
          <div aria-hidden className="mt-6 animate-pulse rounded-[10px] border border-border bg-card p-5">
            <div className="h-4 w-56 rounded bg-muted" />
            <div className="mt-3 h-3 w-40 rounded bg-muted" />
            <div className="mt-5 h-72 rounded-lg bg-muted" />
            <div className="mt-5 h-10 rounded-lg bg-muted" />
          </div>
        )
      ) : rows.length === 0 ? (
        <p className="mt-6 rounded-[10px] border border-border bg-card p-5 text-sm text-muted-foreground">
          No monthly data for this ward, organism, antibiotic and specimen combination. Try a
          different organism, antibiotic or ward.
        </p>
      ) : (
        <>
          <section className="mt-6 rounded-[10px] border border-border bg-card p-5">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Monthly susceptibility</h2>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                {data.organism} · {data.antibiotic} · {data.ward}
                {data.sampleType ? ` · ${data.sampleType}` : " · all specimens"}
                {nRange ? ` · n ${nRange.min}–${nRange.max}` : ""}
              </p>
            </div>

            <div className="mt-4 h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                  <CartesianGrid stroke={C.border} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 12, fill: C.mutedForeground }}
                    tickLine={false}
                    axisLine={{ stroke: C.border }}
                    interval="preserveStartEnd"
                    minTickGap={12}
                  />
                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                    tick={{ fontSize: 12, fill: C.mutedForeground }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                  />
                  <Tooltip content={<TrendTooltip />} cursor={{ stroke: C.border }} />
                  <ReferenceLine
                    y={90}
                    stroke={C.success}
                    strokeDasharray="6 4"
                    label={{
                      value: "Target 90%",
                      position: "insideTopRight",
                      fill: C.success,
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="sPct"
                    stroke="none"
                    fill={C.primary}
                    fillOpacity={0.06}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="sPct"
                    stroke={C.primary}
                    strokeWidth={2}
                    dot={TrendDot}
                    activeDot={{ r: 5, fill: C.primary, stroke: C.card, strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              Dot size reflects the number of first isolates (n). Hollow points have n&lt;
              {MIN_ISOLATES} — interpret with caution.
            </p>
          </section>

          <section className="mt-6 overflow-hidden rounded-[10px] border border-border bg-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold tracking-tight">Monthly detail</h2>
              <p className="text-xs text-muted-foreground">Dimmed rows have n&lt;{MIN_ISOLATES}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Month
                    </th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">
                      Susceptible (S%)
                    </th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">
                      Isolates (n)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const low = row.n < MIN_ISOLATES;
                    return (
                      <tr
                        key={row.month}
                        title={low ? `n<${MIN_ISOLATES} — interpret with caution` : undefined}
                        className={`border-b border-border last:border-b-0 hover:bg-muted/50${
                          low ? " text-muted-foreground/60" : ""
                        }`}
                      >
                        <td className="px-5 py-2.5">
                          <span className="font-medium">{row.label}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{row.fullMonth}</span>
                        </td>
                        <td className="px-5 py-2.5 text-right font-mono tabular-nums">
                          {Math.round(row.sPct * 10) / 10}%
                        </td>
                        <td className="px-5 py-2.5 text-right font-mono tabular-nums">{row.n}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
