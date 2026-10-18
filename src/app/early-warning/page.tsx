"use client";

import { useEffect, useId, useMemo, useState } from "react";

import { BacktestCard } from "@/components/early-warning/backtest-card";
import {
  Busy,
  C,
  CardHeading,
  ConfigChips,
  LoadError,
  SkeletonCard,
  fmtNum,
  fmtWindow,
  loadJson,
} from "@/components/early-warning/bits";
import {
  MdroWardCard,
  MdroWeeklyCard,
  RecentIsolatesCard,
} from "@/components/early-warning/mdro-cards";
import { PathwaysCard } from "@/components/early-warning/pathways-card";
import { TransmissionMap } from "@/components/early-warning/transmission-map";
import { WarningFeedCard } from "@/components/early-warning/warning-feed";
import { Badge, Card, Select } from "@/components/ui";
import type { SelectOption } from "@/components/ui";
import type {
  MetaResponse,
  MdroResponse,
  PathwaysResponse,
  WarningFeedResponse,
} from "@/lib/types";

const ALL_WARDS = "All wards";
/** Hospital-wide false-alarm budget the detector stack was tuned against. */
const MONTHLY_BUDGET = 2;

type EndpointErrors = { warning?: string; mdro?: string; pathways?: string };

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

/** "N warnings this window" against the tuned false-alarm budget, with the
 *  detector thresholds as chips and the alarm-fatigue framing spelled out. */
