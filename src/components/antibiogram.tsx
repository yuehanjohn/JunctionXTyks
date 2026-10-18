"use client";

import { useMemo } from "react";
import { MIN_ISOLATES } from "@/lib/types";
import type { AntibiogramResponse, SusCell } from "@/lib/types";

/** A focused matrix cell plus its annual (1y) counterpart, when available. */
export interface CellFocus {
  organism: string;
  antibiotic: string;
  cell: SusCell;
  annual: SusCell | null;
}

// RGB triplets of the theme's semantic colors, for low-alpha inline tints.
const SUCCESS_RGB = "23, 114, 69"; // --success #177245
const WARNING_RGB = "168, 91, 0"; // --warning #a85b00
const DANGER_RGB = "179, 38, 30"; // --danger #b3261e

function tintFor(cell: SusCell): string {
  if (!cell.sufficient) return "var(--muted)";
  const pct = Math.round(cell.sPct);
  if (pct >= 90) return `rgba(${SUCCESS_RGB}, 0.18)`;
  if (pct >= 80) return `rgba(${SUCCESS_RGB}, 0.1)`;
  if (pct >= 60) return `rgba(${WARNING_RGB}, 0.12)`;
  return `rgba(${DANGER_RGB}, 0.15)`;
}

function valueColorFor(cell: SusCell): string {
  if (!cell.sufficient) return "var(--muted-foreground)";
  const pct = Math.round(cell.sPct);
  if (pct >= 80) return "var(--success)";
  if (pct >= 60) return "var(--warning)";
  return "var(--danger)";
}

const LEGEND: { label: string; bg: string; dashed?: boolean }[] = [
  { label: "≥ 90% susceptible", bg: `rgba(${SUCCESS_RGB}, 0.18)` },
  { label: "80–89%", bg: `rgba(${SUCCESS_RGB}, 0.1)` },
  { label: "60–79%", bg: `rgba(${WARNING_RGB}, 0.12)` },
  { label: "< 60%", bg: `rgba(${DANGER_RGB}, 0.15)` },
  { label: `n < ${MIN_ISOLATES}`, bg: "var(--muted)", dashed: true },
];

function CellButton({
  organism,
  antibiotic,
  cell,
  annual,
  showAnnual,
  selected,
  flash,
  flashNonce,
  onSelect,
}: {
  organism: string;
  antibiotic: string;
  cell: SusCell;
  annual: SusCell | null;
  showAnnual: boolean;
  selected: boolean;
  /** true when this cell's susceptibility just moved (lab-feed animation) */
  flash: boolean;
  /** bumps on every data refresh so the CSS animation restarts */
  flashNonce: number;
  onSelect: (focus: CellFocus | null) => void;
}) {
  const sufficient = cell.sufficient;
  const delta = annual && annual.sufficient ? cell.sPct - annual.sPct : null;

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={
        sufficient
          ? `${organism}, ${antibiotic}: ${Math.round(cell.sPct)}% susceptible, n=${cell.n}`
          : `${organism}, ${antibiotic}: n=${cell.n}, below the ${MIN_ISOLATES}-isolate threshold`
      }
      onClick={() => onSelect(selected ? null : { organism, antibiotic, cell, annual })}
      className={[
        "flex h-full w-full flex-col items-center justify-center px-2 py-2 text-center",
        sufficient ? "" : "border border-dashed border-border",
        selected
          ? "outline-2 outline-offset-[-2px] outline-primary"
          : "hover:outline-1 hover:outline-offset-[-1px] hover:outline-primary/30",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",
      ].join(" ")}
      style={{ backgroundColor: tintFor(cell) }}
    >
      {sufficient ? (
        <span
          key={`v-${flashNonce}`}
          className={`block font-mono text-[15px] font-semibold leading-tight tabular-nums${flash ? " cell-flash" : ""}`}
          style={{ color: valueColorFor(cell) }}
        >
          {Math.round(cell.sPct)}
        </span>
      ) : (
        <span className="block font-mono text-[13px] font-medium leading-tight text-muted-foreground">
          {`n<${MIN_ISOLATES}`}
        </span>
      )}
      <span
        className={`block font-mono text-[11px] leading-tight tabular-nums ${
          sufficient ? "text-foreground/60" : "text-muted-foreground/70"
        }`}
      >
        {`n=${cell.n.toLocaleString("en-US")}`}
      </span>
      {showAnnual ? (
        <span className="mt-1 block font-mono text-[11px] leading-tight tabular-nums">
          {annual === null ? (
            <span className="text-muted-foreground/50">1y —</span>
          ) : annual.sufficient ? (
            <>
              <span className="text-muted-foreground">1y </span>
              <span className="font-medium text-foreground/70">{Math.round(annual.sPct)}</span>
              {delta !== null && delta > 0 ? <span className="ml-0.5 text-success">▲</span> : null}
              {delta !== null && delta < 0 ? <span className="ml-0.5 text-danger">▼</span> : null}
            </>
          ) : (
            <span className="text-muted-foreground/50">{`1y n<${MIN_ISOLATES}`}</span>
          )}
        </span>
      ) : null}
    </button>
  );
}

