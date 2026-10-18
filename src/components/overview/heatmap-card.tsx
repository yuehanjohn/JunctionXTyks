"use client";

import { Card, Select, type SelectOption, ToneLegend, toneColor } from "@/components/ui";
import type { HeatmapCell, HeatmapResponse } from "@/lib/types";

import { CardTitle, EmptyNote } from "./bits";
import { fmtNum } from "./format";

/** One tone-tinted percentage cell (band + baseline escalation; grey when n<30). */
function HeatCell({
  cell,
  organism,
  antibiotic,
  ward,
}: {
  cell: HeatmapCell;
  organism: string;
  antibiotic: string;
  ward: string;
}) {
  return (
    <div
      title={`${organism} · ${antibiotic} · ${ward} — ${cell.n} isolates${
        cell.sufficient ? "" : ", n<30 = not reported"
      }${cell.baselineR !== null ? ` · 12-month baseline ${fmtNum(cell.baselineR)}%` : ""}`}
      className={`rounded px-2 py-1.5 text-center text-xs font-medium tabular-nums ${
        cell.sufficient ? "text-foreground" : "text-muted-foreground"
      }`}
      style={{ backgroundColor: toneColor(cell.tone) }}
    >
      {fmtNum(cell.rPct)}%
    </div>
  );
}

function MissingCell() {
  return (
    <div className="rounded px-2 py-1.5 text-center text-xs text-muted-foreground/60">—</div>
  );
}

const HEADER_CELL = "border-b border-border px-2 pb-2 text-[11px] font-medium text-muted-foreground";

/**
 * Organism × antibiotic resistance matrix: rows are antibiotics (sorted by
 * overall % resistant server-side), columns are Overall + every ward. Scrolls
 * horizontally inside the card; wide matrices never stretch the page.
 */
export function HeatmapCard({
  heatmap,
  organism,
  organismOptions,
  onOrganismChange,
  busy,
}: {
  heatmap: HeatmapResponse | null;
  organism: string | null;
  organismOptions: SelectOption[];
  onOrganismChange: (organism: string) => void;
  busy: boolean;
}) {
  const columns = heatmap?.wards ?? [];

  return (
    <Card className="min-w-0">
      <CardTitle
        title="Resistance by organism and antibiotic"
        subtitle="Percentage of resistant isolates (first isolate per patient, minimum 30 isolates)"
        right={
          <Select
            label="Organism"
            value={organism ?? ""}
            options={organismOptions}
            onChange={onOrganismChange}
            className="w-48"
          />
        }
      />
      {!heatmap || columns.length === 0 ? (
        <EmptyNote>{busy ? "Loading heatmap…" : "No isolates in this window"}</EmptyNote>
      ) : (
        <div className={`overflow-x-auto transition-opacity ${busy ? "opacity-60" : ""}`}>
          <table className="min-w-max border-separate border-spacing-0">
            <thead>
              <tr>
                <th className={`sticky left-0 z-10 bg-card text-left ${HEADER_CELL}`}>Antibiotic</th>
                {columns.map((ward, i) => (
                  <th key={ward} className={`min-w-[64px] text-center ${HEADER_CELL} ${i === 0 ? "text-foreground" : ""}`}>
                    {ward}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatmap.rows.map((row) => {
                const byWard = new Map(row.cells.map((c) => [c.ward, c]));
                return (
                  <tr key={row.antibiotic}>
                    <td className="sticky left-0 z-10 bg-card py-1 pr-4 text-xs font-medium text-foreground">
                      {row.antibiotic}
                    </td>
                    {columns.map((ward, i) => {
                      if (i === 0) {
                        return (
                          <td key={ward} className="min-w-[64px] py-1 pl-1">
                            <HeatCell cell={row.overall} organism={heatmap.organism} antibiotic={row.antibiotic} ward={ward} />
                          </td>
                        );
                      }
                      const cell = byWard.get(ward);
                      return (
                        <td key={ward} className="min-w-[64px] py-1 pl-1">
                          {cell ? (
                            <HeatCell cell={cell} organism={heatmap.organism} antibiotic={row.antibiotic} ward={ward} />
                          ) : (
                            <MissingCell />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ToneLegend extra="12-month baseline shown on cell hover" />
        </div>
      )}
    </Card>
  );
}
