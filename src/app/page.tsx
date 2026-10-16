"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MIN_ISOLATES } from "@/lib/types";
import type { AntibiogramResponse, MetaResponse, SusCell, WindowKey } from "@/lib/types";
import { Badge, Card, Select, type SelectOption } from "@/components/ui";
import { AntibiogramMatrix, BestPickStrip, type CellFocus } from "@/components/antibiogram";

const SAMPLE_ALL = "all";
const DEFAULT_WARD = "ICU";
const WARD_STORAGE_KEY = "aei-ward";

/** Static label table for the window toggle. */
const WINDOW_OPTIONS: Record<WindowKey, string> = {
  "4w": "Last 4 weeks",
  "1y": "This year",
};

const fmtDateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const fmtDayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const fmtFullDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function parseIso(value: string): Date {
  // Date-only ISO strings are calendar dates; parse them in local time to avoid timezone drift.
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
}

function formatRange(startIso: string, endIso: string): string {
  const start = parseIso(startIso);
  const end = parseIso(endIso);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return "—";
  if (start.getFullYear() === end.getFullYear()) {
    return `${fmtDayMonth.format(start)} – ${fmtDayMonth.format(end)} ${end.getFullYear()}`;
  }
  return `${fmtFullDate.format(start)} – ${fmtFullDate.format(end)}`;
}

function readStoredWard(): string {
  if (typeof window === "undefined") return DEFAULT_WARD;
  try {
    const stored = window.localStorage.getItem(WARD_STORAGE_KEY);
    return stored && stored.length > 0 ? stored : DEFAULT_WARD;
  } catch {
    return DEFAULT_WARD;
  }
}

function writeStoredWard(value: string): void {
  try {
    window.localStorage.setItem(WARD_STORAGE_KEY, value);
  } catch {
    // Storage can be unavailable (private mode, quota); persistence is best-effort.
  }
}

function SummaryStat({
  label,
  value,
  note,
  valueClass = "text-xl font-semibold text-foreground",
}: {
  label: string;
  value: string;
  note?: string;
  valueClass?: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono tabular-nums ${valueClass}`}>{value}</div>
      {note ? <div className="mt-0.5 text-[11px] text-muted-foreground">{note}</div> : null}
    </div>
  );
}

function FocusStat({
  label,
  value,
  valueClass = "text-foreground",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono text-[13px] font-semibold tabular-nums ${valueClass}`}>
        {value}
      </div>
    </div>
  );
}

function AnnualStat({ cell, annual }: { cell: SusCell; annual: SusCell | null }) {
  const label = (
    <div className="text-[11px] font-medium text-muted-foreground">vs annual</div>
  );
  if (!cell.sufficient || !annual || !annual.sufficient) {
    return (
      <div>
        {label}
        <div className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums text-muted-foreground">
          —
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {!annual || !annual.sufficient
            ? "no annual data"
            : `window n < ${MIN_ISOLATES}`}
        </div>
      </div>
    );
  }
  const diff = cell.sPct - annual.sPct;
  const tone = diff > 0 ? "text-success" : diff < 0 ? "text-danger" : "text-muted-foreground";
  return (
    <div>
      {label}
      <div className={`mt-0.5 font-mono text-[13px] font-semibold tabular-nums ${tone}`}>
        {diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)} pp
      </div>
      <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
        {`1y ${annual.sPct.toFixed(1)}% · n=${annual.n.toLocaleString("en-US")}`}
      </div>
    </div>
  );
}