function BudgetMeter({
  feed,
  loading,
  refreshing,
  error,
  onRetry,
  className = "",
}: {
  feed: WarningFeedResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRetry: () => void;
  className?: string;
}) {
  const expected = feed?.expectedPerMonth ?? null;
  const fillPct =
    expected === null ? 0 : Math.min(100, Math.max(expected > 0 ? 4 : 0, (expected / MONTHLY_BUDGET) * 100));

  return (
    <Card className={className}>
      <CardHeading
        title="Alert budget"
        sub={
          feed
            ? `${fmtNum(feed.cellsScanned)} organism×antibiotic cells scanned this window`
            : undefined
        }
        right={refreshing ? <Busy label="Updating…" /> : null}
      />
      {error && !feed ? (
        <LoadError message={error} onRetry={onRetry} />
      ) : loading && !feed ? (
        <div className="mt-4">
          <SkeletonCard hint="Loading the alert-budget baseline…" />
        </div>
      ) : feed ? (
        <>
          <div className="mt-4 flex flex-wrap items-end gap-x-10 gap-y-4">
            <div>
              <p className="text-4xl font-bold leading-none tabular-nums">{feed.warnings.length}</p>
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                warning{feed.warnings.length === 1 ? "" : "s"} this window
              </p>
            </div>
            <div className="min-w-[240px] flex-1 sm:max-w-sm">
              <div className="flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground">
                <span>measured false-alarm rate vs budget</span>
                <span className="font-medium tabular-nums">
                  {fmtNum(feed.expectedPerMonth)} / {fmtNum(MONTHLY_BUDGET)} per month
                </span>
              </div>
              <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${fillPct}%`,
                    backgroundColor:
                      expected !== null && expected > MONTHLY_BUDGET ? C.danger : C.primary,
                  }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Expected baseline ≤2/month hospital-wide (measured:{" "}
                {fmtNum(feed.expectedPerMonth)}/month).
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <ConfigChips config={feed.config} />
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">{feed.budget}</p>
          <p className="mt-2 text-[12px] font-medium text-foreground">
            The detector stack is tuned so that what appears here is unusual — if it fires, it
            deserves attention.
          </p>
        </>
      ) : null}
    </Card>
  );
}

export default function EarlyWarningPage() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [ward, setWard] = useState(ALL_WARDS);
  /** "YYYY-MM-DD" for historical replay; "" = live feed. */
  const [asOf, setAsOf] = useState("");
  const [attempt, setAttempt] = useState(0);

  const [feed, setFeed] = useState<WarningFeedResponse | null>(null);
  const [mdro, setMdro] = useState<MdroResponse | null>(null);
  const [pathways, setPathways] = useState<PathwaysResponse | null>(null);
  const [errors, setErrors] = useState<EndpointErrors>({});
  const [loading, setLoading] = useState(true);
  /** A successful load has landed at least once: further loads are soft
   *  refreshes that keep the previous content on screen. */
  const [everLoaded, setEverLoaded] = useState(false);
  const refreshing = loading && everLoaded;

  const replayId = useId();
  const retry = () => setAttempt((a) => a + 1);

  // Meta is filter-independent: fetch once, retry via the banner.
  useEffect(() => {
    const controller = new AbortController();
    setMetaError(null);
    loadJson<MetaResponse>("/api/meta", controller.signal)
      .then(setMeta)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setMetaError(toMessage(err));
      });
    return () => controller.abort();
  }, [attempt]);

  // All three feeds in parallel on every ward/asOf change. The ward filter
  // applies to the warning feed and MDRO section; /api/pathways is
  // hospital-wide by contract and takes only asOf. Soft refresh: previous
  // results stay visible while the next set computes.
  useEffect(() => {
    const controller = new AbortController();
    setErrors({});
    setLoading(true);

    const params = new URLSearchParams();
    if (ward !== ALL_WARDS) params.set("ward", ward);
    if (asOf) params.set("asOf", asOf);
    const qs = params.toString();

    void (async () => {
      const [w, m, p] = await Promise.allSettled([
        loadJson<WarningFeedResponse>(`/api/warning?${qs}`, controller.signal),
        loadJson<MdroResponse>(`/api/mdro?${qs}`, controller.signal),
        loadJson<PathwaysResponse>(`/api/pathways?${qs}`, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      const nextErrors: EndpointErrors = {};
      if (w.status === "fulfilled") setFeed(w.value);
      else nextErrors.warning = toMessage(w.reason);
      if (m.status === "fulfilled") setMdro(m.value);
      else nextErrors.mdro = toMessage(m.reason);
      if (p.status === "fulfilled") setPathways(p.value);
      else nextErrors.pathways = toMessage(p.reason);
      setErrors(nextErrors);
      if (w.status === "fulfilled" || m.status === "fulfilled" || p.status === "fulfilled") {
        setEverLoaded(true);
      }
      setLoading(false);
    })();

    return () => controller.abort();
  }, [ward, asOf, attempt]);

  const wardOptions: SelectOption[] = useMemo(() => {
    const wards = meta?.wards ?? [];
    const list = wards.includes(ALL_WARDS) ? wards : [ALL_WARDS, ...wards];
    return (list.length > 0 ? list : [ALL_WARDS]).map((w) => ({ value: w, label: w }));
  }, [meta]);

  const dateMin = meta && meta.dateMin ? meta.dateMin.slice(0, 10) : undefined;
  const dateMax = meta && meta.dateMax ? meta.dateMax.slice(0, 10) : undefined;

  const allFailed =
    errors.warning !== undefined && errors.mdro !== undefined && errors.pathways !== undefined;
  const bannerError =
    metaError && !meta ? metaError : allFailed ? (errors.warning ?? errors.mdro ?? errors.pathways) : null;

  return (
    <div>
      <header>
        <h1 className="text-xl font-bold tracking-tight">Early Warning</h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
          Outbreak-grade detection on top of routine surveillance: proportion-drop tests with FDR
          control, weekly-count CUSUM, 14-day cluster scan and MDRO-phenotype CUSUM. Every warning
          is a statistical hypothesis for investigation — never a confirmed outbreak.
        </p>
      </header>

      {bannerError ? (
        <Card className="mt-5">
          <p className="text-sm font-medium text-danger">Couldn&apos;t load early-warning data</p>
          <p className="mt-1 text-sm text-muted-foreground">{bannerError}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-4 h-9 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Retry
          </button>
        </Card>
      ) : null}

      <Card className="mt-5">
        <div className="flex flex-wrap items-end gap-4">
          <Select label="Ward" value={ward} options={wardOptions} onChange={setWard} className="w-44" />
          <div>
            <label
              htmlFor={replayId}
              className="mb-1 block text-[12px] font-medium text-muted-foreground"
            >
              Historical replay
            </label>
            <div className="flex items-center gap-2">
              <input
                id={replayId}
                type="date"
                value={asOf}
                min={dateMin}
                max={dateMax}
                onChange={(event) => setAsOf(event.target.value)}
                title="Recompute every window as if today were this date; leave empty for live data"
                className="h-9 rounded-lg border border-border bg-card px-3 text-[13px] font-medium tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              />
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
            {feed ? (
              <span className="text-[13px] tabular-nums text-muted-foreground">
                Window: {fmtWindow(feed.windowStart, feed.windowEnd)}
              </span>
            ) : null}
            {refreshing ? <Busy label="Updating…" /> : null}
          </div>
        </div>
      </Card>

      {asOf ? (
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-warning/30 bg-warning/10 px-4 py-2.5">
          <Badge tone="warning">Historical replay</Badge>
          <p className="text-[13px] text-warning">
            Historical replay — every window is recomputed as if today were {asOf}.
          </p>
        </div>
      ) : null}

      <BudgetMeter
        className="mt-5"
        feed={feed}
        loading={loading}
        refreshing={refreshing}
        error={errors.warning ?? null}
        onRetry={retry}
      />

      <WarningFeedCard
        className="mt-5"
        feed={feed}
        loading={loading}
        refreshing={refreshing}
        error={errors.warning ?? null}
        onRetry={retry}
      />

      <TransmissionMap
        pathways={pathways}
        mdro={mdro}
        asOf={asOf}
        selectedWard={ward}
        onSelectWard={setWard}
      />

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        <MdroWeeklyCard
          mdro={mdro}
          loading={loading}
          refreshing={refreshing}
          error={errors.mdro ?? null}
          onRetry={retry}
        />
        <MdroWardCard
          mdro={mdro}
          loading={loading}
          refreshing={refreshing}
          error={errors.mdro ?? null}
          onRetry={retry}
        />
      </div>

      <RecentIsolatesCard
        className="mt-5"
        mdro={mdro}
        loading={loading}
        refreshing={refreshing}
        error={errors.mdro ?? null}
        onRetry={retry}
      />

      <PathwaysCard
        className="mt-5"
        pathways={pathways}
        loading={loading}
        refreshing={refreshing}
        error={errors.pathways ?? null}
        onRetry={retry}
      />

      <BacktestCard className="mt-5" />
    </div>
  );
}
