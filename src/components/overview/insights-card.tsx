"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";

import { Badge, Card } from "@/components/ui";
import type { AlertInvestigationResponse, HeatmapResponse, OverviewResponse } from "@/lib/types";

import { ALL_WARDS, fmtNum, fmtSigned } from "./format";

function SignalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function CompareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 21V9" />
      <path d="M12 21V3" />
      <path d="M19 21v-7" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 13c0 5-3.5 7.5-7.7 8.9a1.9 1.9 0 0 1-1.1 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

type Insight = { tone: string; icon: ReactNode; text: ReactNode };

/**
 * Rule-based bullets computed client-side from already-fetched data:
 * (a) top signal summary, (b) investigated cell vs hospital-wide,
 * (c) most active standard option for the selected organism (from /api/heatmap).
 */
export function InsightsCard({
  overview,
  investigation,
  heatmap,
}: {
  overview: OverviewResponse;
  investigation: AlertInvestigationResponse | null;
  heatmap: HeatmapResponse | null;
}) {
  const insights = useMemo<Insight[]>(() => {
    const list: Insight[] = [];

    const top = overview.alerts[0];
    list.push(
      top
        ? {
            tone: "text-danger",
            icon: <SignalIcon />,
            text: (
              <>
                Emerging signal — {top.organism} resistance to {top.antibiotic} on {top.ward}:
                susceptible share fell {fmtNum(top.dropPp)} pp to {fmtNum(top.windowS)}% in the last
                4 weeks (z {fmtSigned(top.z)}, n={top.nWindow}).
              </>
            ),
          }
        : {
            tone: "text-muted-foreground",
            icon: <SignalIcon />,
            text: "No emerging resistance signals detected in this window.",
          },
    );

    if (investigation) {
      const sig = investigation.signal;
      if (sig.ward === ALL_WARDS) {
        const highest = investigation.wardRank[0];
        list.push(
          highest
            ? {
                tone: "text-primary",
                icon: <CompareIcon />,
                text: (
                  <>
                    Comparative — highest ward burden for {sig.organism} to {sig.antibiotic} is{" "}
                    {highest.ward} at {fmtNum(highest.rPct)}%, vs{" "}
                    {fmtNum(investigation.hospital.rPct)}% hospital-wide (n=
                    {investigation.hospital.n}).
                  </>
                ),
              }
            : {
                tone: "text-muted-foreground",
                icon: <CompareIcon />,
                text: "Comparative — no ward has enough isolates for this cell in the current window.",
              },
        );
      } else {
        const wardR = 100 - sig.windowS;
        list.push({
          tone: "text-primary",
          icon: <CompareIcon />,
          text: (
            <>
              Comparative — {sig.organism} resistance to {sig.antibiotic} on {sig.ward} is{" "}
              {fmtNum(wardR)}% in the current window, vs {fmtNum(investigation.hospital.rPct)}%
              hospital-wide (n={investigation.hospital.n}).
            </>
          ),
        });
      }
    } else {
      list.push({
        tone: "text-muted-foreground",
        icon: <CompareIcon />,
        text: "Comparative — appears when a signal is under investigation.",
      });
    }

    const best = heatmap?.rows
      .filter((r) => r.overall.sufficient)
      .sort((a, b) => a.overall.rPct - b.overall.rPct || b.overall.n - a.overall.n)[0];
    list.push(
      best
        ? {
            tone: "text-success",
            icon: <ShieldIcon />,
            text: (
              <>
                Panel note — {best.antibiotic} remains the most active standard option against{" "}
                {heatmap?.organism} in the current window ({fmtNum(best.overall.rPct)}% resistant,
                n={best.overall.n}).
              </>
            ),
          }
        : {
            tone: "text-muted-foreground",
            icon: <ShieldIcon />,
            text: "Panel note — insufficient susceptibility data for this organism in the current window.",
          },
    );

    return list;
  }, [overview, investigation, heatmap]);

  return (
    <Card className="min-w-0">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-foreground">Automated insights</h2>
        <Badge>rule-based</Badge>
      </div>
      <ul className="space-y-2.5">
        {insights.map((insight, i) => (
          <li key={i} className="flex gap-2.5">
            <span className={`mt-0.5 shrink-0 ${insight.tone}`} aria-hidden="true">
              {insight.icon}
            </span>
            <span className="text-xs leading-relaxed text-foreground">{insight.text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
        Population-level surveillance only — not patient-specific advice and not a treatment
        guideline.
      </p>
    </Card>
  );
}