function FocusFooter({
  focus,
  showAnnual,
  onClear,
}: {
  focus: CellFocus;
  showAnnual: boolean;
  onClear: () => void;
}) {
  const cell = focus.cell;
  return (
    <div className="mt-5 rounded-lg bg-muted/50 p-4">
      <div className="flex flex-wrap items-start gap-x-10 gap-y-3">
        <div className="min-w-[190px]">
          <div className="text-[11px] font-medium text-muted-foreground">Focused cell</div>
          <div className="mt-0.5 text-[13px] font-semibold leading-snug">
            {focus.organism} · {focus.antibiotic}
          </div>
        </div>
        <FocusStat
          label="Susceptible"
          value={cell.sufficient ? `${cell.sPct.toFixed(1)}%` : `n < ${MIN_ISOLATES}`}
          valueClass={cell.sufficient ? "text-foreground" : "text-muted-foreground"}
        />
        <FocusStat label="First isolates" value={`n=${cell.n.toLocaleString("en-US")}`} />
        {cell.sufficient ? (
          <FocusStat
            label="95% CI (Wilson)"
            value={`${cell.ciLo.toFixed(1)}–${cell.ciHi.toFixed(1)}%`}
          />
        ) : null}
        {showAnnual ? <AnnualStat cell={cell} annual={focus.annual} /> : null}
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear focused cell"
          className="ml-auto h-8 w-8 shrink-0 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ✕
        </button>
      </div>
      {!cell.sufficient ? (
        <div className="mt-3">
          <Badge tone="warning">{`n < ${MIN_ISOLATES} — percentage not reported; interpret with caution`}</Badge>
        </div>
      ) : null}
    </div>
  );
}

