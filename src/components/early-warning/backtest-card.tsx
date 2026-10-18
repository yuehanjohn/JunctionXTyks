"use client";

import { useEffect, useState } from "react";

import { Badge, Card } from "@/components/ui";
import type { BacktestResponse } from "@/lib/types";

import {
  Busy,
  CardHeading,
  KIND_LABELS,
  LoadError,
  SkeletonCard,
  fmtNum,
  loadJson,
} from "./bits";

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "danger";
}) {
  const color =
    tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-foreground";
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-[14px] font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

/** Lazy panel: the deterministic backtest takes ~20 s on its first hit, so it
 *  only runs when the user expands the card; the result is cached server-side. */
export function BacktestCard({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open || data) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    loadJson<BacktestResponse>("/api/backtest", controller.signal)
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
  }, [open, attempt, data]);

  const overBudget = data !== null && data.falseAlarmsPerMonth > 2;

  return (
    <Card className={className}>
      <CardHeading
        title="Does the detector work?"
        sub="Deterministic backtest of the detection stack against injected outbreak scenarios and an outbreak-free baseline."
        right={loading ? <Busy label="Running scenarios…" /> : null}
      />
      {!open ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
            The full harness replays labelled outbreaks through every detector and measures
            detection latency, false alarms and PPV. It takes ~20 s on the first run — run it on
            demand.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="h-9 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Run backtest
          </button>
        </div>
      ) : error && !data ? (
        <LoadError message={error} onRetry={() => setAttempt((a) => a + 1)} />
      ) : loading && !data ? (
        <div className="mt-4">
          <SkeletonCard hint="Running deterministic scenarios — ~20 s on the first load, then cached." rows={4} />
        </div>
      ) : data ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Stat
              label="False alarms / month"
              value={`${fmtNum(data.falseAlarmsPerMonth)} vs ≤2 budget`}
              tone={overBudget ? "danger" : "success"}
            />
            <Stat label="PPV" value={data.ppv === null ? "—" : `${fmtNum(data.ppv * 100)}%`} />
            <Stat
              label="Clean-period check"
              value={`${fmtNum(data.alertsInCleanPeriod)} alerts in ${fmtNum(data.cleanPeriodDays)} outbreak-free days`}
            />
            <Stat label="Runtime" value={`${fmtNum(data.runtimeMs / 1000)} s`} />
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Scenario
                  </th>
                  <th scope="col" className="py-2 pr-3 text-center font-medium">
                    Detected
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Latency (days)
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Detected by
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.scenarios.map((s) => (
                  <tr
                    key={s.scenario}
                    className="border-b border-border last:border-b-0 hover:bg-muted/40"
                  >
                    <td className="py-2 pr-3">
                      <p className="font-medium">{s.scenario}</p>
                      <p className="mt-0.5 max-w-md text-[12px] leading-relaxed text-muted-foreground">
                        {s.description}
                      </p>
                    </td>
                    <td className="py-2 pr-3 text-center">
                      {s.detected ? (
                        <span className="font-semibold text-success">✓</span>
                      ) : (
                        <span className="font-semibold text-danger">✗</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {s.latencyDays === null ? "—" : fmtNum(s.latencyDays)}
                    </td>
                    <td className="py-2">
                      {s.detectingKinds.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {s.detectingKinds.map((k) => (
                            <Badge key={k} tone="neutral">
                              {KIND_LABELS[k]}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Methodology
            </h3>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-muted-foreground">
              {data.methodology.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
          <p className="mt-3 text-[12px] text-muted-foreground">
            Scenarios are deterministic, labelled injections into in-memory copies — never mixed
            into the live dataset.
          </p>
        </>
      ) : null}
    </Card>
  );
}
