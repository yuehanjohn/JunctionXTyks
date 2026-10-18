"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Select } from "@/components/ui";

// The sitrep contract is stable and local to this screen; kept inline rather
// than added to the shared types file (shared files are off-limits here).
interface SitrepResponse {
  ward: string;
  asOf: string | null;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  markdown: string;
}

interface MetaResponse {
  wards: string[];
  dateMin: string;
  dateMax: string;
}

async function loadJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

const DAY_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** ISO instant → "24 Mar 2026"; falls back to the raw string when unparseable. */
function fmtDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DAY_FMT.format(d);
}

// ── Minimal markdown renderer ─────────────────────────────────────────
// Supports exactly what getSitrep emits: `#`/`##` headings, `-` bullets and
// `**bold**` inline runs. Parsed to tokens, mapped to React elements — no
// dangerouslySetInnerHTML.

type Block =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "para"; text: string };

/** Split text on **bold** runs: plain and bold segments alternate. */
function inlineBold(text: string, keyPrefix: string) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-foreground">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  for (const rawLine of md.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.startsWith("## ")) {
      blocks.push({ kind: "h2", text: line.slice(3) });
    } else if (line.startsWith("# ")) {
      blocks.push({ kind: "h1", text: line.slice(2) });
    } else if (line.startsWith("- ")) {
      blocks.push({ kind: "bullet", text: line.slice(2) });
    } else if (line.trim() !== "") {
      blocks.push({ kind: "para", text: line });
    }
    // Blank lines separate blocks; nothing to render for them.
  }
  return blocks;
}

