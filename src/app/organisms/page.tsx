"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge, Card, Select, ToneLegend, toneColor } from "@/components/ui";
import type {
  AntibiogramResponse,
  MetaResponse,
  OrganismProfileResponse,
  ResistancePoint,
} from "@/lib/types";
import { MIN_ISOLATES, toneForR } from "@/lib/types";

// SVG presentation attributes cannot use CSS var(), so chart colors are literals
// mirroring the tokens in globals.css.
const C = {
  primary: "#0F6B7C",
  danger: "#B3261E",
  border: "#E3E6EA",
  mutedForeground: "#5B6472",
  card: "#ffffff",
} as const;

// Same specimen palette as the Overview donut; extra entries fall back.
const SPECIMEN_COLORS: Record<string, string> = {
  urine: "#2563eb",
  blood: "#dc2626",
  wound: "#16a34a",
};
const SPECIMEN_FALLBACK = ["#5B6472", "#7C3AED", "#0F6B7C"];

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

// One-decimal display rounding shared by 8+ call sites in lockstep.
const pct1 = (v: number) => Math.round(v * 10) / 10;

function specimenColor(sampleType: string, index: number): string {
  return SPECIMEN_COLORS[sampleType] ?? SPECIMEN_FALLBACK[index % SPECIMEN_FALLBACK.length];
}

/** Hollow red-ringed dot when n < MIN_ISOLATES (not statistically usable). */
function MonthlyDot(props: { cx?: number; cy?: number; payload?: ResistancePoint }) {
  const { cx, cy, payload } = props;
  if (typeof cx !== "number" || typeof cy !== "number" || !payload) return <g />;
  const low = payload.n < MIN_ISOLATES;
  return (
    <circle
      key={`dot-${payload.date}`}
      cx={cx}
      cy={cy}
      r={3.5}
      fill={low ? C.card : C.primary}
      stroke={low ? C.danger : C.primary}
      strokeWidth={low ? 1.6 : 0}
    />
  );
}

