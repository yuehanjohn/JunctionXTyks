"use client";

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import {
  type AlertInvestigationResponse,
  type MetaResponse,
  MIN_ISOLATES,
  type Signal,
  type SignalsResponse,
  type Workbench,
  type WorkbenchPathwayStep,
} from "@/lib/types";
import { Card, Delta, SeverityBadge, bandColor } from "@/components/ui";

// ── Constants ─────────────────────────────────────────────────────────

const SEVERITY_FILTERS = [
  { value: "all", label: "All severities" },
  { value: "high", label: "High" },
  { value: "moderate", label: "Moderate" },
  { value: "watch", label: "Watch" },
] as const;
type SeverityFilter = (typeof SEVERITY_FILTERS)[number]["value"];

/** Sentinel ward value the /api/signals endpoint reads as "scan hospital-wide". */
const EMPTY_WARD = "All wards";

const ACCENT = "var(--primary)";

const INPUT_CLASS =
  "h-9 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30";

// ── Formatting helpers ────────────────────────────────────────────────

/** Format a percentage with one decimal, trimming a trailing ".0". Used in
 *  lockstep across every call site so the same value always renders alike. */
function fmt(x: number): string {
  const rounded = Math.round(x * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** ISO date ("2025-10-16") → "16 Oct 2025". */
function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** ISO date → "16 Oct". */
function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** ISO date pair → "18 Sep – 16 Oct" (month collapsed when shared). */
function fmtRange(startIso: string, endIso: string): string {
  const a = fmtDay(startIso);
  const b = fmtDay(endIso);
  const [aDay, aMonth] = [a.slice(0, a.indexOf(" ")), a.slice(a.indexOf(" ") + 1)];
  const bMonth = b.slice(b.indexOf(" ") + 1);
  return aMonth === bMonth ? `${aDay} – ${b}` : `${a} – ${b}`;
}

// ── Fetch helper ──────────────────────────────────────────────────────

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

// ── Investigation drilldown state ─────────────────────────────────────

type InvEntry =
  | { status: "loading" }
  | { status: "ready"; data: AlertInvestigationResponse }
  | { status: "error"; message: string };

// ── Page ──────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [data, setData] = useState<SignalsResponse | null>(null);
  const [ward, setWard] = useState<string>(EMPTY_WARD);
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [asOf, setAsOf] = useState<string>("");
  const [firstLoad, setFirstLoad] = useState(true); // skeleton only until first result
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [investigations, setInvestigations] = useState<Record<string, InvEntry>>({});

  // Side-effect-free mirrors: in-flight investigation abort + current entries.
  const investAbortRef = useRef<AbortController | null>(null);
  const investRef = useRef<Record<string, InvEntry>>({});
  const investSeqRef = useRef(0);

  const severityId = useId();
  const wardId = useId();
  const replayId = useId();

  const commitInvestigations = useCallback(() => {
    setInvestigations({ ...investRef.current });
  }, []);

  const clearInvestigations = useCallback(() => {
    investAbortRef.current?.abort();
    investAbortRef.current = null;
    investRef.current = {};
    commitInvestigations();
    setOpenId(null);
  }, [commitInvestigations]);

  /** Fetch (or refetch) the investigation drilldown for one signal. */
  const loadInvestigation = useCallback(
    (id: string) => {
      investAbortRef.current?.abort();
      const ac = new AbortController();
      investAbortRef.current = ac;
      const seq = ++investSeqRef.current;
      investRef.current = { ...investRef.current, [id]: { status: "loading" } };
      commitInvestigations();
      const params = new URLSearchParams({ id });
      if (asOf) params.set("asOf", asOf);
      fetchJson<AlertInvestigationResponse>(`/api/alerts/investigate?${params}`, ac.signal)
        .then((inv) => {
          if (ac.signal.aborted || seq !== investSeqRef.current) return;
          investRef.current = { ...investRef.current, [id]: { status: "ready", data: inv } };
          commitInvestigations();
        })
        .catch((e: unknown) => {
          if (ac.signal.aborted || seq !== investSeqRef.current) return;
          investRef.current = {
            ...investRef.current,
            [id]: { status: "error", message: e instanceof Error ? e.message : "Unknown error" },
          };
          commitInvestigations();
        });
    },
    [asOf, commitInvestigations],
  );

  // Meta is non-fatal: it only seeds the ward list and replay date bounds.
  useEffect(() => {
    const ac = new AbortController();
    fetchJson<MetaResponse>("/api/meta", ac.signal)
      .then((m) => setMeta(m))
      .catch(() => undefined);
    return () => ac.abort();
  }, [attempt]);

  // Signals: soft refresh — previous data stays visible while refetching.
  useEffect(() => {
    const ac = new AbortController();
    setError(null);
    const params = new URLSearchParams({ ward });
    if (asOf) params.set("asOf", asOf);
    fetchJson<SignalsResponse>(`/api/signals?${params}`, ac.signal)
      .then((d) => {
        setData(d);
        setFirstLoad(false);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Unknown error");
        setFirstLoad(false);
      });
    return () => ac.abort();
  }, [ward, asOf, attempt]);

  // Filters changed → every cached drilldown is stale.
  useEffect(clearInvestigations, [clearInvestigations, ward, asOf]);

  const signals = useMemo(() => {
    if (!data) return [];
    return severity === "all" ? data.signals : data.signals.filter((s) => s.severity === severity);
  }, [data, severity]);

  const counts = useMemo(() => {
    const c = { high: 0, moderate: 0, watch: 0 };
    for (const s of data?.signals ?? []) c[s.severity] = (c[s.severity] ?? 0) + 1;
    return c;
  }, [data]);

  const toggle = useCallback(
    (id: string) => {
      if (openId === id) {
        investAbortRef.current?.abort();
        investAbortRef.current = null;
        setOpenId(null);
        return;
      }
      setOpenId(id);
      if (!investRef.current[id]) loadInvestigation(id);
    },
    [openId, loadInvestigation],
  );

  const windowLabel =
    data?.signals[0] !== undefined
      ? `${fmtRange(data.signals[0].windowStart, data.signals[0].windowEnd)} vs previous 12 months`
      : "rolling 4 weeks vs trailing 12 months";

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
      {/* 1. Header */}
      <header>
        <h1 className="text-xl font-bold tracking-tight">Resistance Alerts</h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
          Automatic two-proportion z-test scan: rolling 4 weeks vs trailing 12 months, first
          isolate per patient, minimum 30 isolates. A signal is a statistical finding for
          investigation — never a confirmed outbreak.
        </p>
      </header>

      {/* Error banner + retry */}
      {error && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">
          <span>Failed to load alerts ({error}).</span>
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="rounded-md border border-danger/40 bg-card px-3 py-1 text-[12px] font-medium text-danger hover:bg-danger/10"
          >
            Retry
          </button>
        </div>
      )}

      {/* 2. Control row */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div>
          <label
            htmlFor={severityId}
            className="mb-1 block text-[12px] font-medium text-muted-foreground"
          >
            Severity
          </label>
          <select
            id={severityId}
            value={severity}
            onChange={(e) => setSeverity(e.target.value as SeverityFilter)}
            className={INPUT_CLASS}
          >
            {SEVERITY_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor={wardId}
            className="mb-1 block text-[12px] font-medium text-muted-foreground"
          >
            Ward
          </label>
          <select
            id={wardId}
            value={ward}
            onChange={(e) => setWard(e.target.value)}
            className={INPUT_CLASS}
          >
            <option value={EMPTY_WARD}>All wards</option>
            {(meta?.wards ?? []).map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor={replayId}
            className="mb-1 block text-[12px] font-medium text-muted-foreground"
          >
            Historical replay
          </label>
          <input
            id={replayId}
            type="date"
            min={meta?.dateMin}
            max={meta?.dateMax}
            value={asOf}
            title="Recompute all windows as if today were this date. Leave empty for live data."
            onChange={(e) => setAsOf(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <span className="pb-2 text-[12px] text-muted-foreground">{windowLabel}</span>
      </div>

      {/* Historical replay notice */}
      {asOf && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-[13px] text-warning">
          Historical replay — viewing data as of {fmtDate(asOf)}. Windows are recomputed as if
          today were that date.
        </div>
      )}

      {/* 3. Summary strip */}
      {data && (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          <span className="tabular-nums">
            {data.scanned} cells scanned · {signals.length} signals flagged
          </span>
          {counts.high > 0 && (
            <span className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[11px] font-medium tabular-nums text-danger">
              {counts.high} high
            </span>
          )}
          {counts.moderate > 0 && (
            <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-medium tabular-nums text-warning">
              {counts.moderate} moderate
            </span>
          )}
          {counts.watch > 0 && (
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
              {counts.watch} watch
            </span>
          )}
        </div>
      )}

      {/* 4. Signal list */}
      <div className="flex flex-col gap-3">
        {firstLoad &&
          [0, 1, 2].map((i) => (
            <Card key={i} className="animate-pulse">
              <div className="h-4 w-1/3 rounded bg-muted" />
              <div className="mt-3 h-3 w-2/3 rounded bg-muted" />
            </Card>
          ))}

        {!firstLoad && data !== null && signals.length === 0 && (
          <Card>
            <p className="text-[14px] font-medium">No signals flagged in the current window</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Every ward × organism × antibiotic cell stayed within its trailing-baseline
              expectation — no statistically significant resistance shift to investigate.
            </p>
          </Card>
        )}

        {!firstLoad &&
          signals.map((s) => (
            <SignalCard
              key={s.id}
              signal={s}
              open={openId === s.id}
              onToggle={() => toggle(s.id)}
              investigation={investigations[s.id] ?? null}
              onRetry={() => loadInvestigation(s.id)}
            />
          ))}
      </div>
    </div>
  );
}

// ── One expandable signal card ────────────────────────────────────────

function SignalCard({
  signal,
  open,
  onToggle,
  investigation,
  onRetry,
}: {
  signal: Signal;
  open: boolean;
  onToggle: () => void;
  investigation: InvEntry | null;
  onRetry: () => void;
}) {
  return (
    <Card>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full text-left">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <SeverityBadge severity={signal.severity} />
          <span className="text-[14px] font-semibold">
            {signal.organism} — resistance to {signal.antibiotic}
          </span>
          <span className="text-[13px] text-muted-foreground">{signal.ward}</span>
          <span className="ml-auto text-[13px] text-muted-foreground" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
          <span className="tabular-nums">
            {fmt(signal.windowS)}% S in window (n={signal.nWindow}) vs {fmt(signal.baselineS)}% S
            baseline (n={signal.nBaseline})
          </span>
          <Delta delta={signal.dropPp} kind="pp" goodWhenUp={false} />
          <span className="tabular-nums">z = {signal.z.toFixed(2)}</span>
        </div>
      </button>

      {open && (
        <div className="mt-4 border-t border-border pt-4">
          {investigation === null || investigation.status === "loading" ? (
            <p className="text-[13px] text-muted-foreground">Fetching investigation…</p>
          ) : investigation.status === "error" ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-[13px] text-danger">
                Failed to load drilldown ({investigation.message}).
              </p>
              <button
                type="button"
                onClick={onRetry}
                className="rounded-md border border-border bg-card px-3 py-1 text-[12px] font-medium hover:bg-muted"
              >
                Retry
              </button>
            </div>
          ) : (
            <InvestigationBody data={investigation.data} />
          )}
        </div>
      )}
    </Card>
  );
}

// ── Drilldown: narrative, daily bar chart, hospital context ──────────

/** Tooltip for the daily resistance bars: label, %R and the n behind it. */
function ResistanceTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as { label: string; rPct: number; n: number } | undefined;
  if (!p) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-[12px] shadow-sm">
      <div className="font-medium">{p.label}</div>
      <div className="tabular-nums">
        {fmt(p.rPct)}% resistant · n={p.n}
      </div>
      {p.n < MIN_ISOLATES && (
        <div className="text-muted-foreground">n &lt; {MIN_ISOLATES} — not reported</div>
      )}
    </div>
  );
}

