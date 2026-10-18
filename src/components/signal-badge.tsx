"use client";

import { useEffect, useState } from "react";
import type { SignalsResponse } from "@/lib/types";

/** Live count of active resistance signals, shown in the sidebar so
 *  anomalies announce themselves instead of waiting to be discovered. */
export default function SignalBadge() {
  const [worst, setWorst] = useState<"high" | "moderate" | "watch" | null>(null);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/signals")
        .then((r) => (r.ok ? (r.json() as Promise<SignalsResponse>) : null))
        .then((data) => {
          if (!alive || !data) return;
          const n = data.signals.length;
          setCount(n);
          setWorst(
            data.signals.some((s) => s.severity === "high")
              ? "high"
              : data.signals.some((s) => s.severity === "moderate")
                ? "moderate"
                : n > 0
                  ? "watch"
                  : null,
          );
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 120_000);
    // New samples landing (lab-feed demo) re-score signals server-side; refresh
    // immediately instead of waiting for the next poll.
    const onRefresh = () => load();
    window.addEventListener("aei:refresh-signals", onRefresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("aei:refresh-signals", onRefresh);
    };
  }, []);

  if (count === null || count === 0) return null;
  const cls =
    worst === "high"
      ? "bg-danger text-white"
      : worst === "moderate"
        ? "bg-warning text-white"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${cls}`}
      title={`${count} active resistance signal${count === 1 ? "" : "s"}`}
    >
      {count}
    </span>
  );
}
