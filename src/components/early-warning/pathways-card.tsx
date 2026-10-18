"use client";

import { useMemo } from "react";

import { Card } from "@/components/ui";
import type { PathwaysResponse } from "@/lib/types";

import { Busy, CardHeading, EmptyHint, LoadError, SkeletonCard, fmtNum, fmtWindow } from "./bits";

function FlowList({ items }: { items: { label: string; patients: number }[] }) {
  if (items.length === 0) return <span className="text-muted-foreground">—</span>;
  return <>{items.map((i) => `${i.label} (${fmtNum(i.patients)})`).join(", ")}</>;
}

/** Ward-to-ward transfer reconstruction: the top-10 edges plus per-ward
 *  inbound/outbound flows. The API's methodology note renders verbatim. */
export function PathwaysCard({
  pathways,
  loading,
  refreshing,
  error,
  onRetry,
  className = "",
}: {
  pathways: PathwaysResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRetry: () => void;
  className?: string;
}) {
  const edges = useMemo(
    () =>
      (pathways?.edges ?? [])
        .slice()
        .sort((a, b) => b.patients - a.patients)
        .slice(0, 10),
    [pathways],
  );
  const flows = useMemo(
    () =>
      (pathways?.flows ?? [])
        .slice()
        .sort((a, b) => b.inbound + b.outbound - (a.inbound + a.outbound)),
    [pathways],
  );

  return (
    <Card className={className}>
      <CardHeading
        title="Patient pathways"
        sub={
          pathways
            ? `${fmtWindow(pathways.windowStart, pathways.windowEnd)} · a ward change within ≤${pathways.transferGapDays} days between cultures counts as a transfer`
            : undefined
        }
        right={refreshing ? <Busy label="Updating…" /> : null}
      />
      {error && !pathways ? (
        <LoadError message={error} onRetry={onRetry} />
      ) : loading && !pathways ? (
        <div className="mt-4">
          <SkeletonCard hint="Reconstructing patient transfers…" />
        </div>
      ) : pathways && pathways.edges.length === 0 ? (
        <>
          <EmptyHint>No ward-to-ward transfers reconstructed in this window.</EmptyHint>
          <p className="border-t border-border pt-3 text-[12px] leading-relaxed text-muted-foreground">
            {pathways.note}
          </p>
        </>
      ) : pathways ? (
        <>
          <div className="mt-4 grid gap-6 xl:grid-cols-2">
            <section className="min-w-0">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Top transfer edges
              </h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="py-2 pr-3 font-medium">
                        From
                      </th>
                      <th scope="col" className="py-2 pr-3 font-medium">
                        To
                      </th>
                      <th scope="col" className="py-2 text-right font-medium">
                        Patients
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {edges.map((e) => (
                      <tr
                        key={`${e.from}|${e.to}`}
                        className="border-b border-border last:border-b-0 hover:bg-muted/40"
                      >
                        <td className="whitespace-nowrap py-2 pr-3">{e.from}</td>
                        <td className="whitespace-nowrap py-2 pr-3">{e.to}</td>
                        <td className="py-2 text-right font-mono tabular-nums">
                          {fmtNum(e.patients)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="min-w-0">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Per-ward flows
              </h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Ward
                      </th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">
                        In
                      </th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">
                        Out
                      </th>
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Top inbound
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        Top outbound
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {flows.map((f) => (
                      <tr
                        key={f.ward}
                        className="border-b border-border last:border-b-0 hover:bg-muted/40"
                      >
                        <td className="whitespace-nowrap py-2 pr-3 font-medium">{f.ward}</td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">
                          {fmtNum(f.inbound)}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">
                          {fmtNum(f.outbound)}
                        </td>
                        <td className="py-2 pr-3 text-[12px] text-muted-foreground">
                          <FlowList
                            items={f.topInbound.map((i) => ({ label: i.from, patients: i.patients }))}
                          />
                        </td>
                        <td className="py-2 text-[12px] text-muted-foreground">
                          <FlowList
                            items={f.topOutbound.map((i) => ({ label: i.to, patients: i.patients }))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
          <p className="mt-4 border-t border-border pt-3 text-[12px] leading-relaxed text-muted-foreground">
            {pathways.note}
          </p>
        </>
      ) : null}
    </Card>
  );
}
