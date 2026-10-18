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
import { AntibiogramMatrix, type CellFocus } from "@/components/antibiogram";
import { Card, Delta, Select } from "@/components/ui";
import type { SelectOption } from "@/components/ui";
import type {
  AntibiogramResponse,
  MetaResponse,
  SusCell,
  TrendPoint,
  TrendResponse,
} from "@/lib/types";
import { AGE_BANDS, FILTER_ALL, MIN_ISOLATES } from "@/lib/types";

const SEX_LABELS: Record<string, string> = { F: "Female", M: "Male" };

// SVG presentation attributes cannot use CSS var(), so chart colors are literals
// mirroring the tokens in globals.css.
const C = {
  primary: "#0F6B7C",
  success: "#177245",
  danger: "#B3261E",
  border: "#E3E6EA",
  mutedForeground: "#5B6472",
  card: "#ffffff",
} as const;

const MONTH_FULL = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

type TrendRow = TrendPoint & { fullMonth: string };

async function loadJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

// One-decimal display rounding shared by 10+ call sites in lockstep.
const pct1 = (v: number) => Math.round(v * 10) / 10;

/** Custom dot: size grows with n; hollow red-ringed circle when n < MIN_ISOLATES
 *  (statistically unusable — visually distinct from the filled petrol dots). */
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
      stroke={low ? C.danger : C.primary}
      strokeWidth={low ? 1.6 : 0}
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
        {pct1(row.sPct)}% susceptible
      </p>
      <p className="font-mono text-sm tabular-nums text-muted-foreground">n = {row.n}</p>
      {low && (
        <p className="mt-1 text-xs font-medium text-warning">
          n&lt;{MIN_ISOLATES}: not statistically usable
        </p>
      )}
    </div>
  );
}

/** Option-list builder shared by the organism/antibiotic/specimen selects so
 *  their "no filter" sentinel behavior stays in lockstep (3 call sites). */
function toOptions(values: string[], allLabel?: string): SelectOption[] {
  return [
    ...(allLabel !== undefined ? [{ value: "", label: allLabel }] : []),
    ...values.map((v) => ({ value: v, label: v })),
  ];
}