/** recharts clones this element with { active, payload, label, ... } per hover. */
function MonthlyTooltip(props: { active?: boolean; payload?: { payload?: unknown }[] }) {
  const { active, payload } = props;
  const row =
    active && payload && payload[0] && payload[0].payload
      ? (payload[0].payload as ResistancePoint)
      : null;
  if (!row) return null;
  const low = row.n < MIN_ISOLATES;
  return (
    <div className="rounded-lg border border-border bg-card px-3.5 py-2.5">
      <p className="text-xs text-muted-foreground">{row.label}</p>
      <p className="mt-1 font-mono text-sm font-medium tabular-nums">
        {pct1(row.rPct)}% resistant
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

export default function OrganismsPage() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [defaultOrganism, setDefaultOrganism] = useState("");
  const [organism, setOrganism] = useState("");
  const [ward, setWard] = useState("All wards");
  const [sample, setSample] = useState("");
  const [asOf, setAsOf] = useState("");
  const [profile, setProfile] = useState<OrganismProfileResponse | null>(null);
  const [monthlyAntibiotic, setMonthlyAntibiotic] = useState("");
  const [loading, setLoading] = useState(true);
  const [noOrganisms, setNoOrganisms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Once the visitor picks an organism explicitly, the auto-default must stop.
  const pickedRef = useRef(false);

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

  // Default organism = most common in the live 4-week window (antibiogram rows
  // are sorted by isolate count, so rows[0] is the winner).
  useEffect(() => {
    const controller = new AbortController();
    loadJson<AntibiogramResponse>("/api/antibiogram?window=4w", controller.signal)
      .then((abi) => {
        const first = abi.rows[0]?.organism ?? "";
        setDefaultOrganism(first);
        setNoOrganisms(first === "");
        if (!pickedRef.current) setOrganism(first);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (organism === "") return;
    const controller = new AbortController();
    setError(null);
    setLoading(true);
    const params = new URLSearchParams({ organism });
    if (ward !== "All wards") params.set("ward", ward);
    if (sample !== "") params.set("sample", sample);
    if (asOf !== "") params.set("asOf", asOf);
    // Soft refresh: the previous profile stays visible until this lands.
    loadJson<OrganismProfileResponse>(`/api/organism?${params.toString()}`, controller.signal)
      .then((p) => setProfile(p))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [organism, ward, sample, asOf, attempt]);

  // Monthly-chart antibiotic default: first panel cell with sufficient n that
  // also has a monthly series (cells are sorted by sPct desc).
  useEffect(() => {
    if (!profile) return;
    const monthlyList = profile.monthly.map((m) => m.antibiotic);
    setMonthlyAntibiotic((prev) => {
      if (prev !== "" && monthlyList.includes(prev)) return prev;
      const bestSufficient = profile.cells.find(
        (c) => c.sufficient && monthlyList.includes(c.antibiotic),
      );
      return bestSufficient?.antibiotic ?? monthlyList[0] ?? "";
    });
  }, [profile]);

  const organismOptions = useMemo(() => {
    if (organism === "") return [{ value: "", label: "Loading…" }];
    const list = meta?.organisms ?? [organism];
    return (list.includes(organism) ? list : [organism, ...list]).map((o) => ({
      value: o,
      label: o,
    }));
  }, [meta, organism]);

  const wardOptions = useMemo(() => {
    const wards = meta?.wards ?? [];
    const list = wards.includes("All wards") ? wards : ["All wards", ...wards];
    return list.map((w) => ({ value: w, label: w }));
  }, [meta]);

  const specimenOptions = useMemo(
    () => [
      { value: "", label: "All specimens" },
      ...(meta?.sampleTypes ?? []).map((t) => ({ value: t, label: t })),
    ],
    [meta],
  );

  const monthlyEntry = useMemo(
    () => profile?.monthly.find((m) => m.antibiotic === monthlyAntibiotic) ?? null,
    [profile, monthlyAntibiotic],
  );

  const specimenTotal = useMemo(
    () => (profile ? profile.specimen.reduce((sum, s) => sum + s.n, 0) : 0),
    [profile],
  );

  const dateMin = meta?.dateMin.slice(0, 10);
  const dateMax = meta?.dateMax.slice(0, 10);

  const empty = profile !== null && profile.n === 0;

  return (
    <div>
      <header>
        <h1 className="text-xl font-bold tracking-tight">Organism View</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {profile
            ? `${profile.organism} · ${profile.ward === "All wards" ? "all wards" : profile.ward} · rolling 4-week window · population-level surveillance`
            : "Per-organism susceptibility profile · rolling 4-week window"}
        </p>
      </header>

      <Card className="mt-5">
        <div className="flex flex-wrap items-end gap-4">
          <Select
            label="Organism"
            value={organism}
            options={organismOptions}
            onChange={(v) => {
              pickedRef.current = true;
              setOrganism(v);
            }}
            className="w-64"
          />
          <Select
            label="Ward"
            value={ward}
            options={wardOptions}
            onChange={setWard}
            className="w-48"
          />
          <Select
            label="Specimen type"
            value={sample}
            options={specimenOptions}
            onChange={setSample}
            className="w-44"
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
          <p className="text-sm font-medium text-danger">Couldn&apos;t load organism profile</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="mt-4 h-9 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Retry
          </button>
        </Card>
      ) : loading && !profile ? (
        noOrganisms ? (
          <Card className="mt-4">
            <p className="text-sm text-muted-foreground">
              No organisms are available in the dataset yet.
            </p>
          </Card>
        ) : (
          <div aria-hidden className="mt-4 animate-pulse">
            <Card>
              <div className="h-4 w-56 rounded bg-muted" />
              <div className="mt-4 h-56 rounded-lg bg-muted" />
            </Card>
          </div>
        )
      ) : profile ? (
        empty ? (
          <Card className="mt-4">
            <p className="text-sm text-muted-foreground">
              No isolates in this window — adjust the organism, ward, specimen or replay date.
            </p>
          </Card>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Card>
                <p className="text-[12px] font-medium text-muted-foreground">
                  First isolates (4 weeks)
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums">
                  {profile.n.toLocaleString("en-US")}
                </p>
              </Card>
              <Card>
                <p className="text-[12px] font-medium text-muted-foreground">
                  Share of all isolates in scope
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums">{pct1(profile.sharePct)}%</p>
              </Card>
              <Card>
                <p className="text-[12px] font-medium text-muted-foreground">Window</p>
                <p className="mt-1 text-[15px] font-semibold">
                  {fmtDay(profile.windowStart)} – {fmtDay(profile.windowEnd)}
                </p>
              </Card>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Card>
                <h2 className="text-sm font-semibold tracking-tight">
                  Susceptibility panel (last 4 weeks)
                </h2>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Higher is better — % susceptible (S of S+R) with Wilson 95% CI · first isolate
                  per patient
                </p>
                <div className="mt-4 space-y-2.5">
                  {profile.cells.map((cell) => (
                    <div
                      key={cell.antibiotic}
                      className="grid grid-cols-[150px_minmax(0,1fr)_auto] items-center gap-3"
                      title={
                        cell.sufficient
                          ? `${cell.antibiotic}: ${pct1(cell.sPct)}% susceptible, 95% CI ${pct1(cell.ciLo)}–${pct1(cell.ciHi)}%, n=${cell.n}`
                          : `${cell.antibiotic}: n=${cell.n} (<${MIN_ISOLATES}) — not reported`
                      }
                    >
                      <span className="truncate text-[13px] font-medium">{cell.antibiotic}</span>
                      <div className="relative h-2 rounded-full bg-muted">
                        {cell.sufficient && (
                          <>
                            <div
                              className="absolute inset-y-0 rounded-full"
                              style={{
                                left: `${Math.min(100, Math.max(0, cell.ciLo))}%`,
                                width: `${Math.min(100, Math.max(0, cell.ciHi - cell.ciLo))}%`,
                                backgroundColor: toneColor(
                                  toneForR(100 - cell.sPct, cell.n, null, cell.antibiotic),
                                ),
                              }}
                            />
                            <div
                              className="absolute -top-0.5 h-3 w-0.5 rounded bg-foreground/60"
                              style={{ left: `${Math.min(100, Math.max(0, cell.sPct))}%` }}
                            />
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-14 text-right font-mono text-[13px] font-semibold tabular-nums">
                          {cell.sufficient ? `${pct1(cell.sPct)}%` : "—"}
                        </span>
                        <span className="w-16 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                          n={cell.n}
                        </span>
                        {!cell.sufficient && <Badge tone="neutral">n&lt;{MIN_ISOLATES}</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card>
                <h2 className="text-sm font-semibold tracking-tight">Resistance by ward</h2>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  % resistant (R/(S+R)) across the standard panel
                </p>
                <table className="mt-3 w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="py-2 font-medium">
                        Ward
                      </th>
                      <th scope="col" className="py-2 text-right font-medium">
                        Isolates
                      </th>
                      <th scope="col" className="py-2 text-right font-medium">
                        Resistance %
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.wards.map((row) => (
                      <tr key={row.ward} className="border-b border-border last:border-b-0">
                        <td className="py-2 font-medium">{row.ward}</td>
                        <td className="py-2 text-right font-mono tabular-nums">{row.n}</td>
                        <td className="py-2 text-right">
                          {row.rPct === null || row.n < MIN_ISOLATES ? (
                            <span
                              className="text-muted-foreground"
                              title={`${row.ward} — n=${row.n} (<${MIN_ISOLATES}, not reported)`}
                            >
                              —
                            </span>
                          ) : (
                            <span
                              className="inline-block rounded px-2 py-0.5 tabular-nums"
                              style={{ backgroundColor: toneColor(row.tone) }}
                              title={`${row.ward} — ${pct1(row.rPct)}% resistant, n=${row.n} results${row.baselineR !== null ? `, 12-month baseline ${pct1(row.baselineR)}%` : ""}`}
                            >
                              {pct1(row.rPct)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ToneLegend />
              </Card>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold tracking-tight">
                      Monthly resistance per antibiotic
                    </h2>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      Trailing 12 months · % resistant (R/(S+R)) · hollow red-ringed points
                      n&lt;{MIN_ISOLATES}
                    </p>
                  </div>
                  <Select
                    label="Antibiotic"
                    value={monthlyAntibiotic}
                    options={profile.monthly.map((m) => ({ value: m.antibiotic, label: m.antibiotic }))}
                    onChange={setMonthlyAntibiotic}
                    className="w-52"
                  />
                </div>
                {monthlyEntry && monthlyEntry.points.length > 0 ? (
                  <>
                    <div className="mt-4 h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={monthlyEntry.points}
                          margin={{ top: 8, right: 12, bottom: 0, left: -16 }}
                        >
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
                          <Tooltip content={<MonthlyTooltip />} cursor={{ stroke: C.border }} />
                          <Line
                            type="monotone"
                            dataKey="rPct"
                            stroke={C.primary}
                            strokeWidth={2}
                            dot={MonthlyDot}
                            activeDot={{ r: 5, fill: C.primary, stroke: C.card, strokeWidth: 2 }}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                ) : (
                  <p className="mt-4 text-[13px] text-muted-foreground">
                    No monthly data for this antibiotic.
                  </p>
                )}
              </Card>

              <Card>
                <h2 className="text-sm font-semibold tracking-tight">Specimen distribution</h2>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Specimen types behind this organism&apos;s window isolates
                </p>
                <div className="relative mt-3 h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={profile.specimen}
                        dataKey="n"
                        nameKey="sampleType"
                        innerRadius="62%"
                        outerRadius="88%"
                        paddingAngle={2}
                        stroke="#ffffff"
                        strokeWidth={2}
                        isAnimationActive={false}
                      >
                        {profile.specimen.map((s, index) => (
                          <Cell key={s.sampleType} fill={specimenColor(s.sampleType, index)} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-mono text-lg font-bold tabular-nums">
                      {specimenTotal.toLocaleString("en-US")}
                    </span>
                    <span className="text-[11px] text-muted-foreground">isolates</span>
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {profile.specimen.map((s, index) => (
                    <li key={s.sampleType} className="flex items-center justify-between text-[13px]">
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="inline-block h-2.5 w-2.5 rounded-sm"
                          style={{ backgroundColor: specimenColor(s.sampleType, index) }}
                        />
                        {s.sampleType}
                      </span>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {pct1(s.sharePct)}% ({s.n})
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>

            <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
              Percentages from first isolates per patient per organism; susceptibility = S/(S+R),
              resistance = R/(S+R); Wilson 95% CI on the panel; cells with n&lt;{MIN_ISOLATES} are
              not reported. All data synthetic — population-level surveillance only, not a
              treatment guideline.
            </p>
          </>
        )
      ) : null}
    </div>
  );
}
