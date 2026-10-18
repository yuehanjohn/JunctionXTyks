"use client";

import { useEffect, useRef, useState } from "react";
import type { AdvisorResponse } from "@/lib/types";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  response?: AdvisorResponse;
}

type TableRow = NonNullable<AdvisorResponse["table"]>[number];

const STARTERS = [
  "Best antibiotic for E. coli?",
  "What changed recently?",
  "Where is resistance worst?",
  "Show me Klebsiella pneumoniae",
];

function fmt(v: number): string {
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function ThinkingBubble() {
  return (
    <div
      role="status"
      aria-label="Advisor is thinking"
      className="flex items-center gap-1.5 py-1"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

function AnswerTable({ rows }: { rows: TableRow[] }) {
  return (
    <table className="mt-3 w-full text-sm">
      <thead>
        <tr className="border-b border-border">
          <th className="py-2 text-left text-[11px] font-medium text-muted-foreground">Cell</th>
          <th className="py-2 text-right text-[11px] font-medium text-muted-foreground">% S</th>
          <th className="py-2 text-right text-[11px] font-medium text-muted-foreground">n</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={i}
            className={`border-b border-border ${r.sufficient ? "" : "text-muted-foreground"}`}
          >
            <td className="py-1.5 text-left">
              {r.label}
              {!r.sufficient && <span className="ml-2 font-mono text-[11px]">n&lt;30</span>}
            </td>
            <td className="py-1.5 text-right font-mono tabular-nums">{fmt(r.sPct)}%</td>
            <td className="py-1.5 text-right font-mono tabular-nums">{r.n}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AssistantMessage({
  text,
  response,
  onChip,
}: {
  text: string;
  response?: AdvisorResponse;
  onChip: (q: string) => void;
}) {
  return (
    <div className="border-t border-border pt-4">
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
      {response && response.bullets.length > 0 && (
        <ul className="mt-2.5 space-y-1.5">
          {response.bullets.map((b, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
              <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
              <span className="tabular-nums">{b}</span>
            </li>
          ))}
        </ul>
      )}
      {response?.table && response.table.length > 0 && <AnswerTable rows={response.table} />}
      {response && response.chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {response.chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChip(c)}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdvisorPage() {
  const [ward, setWard] = useState("All wards");
  const [wards, setWards] = useState<string[]>(["All wards"]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Populate the ward selector; the advisor stays usable with "All wards" alone
  // if the meta route is unavailable.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/meta")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        if (cancelled || data === null || typeof data !== "object" || !("wards" in data)) return;
        const raw: unknown = data.wards;
        if (!Array.isArray(raw)) return;
        const names = raw.filter((x): x is string => typeof x === "string");
        if (names.length > 0) {
          setWards(["All wards", ...names.filter((n) => n !== "All wards")]);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  async function send(question: string) {
    const q = question.trim();
    if (q.length === 0 || sending) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setSending(true);
    try {
      const res = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, ward }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as AdvisorResponse;
      setMessages((m) => [...m, { role: "assistant", text: data.answer, response: data }]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "Sorry — I couldn't reach the surveillance dataset just now. Please try again.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden rounded-[10px] border border-border bg-card">
      <div className="flex items-end justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Antibiotic Guidance</h1>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            answers computed from the current dataset · not a treatment guideline
          </p>
        </div>
        <label className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Ward</span>
          <select
            value={ward}
            onChange={(e) => setWard(e.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
          >
            {wards.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-md text-center">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted font-mono text-sm font-medium text-foreground">
                  Æ
                </div>
                <p className="text-sm leading-relaxed">
                  Ask about empiric antibiotic options, resistance signals, or the
                  worst-performing organism×antibiotic cells for any ward.
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Every number is computed live from the surveillance antibiogram, Wilson 95% CIs
                  included — nothing is invented.
                </p>
              </div>
            </div>
          ) : (
            messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[80%] whitespace-pre-wrap rounded-[14px] bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground">
                    {m.text}
                  </div>
                </div>
              ) : (
                <AssistantMessage key={i} text={m.text} response={m.response} onChip={send} />
              ),
            )
          )}
          {sending && <ThinkingBubble />}
        </div>

        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-center gap-2 border-t border-border px-5 py-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask about ${ward === "All wards" ? "any ward" : ward}…`}
            className="h-9 flex-1 rounded-lg border border-border bg-card px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          <button
            type="submit"
            disabled={input.trim().length === 0 || sending}
            className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