export default function TrendsPage() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [data, setData] = useState<TrendResponse | null>(null);
  const [abi4w, setAbi4w] = useState<AntibiogramResponse | null>(null);
  const [abi1y, setAbi1y] = useState<AntibiogramResponse | null>(null);
  const [matrixWindow, setMatrixWindow] = useState<"4w" | "1y">("4w");
  const [matrixFocus, setMatrixFocus] = useState<CellFocus | null>(null);
  const [ward, setWard] = useState("All wards");
  // Initialized to the preferred combo so the first /api/trends request fires in
  // parallel with /api/meta instead of waiting for it (avoids a load waterfall).
  const [organism, setOrganism] = useState("Escherichia coli");
  const [antibiotic, setAntibiotic] = useState("Ciprofloxacin");
  const [sampleType, setSampleType] = useState("");
  const [sex, setSex] = useState(FILTER_ALL);
  const [ageBand, setAgeBand] = useState(FILTER_ALL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Meta arrives after (or alongside) the parallel trends fetch; reconcile the
  // selections once: keep any pick that exists in the meta lists, otherwise fall
  // back to the preferred combo (or the first available entry).
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    loadJson<MetaResponse>("/api/meta", controller.signal)
      .then((m) => {
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
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      });
    return () => controller.abort();
  }, [attempt]);

  // Monthly trend series — runs on mount in parallel with the meta request.
  // Soft refresh: the previous series stays visible until the new one lands.
  useEffect(() => {
    if (organism === "" || antibiotic === "") return;
    const controller = new AbortController();
    setError(null);
    setLoading(true);
    const params = new URLSearchParams({ ward, organism, antibiotic });
    if (sampleType !== "") params.set("sample", sampleType);
    if (sex !== FILTER_ALL) params.set("sex", sex);
    if (ageBand !== FILTER_ALL) params.set("age", ageBand);
    loadJson<TrendResponse>(`/api/trends?${params.toString()}`, controller.signal)
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
  }, [ward, organism, antibiotic, sampleType, sex, ageBand, attempt]);

  // Antibiogram 4w + 1y in parallel: feeds both the matrix card and the
  // current-window vs baseline summary line for the selected organism/antibiotic.
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ ward });
    if (sampleType !== "") params.set("sample", sampleType);
    if (sex !== FILTER_ALL) params.set("sex", sex);
    if (ageBand !== FILTER_ALL) params.set("age", ageBand);
    Promise.all([
      loadJson<AntibiogramResponse>(`/api/antibiogram?window=4w&${params.toString()}`, controller.signal),
      loadJson<AntibiogramResponse>(`/api/antibiogram?window=1y&${params.toString()}`, controller.signal),
    ])
      .then(([fourWeeks, year]) => {
        setAbi4w(fourWeeks);
        setAbi1y(year);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      });
    return () => controller.abort();
  }, [ward, sampleType, sex, ageBand, attempt]);

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

  // Window vs baseline for the selected cell, from the two antibiogram windows.
  const summary = useMemo(() => {
    const find = (abi: AntibiogramResponse | null): SusCell | null =>
      abi?.rows.find((row) => row.organism === organism)?.cells.find(
        (c) => c.antibiotic === antibiotic,
      ) ?? null;
    return { win: find(abi4w), base: find(abi1y) };
  }, [abi4w, abi1y, organism, antibiotic]);

  const wardOptions: SelectOption[] = useMemo(() => {
    const wards = meta?.wards ?? [];
    const list = wards.includes("All wards") ? wards : ["All wards", ...wards];
    return (list.length > 0 ? list : ["All wards"]).map((w) => ({ value: w, label: w }));
  }, [meta]);

  const sexOptions: SelectOption[] = useMemo(
    () => [
      { value: FILTER_ALL, label: "All sexes" },
      ...(meta?.sexes ?? []).map((s) => ({ value: s, label: SEX_LABELS[s] ?? s })),
    ],
    [meta],
  );

  const ageOptions: SelectOption[] = useMemo(
    () => [
      { value: FILTER_ALL, label: "All ages" },
      ...AGE_BANDS.map((b) => ({ value: b.id, label: b.label })),
    ],
    [],
  );

  const metaEmpty = meta !== null && (meta.organisms.length === 0 || meta.antibiotics.length === 0);

  const scopeLine = data
    ? [
        data.organism,
        data.antibiotic,
        data.ward,
        data.sampleType ?? "all specimens",
        data.sex ? (SEX_LABELS[data.sex] ?? data.sex) : null,
        data.ageBand
          ? `age ${AGE_BANDS.find((b) => b.id === data.ageBand)?.label ?? data.ageBand}`
          : null,
      ]
        .filter((part) => part !== null)
        .join(" · ")
    : "";

  return (
    <div>
      <header>
        <h1 className="text-xl font-bold tracking-tight">Trends &amp; Analytics</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          24-month monthly susceptibility · % susceptible (S of S+R), first isolate per patient ·
          dot size reflects n · hollow red-ringed points have n&lt;{MIN_ISOLATES}
        </p>
      </header>

      <Card className="mt-5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          <Select label="Ward" value={ward} options={wardOptions} onChange={setWard} />
          <Select
            label="Organism"
            value={organism}
            options={toOptions(meta?.organisms ?? [])}
            onChange={setOrganism}
          />
          <Select
            label="Antibiotic"
            value={antibiotic}
            options={toOptions(meta?.antibiotics ?? [])}
            onChange={setAntibiotic}
          />
          <Select
            label="Specimen type"
            value={sampleType}
            options={toOptions(meta?.sampleTypes ?? [], "All specimens")}
            onChange={setSampleType}
          />
          <Select label="Patient sex" value={sex} options={sexOptions} onChange={setSex} />
          <Select label="Age band" value={ageBand} options={ageOptions} onChange={setAgeBand} />
        </div>
      </Card>

      {error ? (
        <Card className="mt-5">
          <p className="text-sm font-medium text-danger">Couldn&apos;t load trends</p>
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
        metaEmpty ? (
          <Card className="mt-5">
            <p className="text-sm text-muted-foreground">
              No organisms or antibiotics are available in the dataset yet.
            </p>
          </Card>
        ) : (
          <div aria-hidden className="mt-5 animate-pulse">
            <Card>
              <div className="h-4 w-64 rounded bg-muted" />
              <div className="mt-2 h-3 w-44 rounded bg-muted" />
              <div className="mt-5 h-72 rounded-lg bg-muted" />
            </Card>
          </div>
        )
      ) : data && rows.length === 0 ? (
        <Card className="mt-5">
          <p className="text-sm text-muted-foreground">
            No monthly data for this ward, organism, antibiotic and specimen combination. Try a
            different organism, antibiotic or ward.
          </p>
        </Card>
      ) : data ? (
        <>
          <Card className="mt-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold tracking-tight">
                Susceptibility trend — 24 months
              </h2>
              <p className="font-mono text-[11px] text-muted-foreground">{scopeLine}</p>
            </div>

            {/* Current window vs baseline, from the two antibiogram windows */}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px]">
              {summary.win === null || !summary.win.sufficient ? (
                <span className="text-muted-foreground">
                  Last 4 weeks: n&lt;{MIN_ISOLATES} — not reported
                </span>
              ) : (
                <span className="tabular-nums">
                  Last 4 weeks:{" "}
                  <span className="font-semibold">{pct1(summary.win.sPct)}%</span> susceptible{" "}
                  <span className="text-muted-foreground">(n={summary.win.n})</span>
                </span>
              )}
              {summary.base !== null && summary.base.sufficient && (
                <span className="tabular-nums">
                  Trailing 12 months: {pct1(summary.base.sPct)}%{" "}
                  <span className="text-muted-foreground">(n={summary.base.n})</span>
                </span>
              )}
              {summary.win?.sufficient && summary.base?.sufficient && (
                <Delta
                  delta={pct1(summary.win.sPct - summary.base.sPct)}
                  kind="pp"
                  goodWhenUp
                />
              )}
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
              % susceptible = S/(S+R) among first isolates per patient. Hollow red-ringed points
              have n&lt;{MIN_ISOLATES} — not statistically usable.
            </p>
          </Card>

          <section className="mt-5 overflow-hidden rounded-[10px] border border-border bg-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold tracking-tight">Monthly detail</h2>
              <p className="text-xs text-muted-foreground">
                Dimmed rows have n&lt;{MIN_ISOLATES}
              </p>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th scope="col" className="sticky top-0 bg-card px-5 py-2.5 font-medium">
                      Month
                    </th>
                    <th scope="col" className="sticky top-0 bg-card px-5 py-2.5 text-right font-medium">
                      Susceptible (S%)
                    </th>
                    <th scope="col" className="sticky top-0 bg-card px-5 py-2.5 text-right font-medium">
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
                        title={low ? `n<${MIN_ISOLATES} — not statistically usable` : undefined}
                        className={`border-b border-border last:border-b-0 hover:bg-muted/50${
                          low ? " text-muted-foreground/60" : ""
                        }`}
                      >
                        <td className="px-5 py-2.5">
                          <span className="font-medium">{row.label}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{row.fullMonth}</span>
                        </td>
                        <td className="px-5 py-2.5 text-right font-mono tabular-nums">
                          {pct1(row.sPct)}%
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
      ) : null}

      <Card className="mt-5" padding="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Antibiogram (all organisms)</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Every organism × antibiotic cell in scope — click a cell to focus it.
            </p>
          </div>
          <Select
            label="Matrix window"
            value={matrixWindow}
            options={[
              { value: "4w", label: "Last 4 weeks" },
              { value: "1y", label: "Trailing 12 months" },
            ]}
            onChange={(v) => setMatrixWindow(v === "1y" ? "1y" : "4w")}
            className="w-52"
          />
        </div>
        <div className="mt-4">
          {abi4w && abi1y ? (
            <AntibiogramMatrix
              data={matrixWindow === "4w" ? abi4w : abi1y}
              annual={abi1y}
              showAnnual={matrixWindow === "4w"}
              focus={matrixFocus}
              onSelect={setMatrixFocus}
            />
          ) : (
            <div aria-hidden className="h-44 animate-pulse rounded-lg bg-muted" />
          )}
        </div>
      </Card>

      <p className="mt-5 text-[12px] leading-relaxed text-muted-foreground">
        Methodology: first isolate per patient per organism per period (EARS-Net practice) ·
        % susceptible = S/(S+R) · Wilson 95% CI per antibiogram cell · percentages reported only
        when n ≥ {MIN_ISOLATES} · rolling 4-week window vs trailing 12-month baseline · all data
        synthetic — population-level surveillance only, not a treatment guideline.
      </p>
    </div>
  );
}