export default function Page() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [metaError, setMetaError] = useState(false);
  const [ward, setWard] = useState(readStoredWard);
  const [sample, setSample] = useState(SAMPLE_ALL);
  const [windowKey, setWindowKey] = useState<WindowKey>("4w");
  const [data, setData] = useState<AntibiogramResponse | null>(null);
  const [annual, setAnnual] = useState<AntibiogramResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<CellFocus | null>(null);
  const [retryToken, setRetryToken] = useState<{ n: number }>({ n: 0 });
  const metaLoadedRef = useRef(false);

  // Validate the stored/selected ward once meta lands: keep it if listed,
  // otherwise fall back to ICU (or the first listed ward) and persist that.
  useEffect(() => {
    if (!meta || meta.wards.length === 0 || meta.wards.includes(ward)) return;
    const fallback = meta.wards.includes(DEFAULT_WARD) ? DEFAULT_WARD : meta.wards[0];
    setWard(fallback);
    writeStoredWard(fallback);
  }, [meta, ward]);

  // Data loading. On mount /api/meta, the current-window antibiogram and the 1y
  // comparison start in parallel (no meta-first waterfall); filter changes rerun
  // this effect for the antibiogram calls only, with /api/meta cached in state.
  // In 4w mode the 1y window feeds the per-cell annual comparison; its failure
  // only hides that comparison.
  useEffect(() => {
    let cancelled = false;

    // retryToken changes identity only on explicit retry, re-running this effect.
    void retryToken;

    // Fired synchronously alongside the data fetches below, so the first render
    // dispatches every request at once. Skipped once meta has loaded; a failed
    // meta request is re-attempted on the next run (retry or filter change).
    const metaRequest = metaLoadedRef.current
      ? null
      : fetch("/api/meta")
          .then(async (res) => {
            if (!res.ok) throw new Error(`meta ${res.status}`);
            return (await res.json()) as MetaResponse;
          })
          .then((m) => {
            metaLoadedRef.current = true;
            if (!cancelled) {
              setMeta(m);
              setMetaError(false);
            }
          })
          .catch(() => {
            if (!cancelled) setMetaError(true);
          });
    void metaRequest;

    const url = (w: WindowKey) => {
      const params = new URLSearchParams({ ward, window: w });
      if (sample !== SAMPLE_ALL) params.set("sample", sample);
      return `/api/antibiogram?${params.toString()}`;
    };

    async function loadJson(res: Response): Promise<AntibiogramResponse> {
      if (!res.ok) throw new Error(`antibiogram ${res.status}`);
      return (await res.json()) as AntibiogramResponse;
    }

    setLoading(true);
    setError(null);
    setFocus(null);

    const current = fetch(url(windowKey)).then(loadJson);
    const comparison =
      windowKey === "4w"
        ? fetch(url("1y"))
            .then(loadJson)
            .catch(() => null)
        : Promise.resolve(null);

    Promise.all([current, comparison])
      .then(([cur, cmp]) => {
        if (cancelled) return;
        setData(cur);
        setAnnual(cmp);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("The antibiogram service did not respond. The laboratory API may be unavailable.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ward, sample, windowKey, retryToken]);

  const wardOptions = useMemo<SelectOption[]>(() => {
    if (meta && meta.wards.length > 0) {
      return meta.wards.map((w) => ({ value: w, label: w }));
    }
    return [{ value: ward, label: ward }];
  }, [meta, ward]);

  const sampleOptions = useMemo<SelectOption[]>(() => {
    const types = meta?.sampleTypes ?? [];
    return [
      { value: SAMPLE_ALL, label: "All specimens" },
      ...types.map((t) => ({
        value: t,
        label: t.length === 0 ? t : t.charAt(0).toUpperCase() + t.slice(1),
      })),
    ];
  }, [meta]);

  const summary = useMemo(() => {
    if (!data) return null;
    const totalIsolates = data.rows.reduce((acc, row) => acc + row.n, 0);
    let flagged = 0;
    for (const row of data.rows) {
      for (const cell of row.cells) {
        if (cell.sufficient && Math.round(cell.sPct) < 60) flagged += 1;
      }
    }
    return { totalIsolates, flagged };
  }, [data]);

  const showAnnual = windowKey === "4w" && annual !== null;

  const contextLine =
    !error && data && summary
      ? `${ward} · ${WINDOW_OPTIONS[windowKey]} · ${formatRange(data.windowStart, data.windowEnd)} · ${summary.totalIsolates.toLocaleString("en-US")} first isolates · Updated ${fmtDateTime.format(parseIso(data.generatedAt))}`
      : `${ward} · ${WINDOW_OPTIONS[windowKey]}`;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Ward susceptibility</h1>
          <p className="mt-1 font-mono text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {contextLine}
          </p>
        </div>
        <Select
          label="Ward"
          value={ward}
          options={wardOptions}
          onChange={(nextWard) => {
            setWard(nextWard);
            writeStoredWard(nextWard);
          }}
          className="min-w-[190px]"
        />
      </header>

      <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3">
        <Select
          label="Specimen type"
          value={sample}
          options={sampleOptions}
          onChange={setSample}
          className="min-w-[170px]"
        />
        <div>
          <div className="mb-1 text-[12px] font-medium text-muted-foreground">Window</div>
          <div
            className="flex h-9 items-center gap-0.5 rounded-lg bg-muted p-0.5"
            role="group"
            aria-label="Time window"
          >
            {(Object.entries(WINDOW_OPTIONS) as [WindowKey, string][]).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={windowKey === value}
                onClick={() => setWindowKey(value)}
                className={`h-8 rounded-lg border px-3 text-[13px] font-medium ${
                  windowKey === value
                    ? "border-border bg-card text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {metaError ? <Badge tone="neutral">Ward list unavailable</Badge> : null}
      </div>

      <Card padding="p-6">
        {loading ? (
          <div aria-hidden>
            <div className="h-3 w-28 animate-pulse rounded bg-muted" />
            <div className="mt-5 space-y-2">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="h-11 w-full animate-pulse rounded bg-muted" />
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-start gap-3 py-10">
            <Badge tone="neutral">Request failed</Badge>
            <p className="max-w-lg text-[13px] leading-relaxed text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={() => setRetryToken({ n: retryToken.n + 1 })}
              className="h-9 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              Try again
            </button>
          </div>
        ) : data && summary ? (
          <>
            {summary.totalIsolates > 0 ? (
              <SummaryStat
                label="Flagged cells"
                value={String(summary.flagged)}
                valueClass={
                  summary.flagged > 0
                    ? "text-xl font-semibold text-danger"
                    : "text-xl font-semibold text-foreground"
                }
                note={`S < 60%, n ≥ ${MIN_ISOLATES}`}
              />
            ) : null}

            <div className="mt-5">
              {summary.totalIsolates === 0 ? (
                <div className="flex flex-col items-center gap-1.5 py-14 text-center">
                  <p className="text-sm font-semibold">No isolates in this period</p>
                  <p className="max-w-md text-[13px] leading-relaxed text-muted-foreground">
                    No first isolates matched the selected ward, specimen type and window. Try
                    “All specimens”, a different ward, or switch the window to “This year”.
                  </p>
                </div>
              ) : (
                <>
                  <BestPickStrip data={data} />
                  <AntibiogramMatrix
                    data={data}
                    annual={annual}
                    showAnnual={showAnnual}
                    focus={focus}
                    onSelect={setFocus}
                  />
                </>
              )}
            </div>

            {focus ? (
              <FocusFooter focus={focus} showAnnual={showAnnual} onClear={() => setFocus(null)} />
            ) : null}
          </>
        ) : null}
      </Card>
    </div>
  );
}