function MarkdownReport({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown]);
  return (
    <div className="font-mono text-[13px] leading-relaxed text-foreground">
      {blocks.map((block, i) => {
        const key = `blk-${i}`;
        switch (block.kind) {
          case "h1":
            return (
              <h2 key={key} className="mt-5 text-[15px] font-semibold tracking-tight first:mt-0">
                {block.text}
              </h2>
            );
          case "h2":
            return (
              <h3
                key={key}
                className="mt-5 border-b border-border pb-1.5 text-[13px] font-semibold uppercase tracking-wide text-primary first:mt-0"
              >
                {block.text}
              </h3>
            );
          case "bullet":
            return (
              <div key={key} className="flex gap-2 py-0.5 pl-1">
                <span aria-hidden className="shrink-0 text-muted-foreground">
                  •
                </span>
                <p className="min-w-0">{inlineBold(block.text, key)}</p>
              </div>
            );
          case "para":
            return (
              <p key={key} className="py-0.5 pl-1 text-muted-foreground">
                {inlineBold(block.text, key)}
              </p>
            );
        }
      })}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────

const INPUT_CLASS =
  "h-9 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";

export default function SitrepPage() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [data, setData] = useState<SitrepResponse | null>(null);
  const [ward, setWard] = useState(""); // "" = all wards (ward param omitted)
  const [asOf, setAsOf] = useState("");
  const [loading, setLoading] = useState(true); // true until the first report lands
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);

  // Meta and the first sitrep are fetched in parallel (separate effects fire
  // in the same commit); sitrep refetches softly on filter changes.
  useEffect(() => {
    const controller = new AbortController();
    loadJson<MetaResponse>("/api/meta", controller.signal)
      .then(setMeta)
      .catch((err: unknown) => {
        // Meta only feeds the ward list and date bounds — not fatal.
        if (!controller.signal.aborted) console.error("meta load failed", err);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setLoading(true);
    const params = new URLSearchParams();
    if (ward !== "") params.set("ward", ward);
    if (asOf !== "") params.set("asOf", asOf);
    const qs = params.toString();
    loadJson<SitrepResponse>(`/api/sitrep${qs ? `?${qs}` : ""}`, controller.signal)
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
  }, [ward, asOf, attempt]);

  const markdown = data?.markdown ?? "";

  const handleCopy = () => {
    if (!markdown) return;
    navigator.clipboard
      .writeText(markdown)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setError("Could not access the clipboard."));
  };

  const handleDownload = () => {
    if (!markdown || !data) return;
    // Ward name → filename-safe slug: "All wards" → "all-wards", "ICU-West" → "icu-west".
    const slug =
      data.ward.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "all";
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aei-pulse-sitrep-${slug}-${data.windowEnd.slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const wardOptions = useMemo(
    () => [{ value: "", label: "All wards" }, ...(meta?.wards ?? []).map((w) => ({ value: w, label: w }))],
    [meta],
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sitrep</h1>
        <p className="mt-1 max-w-3xl text-[13px] text-muted-foreground">
          Automated weekly resistance situation report — generated from live surveillance data.
          Population-level only: not a treatment guideline and not an outbreak declaration.
        </p>
      </div>

      {/* Control row */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <Select
          label="Ward"
          value={ward}
          options={wardOptions}
          onChange={setWard}
          className="min-w-44"
        />
        <div>
          <label
            htmlFor="sitrep-replay"
            className="mb-1 block text-[12px] font-medium text-muted-foreground"
          >
            Historical replay
          </label>
          <input
            id="sitrep-replay"
            type="date"
            min={meta?.dateMin}
            max={meta?.dateMax}
            value={asOf}
            title="Generate the report as if today were this date. Leave empty for live data."
            onChange={(e) => setAsOf(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <div className="ml-auto flex items-center gap-2 pb-0.5">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!markdown}
            className="h-9 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copied ? "Copied ✓" : "Copy markdown"}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!markdown}
            className="h-9 rounded-lg bg-primary px-3 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download .md
          </button>
        </div>
      </div>

      {/* Historical replay notice */}
      {asOf && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-[13px] text-warning">
          Historical replay — the report is generated as if today were {asOf}.
        </div>
      )}

      {/* Error banner + retry */}
      {error && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-danger/40 bg-danger/10 px-4 py-2 text-[13px] text-danger">
          <span>Could not load the report: {error}</span>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="shrink-0 rounded-lg border border-danger/40 px-3 py-1 text-[12px] font-medium text-danger transition-colors hover:bg-danger/10"
          >
            Retry
          </button>
        </div>
      )}

      {/* Report card */}
      <Card>
        {loading && !data ? (
          /* Skeleton on first load */
          <div className="animate-pulse space-y-3" aria-label="Loading report">
            <div className="h-4 w-2/3 rounded bg-muted" />
            <div className="h-3 w-1/2 rounded bg-muted" />
            <div className="h-3.5 w-32 rounded bg-muted" />
            <div className="space-y-2 pt-1">
              <div className="h-3 w-full rounded bg-muted" />
              <div className="h-3 w-11/12 rounded bg-muted" />
              <div className="h-3 w-4/5 rounded bg-muted" />
              <div className="h-3 w-2/3 rounded bg-muted" />
            </div>
            <div className="h-3.5 w-40 rounded bg-muted" />
            <div className="space-y-2 pt-1">
              <div className="h-3 w-10/12 rounded bg-muted" />
              <div className="h-3 w-full rounded bg-muted" />
              <div className="h-3 w-3/4 rounded bg-muted" />
            </div>
          </div>
        ) : markdown ? (
          <div className={loading ? "opacity-50 transition-opacity" : "transition-opacity"}>
            <div className="mb-3 flex items-baseline justify-between gap-4 text-[11px] text-muted-foreground">
              <span>
                {data?.ward} · window {data ? fmtDay(data.windowStart) : "—"} –{" "}
                {data ? fmtDay(data.windowEnd) : "—"}
              </span>
              <span>{data ? `generated ${fmtDay(data.generatedAt)}` : ""}</span>
            </div>
            <MarkdownReport markdown={markdown} />
          </div>
        ) : (
          /* Empty / markdown-missing state */
          <div className="py-10 text-center">
            <p className="text-[13px] font-medium text-foreground">No report available</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              The sitrep service returned no markdown for this selection. Try another ward or clear
              the replay date.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
