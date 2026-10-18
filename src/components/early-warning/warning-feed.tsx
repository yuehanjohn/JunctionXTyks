"use client";

import Link from "next/link";

import { Badge, Card, SeverityBadge } from "@/components/ui";
import type { Warning, WarningFeedResponse } from "@/lib/types";

import { Busy, CardHeading, EmptyHint, KindChip, LoadError, SkeletonCard, fmtWindow } from "./bits";

const GROUPS = [
  { severity: "high", label: "High severity" },
  { severity: "moderate", label: "Moderate severity" },
  { severity: "watch", label: "Watch" },
] as const;

function WarningRow({ warning }: { warning: Warning }) {
  return (
    <div className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-start sm:gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:w-56">
        <SeverityBadge severity={warning.severity} />
        <KindChip kind={warning.kind} />
        {warning.mdro ? <Badge tone="neutral">MDRO</Badge> : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-snug">{warning.headline}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
          {warning.evidence}
        </p>
      </div>
      <Link
        href="/alerts"
        className="shrink-0 whitespace-nowrap text-[12px] font-medium text-primary hover:underline"
      >
        Investigate →
      </Link>
    </div>
  );
}

/** Severity-grouped detector output. Every row is a statistical hypothesis —
 *  the drilldown (isolate line-list, pathways, checklist) lives on /alerts. */
export function WarningFeedCard({
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
  return (
    <Card className={className}>
      <CardHeading
        title="Warning feed"
        sub={
          feed
            ? `Rolling 4-week window ${fmtWindow(feed.windowStart, feed.windowEnd)} · ranked by evidence score`
            : "Rolling 4-week window · ranked by evidence score"
        }
        right={refreshing ? <Busy label="Updating…" /> : null}
      />
      {error && !feed ? (
        <LoadError message={error} onRetry={onRetry} />
      ) : loading && !feed ? (
        <div className="mt-4">
          <SkeletonCard
            hint="Running the detection stack — the first pass can take ~30 s while the config backtest warms up."
            rows={4}
          />
        </div>
      ) : feed && feed.warnings.length === 0 ? (
        <EmptyHint>No warnings fired in this window — every detector stayed below threshold.</EmptyHint>
      ) : feed ? (
        <div className="mt-3">
          {GROUPS.map((group) => {
            const rows = feed.warnings.filter((w) => w.severity === group.severity);
            if (rows.length === 0) return null;
            return (
              <section key={group.severity} className="border-b border-border py-2 last:border-b-0">
                <div className="flex items-center gap-2 pt-1">
                  <SeverityBadge severity={group.severity} />
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {rows.length} warning{rows.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-1">
                  {rows.map((w) => (
                    <WarningRow key={w.id} warning={w} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}
    </Card>
  );
}