function InvestigationBody({ data }: { data: AlertInvestigationResponse }) {
  const { points, hospital, wardRank, signal } = data;

  // Backward safety: older cached responses may predate the workbench payload.
  const workbench: Workbench | null = "workbench" in data && data.workbench ? data.workbench : null;

  // First point on/after the window start anchors the reference line.
  const windowStartPoint = points.find((p) => p.date >= signal.windowStart);

  const covered = useMemo(() => {
    if (points.length === 0) return null;
    return `${fmtDay(points[0].date)} – ${fmtDay(points[points.length - 1].date)}`;
  }, [points]);

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-[13px] leading-relaxed">{data.narrative}</p>

      <div>
        <p className="mb-2 text-[12px] font-medium text-muted-foreground">
          Daily resistance (%R){covered ? ` · ${covered}` : ""}
        </p>
        {points.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No daily points for this cell.</p>
        ) : (
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  interval={11}
                  tickLine={false}
                  axisLine={{ stroke: "var(--color-border)" }}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                  unit="%"
                />
                <Tooltip content={<ResistanceTooltip />} cursor={{ fill: "transparent" }} />
                {windowStartPoint && (
                  <ReferenceLine
                    x={windowStartPoint.label}
                    stroke={ACCENT}
                    strokeDasharray="4 3"
                    label={{
                      value: "window start",
                      position: "insideTopRight",
                      fontSize: 10,
                      fill: ACCENT,
                    }}
                  />
                )}
                <Bar dataKey="rPct" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  {points.map((p) => (
                    <Cell key={p.date} fill={bandColor(p.rPct, signal.antibiotic)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          Bars use the resistance tone bands (green ≥90% S · amber 70–90% · red &lt;70%; grey
          markers where n &lt; {MIN_ISOLATES}); the dashed line marks the start of the current
          4-week window.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-[12px] font-medium text-muted-foreground">
            Hospital-wide same cell
          </p>
          <p className="text-[13px] tabular-nums">
            {fmt(hospital.rPct)}% R ({hospital.n} isolates)
          </p>
        </div>
        <div>
          <p className="mb-2 text-[12px] font-medium text-muted-foreground">Ward rank (%R)</p>
          {wardRank.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No ward breakdown available.</p>
          ) : (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-[12px] tabular-nums">
                <tbody>
                  {wardRank.map((r) => (
                    <tr
                      key={r.ward}
                      className={
                        r.ward === signal.ward ? "bg-primary/10 font-medium" : "odd:bg-muted/40"
                      }
                    >
                      <td className="px-3 py-1.5">{r.ward}</td>
                      <td className="px-3 py-1.5 text-right">{fmt(r.rPct)}%</td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">{r.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {workbench === null ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
          <div className="h-3.5 w-56 animate-pulse rounded bg-muted" />
          <div className="h-24 w-full animate-pulse rounded bg-muted" />
        </div>
      ) : (
        <InvestigationWorkbench wb={workbench} ward={signal.ward} />
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Wilson 95% CI and z-test computed on first isolates per patient; investigate
        sampling/laboratory context before any epidemiological conclusion.
      </p>
    </div>
  );
}

// ── Investigation workbench: isolates, pathways, co-location, imports ─

const PATHWAY_CAP = 8;

function InvestigationWorkbench({ wb, ward }: { wb: Workbench; ward: string }) {
  // Pathway steps grouped per patient, chronological ward sequence each.
  const pathways = useMemo(() => {
    const byPatient: Record<string, WorkbenchPathwayStep[]> = {};
    for (const step of wb.pathway) {
      (byPatient[step.patientRef] ??= []).push(step);
    }
    const entries = Object.entries(byPatient);
    for (const [, steps] of entries) steps.sort((a, b) => a.date.localeCompare(b.date));
    return entries;
  }, [wb.pathway]);
  const shownPathways = pathways.slice(0, PATHWAY_CAP);
  const extraPatients = pathways.length - shownPathways.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[13px] font-semibold">Investigation workbench</p>
        <p className="text-[11px] text-muted-foreground">
          Same organism + ward · trailing 60 days · anonymized patient references
        </p>
      </div>

      {/* Isolate timeline */}
      <div>
        <p className="mb-2 text-[12px] font-medium text-muted-foreground">Isolate timeline</p>
        {wb.isolates.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No isolates of this organism on {ward} in the trailing 60 days.
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-[12px] tabular-nums">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                  <th className="px-3 py-1.5 font-medium">Date</th>
                  <th className="px-3 py-1.5 font-medium">Sample type</th>
                  <th className="px-3 py-1.5 font-medium">Patient</th>
                  <th className="px-3 py-1.5 font-medium">Status</th>
                  <th className="px-3 py-1.5 font-medium">Phenotypes</th>
                  <th className="px-3 py-1.5 font-medium">Resistant to</th>
                </tr>
              </thead>
              <tbody>
                {wb.isolates.map((iso) => (
                  <tr key={iso.isolateId} className="odd:bg-muted/40">
                    <td className="px-3 py-1.5">{fmtDay(iso.date)}</td>
                    <td className="px-3 py-1.5">{iso.sampleType}</td>
                    <td className="px-3 py-1.5">{iso.patientRef}</td>
                    <td className="px-3 py-1.5">
                      <span
                        className={
                          iso.repeat
                            ? "rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                            : "rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                        }
                      >
                        {iso.repeat ? "repeat" : "new"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      {iso.phenotypes.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {iso.phenotypes.map((p) => (
                            <span
                              key={p}
                              className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium"
                            >
                              {p}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {iso.resistant.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        iso.resistant.join(", ")
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Patient pathway strip */}
      <div>
        <p className="mb-2 text-[12px] font-medium text-muted-foreground">
          Patient pathways (ward stays, chronological)
        </p>
        {pathways.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No ward movements recorded for the involved patients in this period.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {shownPathways.map(([patientRef, steps]) => (
              <div key={patientRef} className="flex flex-wrap items-center gap-1 text-[12px]">
                <span className="mr-1 font-medium tabular-nums text-muted-foreground">
                  {patientRef}
                </span>
                {steps.map((s, i) => (
                  <Fragment key={`${s.date}-${s.ward}`}>
                    {i > 0 && (
                      <span className="text-muted-foreground" aria-hidden>
                        →
                      </span>
                    )}
                    <span className="rounded-full border border-border bg-muted px-2 py-0.5">
                      {s.ward} · {fmtDay(s.date)}
                    </span>
                  </Fragment>
                ))}
              </div>
            ))}
            {extraPatients > 0 && (
              <span className="w-fit rounded-full border border-border bg-muted px-2 py-0.5 text-[12px] text-muted-foreground">
                +{extraPatients} more
              </span>
            )}
          </div>
        )}
      </div>

      {/* Co-location */}
      <p className="text-[13px]">
        <span className={wb.colocatedPatients >= 3 ? "font-bold" : ""}>
          {wb.colocatedPatients}
        </span>{" "}
        distinct patient{wb.colocatedPatients === 1 ? "" : "s"} carried this organism on {ward}{" "}
        within 14 days
      </p>

      {/* Putative import attribution */}
      {wb.importAttribution.length > 0 && (
        <div>
          <p className="mb-2 text-[13px]">
            Putative import sources (patients transferred in ≤14 days before their isolate) —
            hypothesis material, not proof:
          </p>
          <div className="max-h-40 overflow-y-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-[12px] tabular-nums">
              <thead>
                <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                  <th className="px-3 py-1.5 font-medium">Source ward</th>
                  <th className="px-3 py-1.5 text-right font-medium">Patients</th>
                </tr>
              </thead>
              <tbody>
                {wb.importAttribution.map((a) => (
                  <tr key={a.from} className="odd:bg-muted/40">
                    <td className="px-3 py-1.5">{a.from}</td>
                    <td className="px-3 py-1.5 text-right">{a.patients}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Checklist — population-level public-health actions, rendered verbatim */}
      {wb.checklist.length > 0 && (
        <div>
          <p className="mb-2 text-[12px] font-medium text-muted-foreground">Steps to consider</p>
          <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed">
            {wb.checklist.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