/** Compact "instant answer": recommended antibiotic for the top organisms by isolate count. */
export function BestPickStrip({ data }: { data: AntibiogramResponse }) {
  const picks = useMemo(() => {
    return data.rows
      .filter((row) => row.n > 0)
      .slice()
      .sort((a, b) => b.n - a.n)
      .slice(0, 5)
      .map((row) => {
        let best: SusCell | null = null;
        for (const cell of row.cells) {
          if (cell.sufficient && (best === null || cell.sPct > best.sPct)) {
            best = cell;
          }
        }
        return { organism: row.organism, n: row.n, best };
      });
  }, [data]);

  if (picks.length === 0) return null;

  return (
    <section className="mb-5">
      <h2 className="mb-2 text-[12px] font-medium text-muted-foreground">
        Best pick per organism (top 5 by isolates)
      </h2>
      <div className="flex flex-wrap gap-2">
        {picks.map((pick) =>
          pick.best ? (
            <div
              key={pick.organism}
              className="rounded-[10px] border border-success/40 bg-card px-3 py-2"
            >
              <div className="text-[13px] font-medium leading-tight">{pick.organism}</div>
              <div className="mt-0.5 font-mono text-xs leading-tight tabular-nums text-foreground/80">
                {`${pick.best.antibiotic} · ${Math.round(pick.best.sPct)}% S · n=${pick.best.n.toLocaleString("en-US")} · CI ${Math.round(pick.best.ciLo)}–${Math.round(pick.best.ciHi)}%`}
              </div>
            </div>
          ) : (
            <div
              key={pick.organism}
              className="rounded-[10px] border border-warning/40 bg-card px-3 py-2"
            >
              <div className="text-[13px] font-medium leading-tight">{pick.organism}</div>
              <div className="mt-0.5 text-xs leading-tight text-warning">
                {`No reliable recommendation (n < ${MIN_ISOLATES})`}
              </div>
            </div>
          ),
        )}
      </div>
    </section>
  );
}

export function AntibiogramMatrix({
  data,
  annual,
  showAnnual,
  focus,
  flash,
  onSelect,
}: {
  data: AntibiogramResponse;
  /** Response for the 1y window, used for the per-cell comparison in 4w mode. */
  annual: AntibiogramResponse | null;
  showAnnual: boolean;
  focus: CellFocus | null;
  /** Cells whose susceptibility moved on the latest lab-feed refresh. */
  flash?: { nonce: number; keys: Set<string> };
  onSelect: (focus: CellFocus | null) => void;
}) {
  const { rows, antibiotics, cellsByOrganism, annualByKey } = useMemo(() => {
    const visibleRows = data.rows.filter((row) => row.n > 0).sort((a, b) => b.n - a.n);
    const abSet = new Set<string>();
    const cellsByOrganism = new Map<string, Map<string, SusCell>>();
    for (const row of visibleRows) {
      const byAntibiotic = new Map<string, SusCell>();
      for (const cell of row.cells) {
        byAntibiotic.set(cell.antibiotic, cell);
        abSet.add(cell.antibiotic);
      }
      cellsByOrganism.set(row.organism, byAntibiotic);
    }
    const annualByKey = new Map<string, SusCell>();
    if (annual) {
      for (const row of annual.rows) {
        for (const cell of row.cells) {
          annualByKey.set(`${row.organism}\u0000${cell.antibiotic}`, cell);
        }
      }
    }
    return {
      rows: visibleRows,
      antibiotics: [...abSet].sort((a, b) => a.localeCompare(b)),
      cellsByOrganism,
      annualByKey,
    };
  }, [data, annual]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {LEGEND.map((item) => (
          <span
            key={item.label}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <span
              aria-hidden
              className="inline-block h-3 w-5 rounded-[4px]"
              style={
                item.dashed
                  ? {
                      backgroundColor: item.bg,
                      border: "1px dashed var(--border)",
                    }
                  : { backgroundColor: item.bg }
              }
            />
            {item.label}
          </span>
        ))}
      </div>

      <div className="max-h-[560px] overflow-auto rounded-lg border border-border">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 top-0 z-30 min-w-[200px] border-b border-r border-border bg-card px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                Organism
              </th>
              {antibiotics.map((antibiotic) => (
                <th
                  scope="col"
                  key={antibiotic}
                  className="sticky top-0 z-20 min-w-[86px] border-b border-border bg-card px-3 py-2.5 text-center text-[11px] font-medium uppercase leading-tight tracking-wide text-muted-foreground"
                >
                  {antibiotic}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const byAntibiotic = cellsByOrganism.get(row.organism);
              return (
                <tr key={row.organism}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-r border-border bg-card px-4 py-2 text-left"
                  >
                    <div className="whitespace-nowrap text-[13px] font-medium leading-tight">
                      {row.organism}
                    </div>
                    <div className="whitespace-nowrap text-[11px] font-mono leading-tight tabular-nums text-muted-foreground">
                      {`n=${row.n.toLocaleString("en-US")}`}
                    </div>
                  </th>
                  {antibiotics.map((antibiotic) => {
                    const cell = byAntibiotic?.get(antibiotic);
                    return (
                      <td key={antibiotic} className="border-b border-border p-0 align-middle">
                        {cell ? (
                          <CellButton
                            organism={row.organism}
                            antibiotic={antibiotic}
                            cell={cell}
                            annual={annualByKey.get(`${row.organism}\u0000${antibiotic}`) ?? null}
                            showAnnual={showAnnual}
                            selected={
                              focus !== null &&
                              focus.organism === row.organism &&
                              focus.antibiotic === antibiotic
                            }
                            flash={flash?.keys.has(`${row.organism}|${antibiotic}`) ?? false}
                            flashNonce={flash?.nonce ?? 0}
                            onSelect={onSelect}
                          />
                        ) : (
                          <div className="flex min-h-[60px] items-center justify-center px-3 text-[13px] text-muted-foreground/50">
                            –
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
