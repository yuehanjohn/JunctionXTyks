"use client";

import { useEffect, useMemo, useState } from "react";
import type { MetaResponse, Signal, SignalsResponse } from "@/lib/types";

// ── Local helpers (page-scoped on purpose) ───────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status} ${res.statusText})`);
  return (await res.json()) as T;
}

/** One decimal max, trailing ".0" stripped. Used across ≥3 call sites for lockstep rounding. */
function fmt(v: number): string {
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function fmtRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "—";
  return start.getFullYear() === end.getFullYear()
    ? `${DAY_MONTH.format(start)} – ${DAY_MONTH_YEAR.format(end)}`
    : `${DAY_MONTH_YEAR.format(start)} – ${DAY_MONTH_YEAR.format(end)}`;
}

// ── Severity presentation ────────────────────────────────────────────

type Severity = Signal["severity"];
type SeverityFilter = "all" | Severity;

const FILTERS: { key: SeverityFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "high", label: "High" },
  { key: "moderate", label: "Moderate" },
  { key: "watch", label: "Watch" },
];

/** Severity lives on a quiet border-only card: 3px left accent + label colour, no tinted fills. */
const SEVERITY_META: Record<Severity, { label: string; accent: string; chip: string }> = {
  high: { label: "High", accent: "border-l-danger", chip: "border-danger/25 text-danger" },
  moderate: {
    label: "Moderate",
    accent: "border-l-warning",
    chip: "border-warning/25 text-warning",
  },
  watch: {
    label: "Watch",
    accent: "border-l-muted-foreground/40",
    chip: "border-border text-muted-foreground",
  },
};

/** Plain-language clinical implication derived purely from the signal fields (no LLM). */
function implication(s: Signal): string {
  const where = s.ward === "All wards" ? "across all monitored wards" : `on ${s.ward}`;
  const drop = `susceptibility fell ${fmt(s.dropPp)} pp to ${fmt(s.windowS)}%`;
  if (s.severity === "high") {
    return `Consider avoiding ${s.antibiotic} for empirical therapy of ${s.organism} ${where} until reviewed — ${drop} in the current 4-week window. Obtain cultures and prefer an alternative agent where the spectrum allows.`;
  }
  if (s.severity === "moderate") {
    return `Use ${s.antibiotic} for ${s.organism} ${where} with caution: ${drop}. Check culture and susceptibility results before relying on it empirically.`;
  }
  return `Keep ${s.antibiotic} for ${s.organism} ${where} under routine review — ${drop}. The deviation is small; re-check in the next reporting cycle before changing therapy.`;
}

// ── Loading skeleton ─────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div aria-hidden className="animate-pulse rounded-[10px] border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <div className="h-5 w-24 rounded-full bg-muted" />
        <div className="h-3 w-36 rounded bg-muted" />
      </div>
      <div className="mt-4 h-4 w-56 rounded bg-muted" />
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="h-9 rounded bg-muted" />
        <div className="h-9 rounded bg-muted" />
        <div className="h-9 rounded bg-muted" />
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export default function SignalsPage() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [data, setData] = useState<SignalsResponse | null>(null);
  const [ward, setWard] = useState("All wards");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setData(null);
    setLoading(true);
    fetchJson<MetaResponse>("/api/meta")
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      });
    fetchJson<SignalsResponse>(`/api/signals?ward=${encodeURIComponent(ward)}`)
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
  }, [ward, attempt]);

  const wardOptions = useMemo(() => {
    const wards = meta?.wards ?? [];
    const list = wards.includes("All wards") ? wards : ["All wards", ...wards];
    return list.length > 0 ? list : ["All wards"];
  }, [meta]);

  const signals = data?.signals ?? [];
  const visible =
    severityFilter === "all" ? signals : signals.filter((s) => s.severity === severityFilter);

  const generatedAt = data ? new Date(data.generatedAt) : null;
  const updatedLabel =
    generatedAt && !Number.isNaN(generatedAt.getTime())
      ? generatedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      : "—";

  const counts: Record<SeverityFilter, number> = {
    all: signals.length,
    high: 0,
    moderate: 0,
    watch: 0,
  };
  for (const s of signals) counts[s.severity] += 1;

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Resistance signals</h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          rolling 28 days · baseline 12 months · two-proportion z-test, flagged at z ≤ −2 and ≥ 5 pp
          drop
          {data ? ` · ${data.scanned} cells scanned · updated ${updatedLabel}` : ""}
        </p>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
        <label className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Ward</span>
          <select
            value={ward}
            onChange={(e) => setWard(e.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
          >
            {wardOptions.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setSeverityFilter(f.key)}
              aria-pressed={severityFilter === f.key}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                severityFilter === f.key
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-foreground/25 hover:text-foreground"
              }`}
            >
              {f.label} <span className="font-mono tabular-nums">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="mt-6 rounded-[10px] border border-border bg-card p-5">
          <p className="text-sm font-medium text-danger">Couldn&apos;t load resistance signals</p>
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
        <div className="mt-6 flex flex-col gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : signals.length === 0 ? (
        <div className="mt-6 rounded-[10px] border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden
              className="mt-0.5 h-5 w-5 shrink-0 text-success"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="text-sm font-medium">No significant deviations detected</p>
              <p className="mt-1 text-sm text-muted-foreground">
                All monitored ward×organism×antibiotic cells are within expected variation. Switch
                ward above to inspect another part of the hospital.
              </p>
              <p className="mt-2 font-mono text-xs tabular-nums text-muted-foreground">
                {data.scanned} cells scanned · updated {updatedLabel}
              </p>
            </div>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <p className="mt-6 rounded-[10px] border border-border bg-card p-5 text-sm text-muted-foreground">
          No {severityFilter} signals in the current view. Try another severity or ward.
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {visible.map((s) => {
            const sev = SEVERITY_META[s.severity];
            return (
              <article
                key={s.id}
                className={`rounded-[10px] border border-border border-l-[3px] bg-card p-5 ${sev.accent}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${sev.chip}`}
                      >
                        {sev.label}
                      </span>
                      {s.sampleType && (
                        <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {s.sampleType}
                        </span>
                      )}
                    </div>
                    <h2 className="mt-2 text-base font-semibold tracking-tight">
                      {s.organism} × {s.antibiotic}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">{s.ward}</p>
                  </div>
                  <p className="font-mono text-xs tabular-nums text-muted-foreground">
                    window {fmtRange(s.windowStart, s.windowEnd)}
                  </p>
                </div>

                <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Susceptibility</dt>
                    <dd className="mt-1 font-mono text-sm tabular-nums">
                      {fmt(s.baselineS)}% → {fmt(s.windowS)}%{" "}
                      <span className="text-danger">(−{fmt(s.dropPp)} pp)</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Sample size</dt>
                    <dd className="mt-1 font-mono text-sm tabular-nums">
                      n={s.nWindow} window · n={s.nBaseline} baseline
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Z-score</dt>
                    <dd className="mt-1 font-mono text-sm tabular-nums">
                      {s.z < 0 ? `−${fmt(Math.abs(s.z))}` : fmt(s.z)}
                    </dd>
                  </div>
                </dl>

                <div className="mt-5 border-t border-border pt-4">
                  <p className="text-xs text-muted-foreground">Clinical implication</p>
                  <p className="mt-1 text-sm leading-relaxed">{implication(s)}</p>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
