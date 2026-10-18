"use client";

import { useEffect, useId, useMemo, useState } from "react";

import { AlertCard } from "@/components/overview/alert-card";
import {
  RecentIsolatesCard,
  SpecimenCard,
  TopOrganismsCard,
} from "@/components/overview/bottom-row";
import { HeatmapCard } from "@/components/overview/heatmap-card";
import { InsightsCard } from "@/components/overview/insights-card";
import { KpiRow } from "@/components/overview/kpi-cards";
import { ALL_WARDS, fmtDayMonth, fmtTime, fmtWindow } from "@/components/overview/format";
import { TrendChartCard } from "@/components/overview/trend-chart";
import { Badge, Card, Select, type SelectOption } from "@/components/ui";
import {
  FILTER_ALL,
  type AlertInvestigationResponse,
  type HeatmapResponse,
  type MetaResponse,
  type OverviewResponse,
} from "@/lib/types";

// ── Fetch plumbing ────────────────────────────────────────────────────

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Request failed (${res.status} ${res.statusText})`);
  return (await res.json()) as T;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

/** Shared filter query for Pulse endpoints. Sentinels are omitted here AND
 *  normalized server-side (normSample) — belt and braces. */
function filterQuery(ward: string, sample: string, asOf: string): string {
  const params = new URLSearchParams();
  if (ward && ward !== ALL_WARDS) params.set("ward", ward);
  if (sample && sample !== FILTER_ALL) params.set("sample", sample);
  if (asOf) params.set("asOf", asOf);
  return params.toString();
}

// ── Static page furniture ─────────────────────────────────────────────

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[10px] border border-danger/30 bg-danger/5 px-4 py-2.5">
      <p className="text-[13px] text-danger">Failed to load data: {message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-lg border border-danger/40 px-3 py-1 text-xs font-semibold text-danger hover:bg-danger/10"
      >
        Retry
      </button>
    </div>
  );
}

function SkeletonGrid() {
  const kpi = [0, 1, 2, 3];
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpi.map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-[10px] border border-border bg-card" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="h-80 animate-pulse rounded-[10px] border border-border bg-card xl:col-span-2" />
        <div className="h-80 animate-pulse rounded-[10px] border border-border bg-card" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="h-64 animate-pulse rounded-[10px] border border-border bg-card xl:col-span-2" />
        <div className="h-64 animate-pulse rounded-[10px] border border-border bg-card" />
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────

export default function Page() {
  // Filters — every card on the page refetches through the API; no DOM-only filtering.
  const [ward, setWard] = useState(ALL_WARDS);
  const [sample, setSample] = useState(FILTER_ALL);
  /** "YYYY-MM-DD" for historical replay; "" = live feed. */
  const [asOf, setAsOf] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);

  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapResponse | null>(null);
  const [investigation, setInvestigation] = useState<{
    id: string;
    data: AlertInvestigationResponse;
  } | null>(null);
  /** Heatmap organism; defaults to the window's most common organism. */
  const [organism, setOrganism] = useState<string | null>(null);

  const [overviewBusy, setOverviewBusy] = useState(false);
  const [heatmapBusy, setHeatmapBusy] = useState(false);
  const [investigationBusy, setInvestigationBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const replayId = useId();

  // Meta is filter-independent: fetch once, retry via the error banner.
  useEffect(() => {
    const ac = new AbortController();
    fetchJson<MetaResponse>("/api/meta", ac.signal)
      .then((data) => {
        if (!ac.signal.aborted) {
          setMeta(data);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!ac.signal.aborted && !isAbortError(err)) setError(errorMessage(err));
      });
    return () => ac.abort();
  }, [retryNonce]);

  const topSignal = overview?.alerts[0] ?? null;

  // Overview — refetch on every filter change; reconcile the heatmap organism default.
  useEffect(() => {
    const ac = new AbortController();
    setOverviewBusy(true);
    fetchJson<OverviewResponse>(`/api/overview?${filterQuery(ward, sample, asOf)}`, ac.signal)
      .then((data) => {
        if (ac.signal.aborted) return;
        setOverview(data);
        setOverviewBusy(false);
        setError(null);
        const top = data.topOrganisms.map((t) => t.organism);
        setOrganism((prev) =>
          prev && top.includes(prev)
            ? prev
            : (data.kpis.mostCommonOrganism?.organism ?? top[0] ?? null),
        );
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted || isAbortError(err)) return;
        setOverviewBusy(false);
        setError(errorMessage(err));
      });
    return () => ac.abort();
  }, [ward, sample, asOf, retryNonce]);

  // Heatmap — needs an organism; the default resolves once the overview lands.
  useEffect(() => {
    if (!organism) return;
    const ac = new AbortController();
    setHeatmapBusy(true);
    fetchJson<HeatmapResponse>(
      `/api/heatmap?organism=${encodeURIComponent(organism)}&${filterQuery(ward, sample, asOf)}`,
      ac.signal,
    )
      .then((data) => {
        if (ac.signal.aborted) return;
        setHeatmap(data);
        setHeatmapBusy(false);
        setError(null);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted || isAbortError(err)) return;
        setHeatmapBusy(false);
        setError(errorMessage(err));
      });
    return () => ac.abort();
  }, [ward, sample, asOf, organism, retryNonce]);

  // Investigation — lazy: only the top signal, only when the alert card renders it.
  const topSignalId = topSignal?.id ?? null;
  useEffect(() => {
    if (!topSignalId) {
      setInvestigation(null);
      return;
    }
    const ac = new AbortController();
    setInvestigationBusy(true);
    const params = new URLSearchParams({ id: topSignalId });
    if (asOf) params.set("asOf", asOf);
    fetchJson<AlertInvestigationResponse>(`/api/alerts/investigate?${params.toString()}`, ac.signal)
      .then((data) => {
        if (ac.signal.aborted) return;
        setInvestigation({ id: topSignalId, data });
        setInvestigationBusy(false);
        setError(null);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted || isAbortError(err)) return;
        setInvestigationBusy(false);
        setError(errorMessage(err));
      });
    return () => ac.abort();
  }, [topSignalId, asOf, retryNonce]);

  // Only show investigation data that belongs to the currently displayed top signal.
  const investigationForTop =
    investigation && topSignal && investigation.id === topSignal.id ? investigation.data : null;

  // Only show heatmap data for the organism the select displays right now.
  const heatmapForOrganism = heatmap && organism && heatmap.organism === organism ? heatmap : null;

  const wardOptions = useMemo<SelectOption[]>(
    () =>
      meta
        ? [
            { value: ALL_WARDS, label: "All wards" },
            ...meta.wards
              .filter((w) => w !== ALL_WARDS)
              .map((w) => ({ value: w, label: w })),
          ]
        : [{ value: ward, label: "Loading…" }],
    [meta, ward],
  );

  const sampleOptions = useMemo<SelectOption[]>(
    () =>
      meta
        ? [
            { value: FILTER_ALL, label: "All specimens" },
            ...meta.sampleTypes.map((s) => ({
              value: s,
              label: s.charAt(0).toUpperCase() + s.slice(1),
            })),
          ]
        : [{ value: sample, label: "Loading…" }],
    [meta, sample],
  );

  const organismOptions = useMemo<SelectOption[]>(
    () =>
      overview && overview.topOrganisms.length > 0
        ? overview.topOrganisms.map((t) => ({ value: t.organism, label: t.organism }))
        : (meta?.organisms ?? []).map((o) => ({ value: o, label: o })),
    [overview, meta],
  );

  const firstLoad = !overview;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-bold text-foreground">Antimicrobial Resistance Overview</h1>
        <p className="text-[13px] text-muted-foreground">
          Real-time surveillance from Tyks Laboratories · first isolate per patient, minimum 30
          isolates
        </p>
      </header>

      {error ? <ErrorBanner message={error} onRetry={() => setRetryNonce((n) => n + 1)} /> : null}

      <Card className="flex flex-wrap items-end gap-4">
        <Select
          label="Ward"
          value={ward}
          options={wardOptions}
          onChange={setWard}
          className="w-44"
        />
        <Select
          label="Specimen type"
          value={sample}
          options={sampleOptions}
          onChange={setSample}
          className="w-44"
        />
        <div>
          <label htmlFor={replayId} className="mb-1 block text-[12px] font-medium text-muted-foreground">
            Historical replay
          </label>
          <div className="flex items-center gap-2">
            <input
              id={replayId}
              type="date"
              value={asOf}
              min={meta && meta.dateMin ? meta.dateMin.slice(0, 10) : undefined}
              max={meta && meta.dateMax ? meta.dateMax.slice(0, 10) : undefined}
              onChange={(event) => setAsOf(event.target.value)}
              className="h-9 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            <span
              className="cursor-help text-muted-foreground"
              title="Historical replay: every card is recomputed as if 'now' were the chosen date — windows, KPIs, alerts and heatmaps all shift. Clear the date to return to the live feed."
            >
              <InfoIcon />
            </span>
            {asOf ? (
              <button
                type="button"
                onClick={() => setAsOf("")}
                className="text-xs font-medium text-primary hover:underline"
              >
                Live
              </button>
            ) : null}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 self-center pb-1.5">
          <span className="text-[13px] text-muted-foreground tabular-nums">
            Window:{" "}
            {overview ? fmtWindow(overview.windowStart, overview.windowEnd) : "—"} · compared to
            previous 4 weeks
          </span>
          {asOf ? <Badge tone="warning">Historical replay</Badge> : null}
          {overviewBusy && overview ? (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              Updating…
            </span>
          ) : null}
        </div>
      </Card>

      {firstLoad || !overview ? (
        <SkeletonGrid />
      ) : (
        <>
          <KpiRow overview={overview} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="min-w-0 xl:col-span-2">
              <TrendChartCard series={overview.series} busy={overviewBusy} />
            </div>
            <AlertCard
              alertCount={overview.alertCount}
              topSignal={topSignal}
              investigation={investigationForTop}
              busy={investigationBusy}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="min-w-0 xl:col-span-2">
              <HeatmapCard
                heatmap={heatmapForOrganism}
                organism={organism}
                organismOptions={organismOptions}
                onOrganismChange={setOrganism}
                busy={heatmapBusy}
              />
            </div>
            <InsightsCard
              overview={overview}
              investigation={investigationForTop}
              heatmap={heatmapForOrganism}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <SpecimenCard specimen={overview.specimen} />
            <TopOrganismsCard topOrganisms={overview.topOrganisms} />
            <RecentIsolatesCard recentIsolates={overview.recentIsolates} />
          </div>

          <footer className="text-[11px] text-muted-foreground">
            Last updated {fmtTime(overview.generatedAt)} · data through{" "}
            {fmtDayMonth(overview.windowEnd)} · all data synthetic
          </footer>
        </>
      )}
    </div>
  );
}
