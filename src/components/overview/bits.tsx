import type { ReactNode } from "react";

/** Card header: bold title, muted subtitle, optional right-hand slot (chip / select). */
export function CardTitle({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

/**
 * Explicit empty state. Shown instead of zeros whenever a window has no
 * isolates — a missing measurement must never read as "0%".
 */
export function EmptyNote({ children = "No isolates in this window" }: { children?: ReactNode }) {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
      {children}
    </div>
  );
}

/** Small circular tinted icon used on the KPI cards. */
export function TintedIcon({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tone}`}
      aria-hidden="true"
    >
      {children}
    </div>
  );
}
