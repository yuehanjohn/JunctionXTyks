"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Select } from "@/components/ui";
import type { ExploreResponse, MetaResponse } from "@/lib/types";
import { AGE_BANDS, EXPLORE_PAGE_SIZE, FILTER_ALL } from "@/lib/types";

const SEX_LABELS: Record<string, string> = { F: "Female", M: "Male" };

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

/** CSV escaping: quote fields containing commas, quotes or newlines (RFC 4180). */
function csvField(value: string): string {
  if (!/["\n,]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

interface Filters {
  ward: string;
  sample: string;
  organism: string;
  antibiotic: string;
  result: string;
  sex: string;
  age: string;
  from: string;
  to: string;
  pageSize: string;
}

const INITIAL_FILTERS: Filters = {
  ward: "All wards",
  sample: "",
  organism: FILTER_ALL,
  antibiotic: FILTER_ALL,
  result: FILTER_ALL,
  sex: FILTER_ALL,
  age: FILTER_ALL,
  from: "",
  to: "",
  pageSize: String(EXPLORE_PAGE_SIZE),
};

export default function ExplorePage() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ExploreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  /** Every filter change starts a new result set at page 1. */
  const updateFilters = (patch: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

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

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.ward !== "All wards") params.set("ward", filters.ward);
    if (filters.sample !== "") params.set("sample", filters.sample);
    if (filters.organism !== FILTER_ALL) params.set("organism", filters.organism);
    if (filters.antibiotic !== FILTER_ALL) params.set("antibiotic", filters.antibiotic);
    if (filters.result !== FILTER_ALL) params.set("result", filters.result);
    if (filters.sex !== FILTER_ALL) params.set("sex", filters.sex);
    if (filters.age !== FILTER_ALL) params.set("age", filters.age);
    if (filters.from !== "") params.set("from", filters.from);
    if (filters.to !== "") params.set("to", filters.to);
    params.set("page", String(page));
    params.set("pageSize", filters.pageSize);
    // Soft refresh: the previous rows stay visible until the new page lands.
    loadJson<ExploreResponse>(`/api/explore?${params.toString()}`, controller.signal)
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
  }, [filters, page, attempt]);

  // A shrinking filter set can strand the cursor past the last page.
  useEffect(() => {
    if (data && data.rows.length === 0 && data.page > 1) setPage(1);
  }, [data]);

  /** Builds a CSV of the currently displayed page and downloads it. */
  const exportCsv = () => {
    if (!data || data.rows.length === 0) return;
    const header = [
      "Date",
      "Ward",
      "Specimen",
      "Organism",
      "Sex",
      "Age band",
      "Resistant",
      "Susceptible (count)",
    ];
    const lines = [
      "# AEI Pulse — Data Explorer export (current page)",
      `# Generated ${new Date().toISOString()} · first isolate per patient per organism · all data synthetic — population-level surveillance only, not a treatment guideline`,
      header.join(","),
      ...data.rows.map((row) =>
        [
          row.date.slice(0, 10),
          row.ward,
          row.sampleType,
          row.organism,
          row.patientSex,
          row.patientAgeBand,
          row.resistant.join("; "),
          String(row.susceptible.length),
        ]
          .map(csvField)
          .join(","),
      ),
    ];
    const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "aei-pulse-isolates.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const organismOptions = useMemo(
    () => [
      { value: FILTER_ALL, label: "All organisms" },
      ...(meta?.organisms ?? []).map((o) => ({ value: o, label: o })),
    ],
    [meta],
  );

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

  const antibioticOptions = useMemo(
    () => [
      { value: FILTER_ALL, label: "All antibiotics" },
      ...(meta?.antibiotics ?? []).map((a) => ({ value: a, label: a })),
    ],
    [meta],
  );

  const resultOptions = useMemo(
    () => [
      { value: FILTER_ALL, label: "All results" },
      { value: "R", label: "Resistant (R)" },
      { value: "S", label: "Susceptible (S)" },
    ],
    [],
  );

  const sexOptions = useMemo(
    () => [
      { value: FILTER_ALL, label: "All sexes" },
      ...(meta?.sexes ?? []).map((s) => ({ value: s, label: SEX_LABELS[s] ?? s })),
    ],
    [meta],
  );

  const ageOptions = useMemo(
    () => [
      { value: FILTER_ALL, label: "All ages" },
      ...AGE_BANDS.map((b) => ({ value: b.id, label: b.label })),
    ],
    [],
  );

  const pageSizeOptions = useMemo(
    () => ["25", "50", "100", "200"].map((size) => ({ value: size, label: `${size} rows` })),
    [],
  );

  const dateMin = meta?.dateMin.slice(0, 10);
  const dateMax = meta?.dateMax.slice(0, 10);

  const rangeStart = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const rangeEnd = data ? Math.min(data.page * data.pageSize, data.total) : 0;
  const atLastPage = data !== null && data.page * data.pageSize >= data.total;
  const resultNeedsAntibioticNote =
    filters.result !== FILTER_ALL && filters.antibiotic === FILTER_ALL;

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Data Explorer</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Row-level isolate listing. Patient identifiers are never shown; sex and age band are
            dataset-level context.
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!data || data.rows.length === 0}
          className="h-9 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          Export CSV
        </button>
      </header>

      <Card className="mt-5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
          <Select
            label="Ward"
            value={filters.ward}
            options={wardOptions}
            onChange={(v) => updateFilters({ ward: v })}
          />
          <Select
            label="Specimen type"
            value={filters.sample}
            options={specimenOptions}
            onChange={(v) => updateFilters({ sample: v })}
          />
          <Select
            label="Organism"
            value={filters.organism}
            options={organismOptions}
            onChange={(v) => updateFilters({ organism: v })}
          />
          <Select
            label="Antibiotic"
            value={filters.antibiotic}
            options={antibioticOptions}
            onChange={(v) => updateFilters({ antibiotic: v })}
          />
          <Select
            label="Result"
            value={filters.result}
            options={resultOptions}
            onChange={(v) => updateFilters({ result: v })}
          />
          <Select
            label="Patient sex"
            value={filters.sex}
            options={sexOptions}
            onChange={(v) => updateFilters({ sex: v })}
          />
          <Select
            label="Age band"
            value={filters.age}
            options={ageOptions}
            onChange={(v) => updateFilters({ age: v })}
          />
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
              From date
            </span>
            <input
              type="date"
              value={filters.from}
              min={dateMin}
              max={dateMax}
              onChange={(event) => updateFilters({ from: event.target.value })}
              className="h-9 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
              To date
            </span>
            <input
              type="date"
              value={filters.to}
              min={dateMin}
              max={dateMax}
              onChange={(event) => updateFilters({ to: event.target.value })}
              className="h-9 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </label>
          <Select
            label="Page size"
            value={filters.pageSize}
            options={pageSizeOptions}
            onChange={(v) => updateFilters({ pageSize: v })}
          />
        </div>
        <p className="mt-3 text-[12px] text-muted-foreground">
          Filters query the API; percentages are never recomputed in the browser.
          {resultNeedsAntibioticNote &&
            " Result filtering applies to the isolate's whole panel unless an antibiotic is selected."}
        </p>
      </Card>

      {error ? (
        <Card className="mt-4">
          <p className="text-sm font-medium text-danger">Couldn&apos;t load isolates</p>
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
        <div aria-hidden className="mt-4 animate-pulse">
          <Card>
            <div className="h-4 w-56 rounded bg-muted" />
            <div className="mt-4 h-64 rounded-lg bg-muted" />
          </Card>
        </div>
      ) : data ? (
        <Card className="mt-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Date
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Ward
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Specimen
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Organism
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Sex
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Age band
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Resistant
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Susceptible (n)
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.isolateId} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                    <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums">
                      {fmtDay(row.date)}
                    </td>
                    <td className="px-3 py-2">{row.ward}</td>
                    <td className="px-3 py-2">{row.sampleType}</td>
                    <td className="px-3 py-2 font-medium">{row.organism}</td>
                    <td className="px-3 py-2">{SEX_LABELS[row.patientSex] ?? row.patientSex}</td>
                    <td className="px-3 py-2">{row.patientAgeBand}</td>
                    <td className="max-w-[280px] px-3 py-2">
                      {row.resistant.length > 0 ? (
                        <span className="text-danger">
                          R: {row.resistant.join(", ")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td
                      className="px-3 py-2 text-right font-mono tabular-nums"
                      title={row.susceptible.length > 0 ? row.susceptible.join(", ") : undefined}
                    >
                      {row.susceptible.length > 0 ? row.susceptible.length : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No isolates match these filters.
            </p>
          ) : (
            <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
              <p className="font-mono text-[12px] tabular-nums text-muted-foreground">
                {rangeStart.toLocaleString("en-US")}–{rangeEnd.toLocaleString("en-US")} of{" "}
                {data.total.toLocaleString("en-US")}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={data.page <= 1 || loading}
                  className="h-8 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                >
                  ← Prev
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={atLastPage || loading}
                  className="h-8 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </Card>
      ) : null}

      <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
        First isolate per patient per organism · resistant/susceptible lists are the isolate&apos;s
        panel results · export covers the currently displayed page only. All data synthetic —
        population-level surveillance only, not a treatment guideline.
      </p>
    </div>
  );
}
