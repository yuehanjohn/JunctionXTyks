// Rule-based AI advisor: intent parsing over the question + grounded answer
// generation from the stats engine. Server-side only (Prisma-backed) — never
// import this module from a client component.

import { getAntibiogram, getMeta, getSignals } from "@/lib/stats";
import {
  MIN_ISOLATES,
  type AdvisorResponse,
  type MetaResponse,
  type OrganismRow,
  type SignalsResponse,
  type SusCell,
} from "@/lib/types";

// ── Formatting ───────────────────────────────────────────────────────

function fmt(v: number): string {
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function cellBullet(organism: string | null, c: SusCell): string {
  const who = organism ? `${organism} × ${c.antibiotic}` : c.antibiotic;
  const flag = c.sufficient ? "" : ` — insufficient (n < ${MIN_ISOLATES})`;
  return `${who}: ${fmt(c.sPct)}% susceptible (95% CI ${fmt(c.ciLo)}–${fmt(c.ciHi)}%, n=${c.n})${flag}`;
}

function organismList(meta: MetaResponse): string {
  return meta.organisms.length > 0 ? meta.organisms.join(", ") : "none yet";
}

function wardChip(ward: string): string {
  return ward === "All wards" ? "What changed recently?" : `What changed on ${ward}?`;
}

function worstChip(ward: string): string {
  return ward === "All wards" ? "Where is resistance worst?" : `Worst resistance on ${ward}`;
}

function dedupe(chips: string[]): string[] {
  return chips.filter((c, i, arr) => arr.indexOf(c) === i);
}

// ── Organism resolution ──────────────────────────────────────────────

interface OrganismAlias {
  /** Trigger regex over the raw question. */
  re: RegExp;
  /** Matchers tried in order against the tracked organism names. */
  matchers: RegExp[];
  /** Canonical name when the dataset tracks nothing matching. */
  fallback: string;
}

const ORGANISM_ALIASES: OrganismAlias[] = [
  { re: /e\.?\s?coli|ecoli|escherichia/i, matchers: [/coli/i, /escherichia/i], fallback: "Escherichia coli" },
  { re: /klebs/i, matchers: [/klebsiella/i], fallback: "Klebsiella pneumoniae" },
  { re: /\bmrsa\b|au?reus|staph/i, matchers: [/aureus/i, /staph/i], fallback: "Staphylococcus aureus" },
  { re: /pseudomonas|aeruginosa/i, matchers: [/pseudomonas|aeruginosa/i], fallback: "Pseudomonas aeruginosa" },
  { re: /enterococc|faec|\bvre\b/i, matchers: [/enterococc|faec/i], fallback: "Enterococcus faecalis" },
  { re: /proteus|mirabilis/i, matchers: [/proteus|mirabilis/i], fallback: "Proteus mirabilis" },
];

interface ResolvedOrganism {
  name: string;
  /** true when the name is tracked in the dataset (getMeta().organisms) */
  known: boolean;
}

function resolveOrganism(question: string, organisms: string[]): ResolvedOrganism | null {
  const q = question.toLowerCase();
  for (const organism of organisms) {
    if (q.includes(organism.toLowerCase())) return { name: organism, known: true };
  }
  for (const alias of ORGANISM_ALIASES) {
    if (!alias.re.test(question)) continue;
    for (const matcher of alias.matchers) {
      const hit = organisms.find((o) => matcher.test(o));
      if (hit) return { name: hit, known: true };
    }
    return { name: alias.fallback, known: false };
  }
  return null;
}

// ── Intent rules ─────────────────────────────────────────────────────

const THERAPY_RE = /\btherap|\btreat|\buse for\b|best antibiotic|\bempiric|which antibiotic|\bcover/i;
const SIGNALS_RE = /changed|recent|signal|alert|wrong|anomaly/i;
const WORST_RE = /worst|resistan|problem/i;

// ── Answer builders ──────────────────────────────────────────────────

const WINDOW = "4w" as const;

async function answerEmpiric(organism: string, ward: string, meta: MetaResponse): Promise<AdvisorResponse> {
  const abg = await getAntibiogram({ ward, sampleType: null, window: WINDOW });
  const row = abg.rows.find((r) => r.organism.toLowerCase() === organism.toLowerCase());

  if (!row) {
    return {
      intent: "empiric-therapy",
      answer: `No ${organism} isolates were recorded on ${ward} in the current 4-week window, so I can't rank empiric options right now.`,
      bullets: [
        `Tracked organisms: ${organismList(meta)}.`,
        'Try "All wards" in the ward selector, or ask for the profile of another organism.',
      ],
      chips: dedupe([
        `Show me ${meta.organisms[0] ?? "Escherichia coli"}`,
        wardChip(ward),
        worstChip(ward),
      ]),
    };
  }

  const sufficient = row.cells
    .filter((c) => c.sufficient)
    .sort((a, b) => b.sPct - a.sPct || b.n - a.n);
  const top = sufficient.slice(0, 3);
  const insufficient = row.cells.filter((c) => !c.sufficient);

  if (top.length === 0) {
    return {
      intent: "empiric-therapy",
      answer: `${organism} on ${ward}: ${row.n} isolates in the last 4 weeks, but no antibiotic reached the ${MIN_ISOLATES}-isolate minimum for a reliable susceptibility estimate.`,
      bullets:
        insufficient.length > 0
          ? insufficient.map((c) => `${c.antibiotic}: n=${c.n} (below the n ≥ ${MIN_ISOLATES} threshold)`)
          : [`No organism×antibiotic cells were reported for ${organism} in this window.`],
      table: row.cells.map((c) => ({ label: c.antibiotic, sPct: c.sPct, n: c.n, sufficient: c.sufficient })),
      chips: dedupe([wardChip(ward), worstChip(ward), `Show me ${organism}`]),
    };
  }

  return {
    intent: "empiric-therapy",
    answer: `For ${organism} on ${ward} (last 4 weeks, all sample types, n=${row.n} isolates), the highest susceptibility among antibiotics with sufficient isolates:`,
    bullets: [
      ...top.map((c) => cellBullet(null, c)),
      ...(insufficient.length > 0
        ? [`${insufficient.map((c) => `${c.antibiotic} (n=${c.n})`).join(", ")} — excluded, n < ${MIN_ISOLATES}`]
        : []),
      "Caveat: this is surveillance data, not a treatment guideline — always weigh site of infection, severity, allergy history, and local therapy guidelines.",
    ],
    table: row.cells.map((c) => ({ label: c.antibiotic, sPct: c.sPct, n: c.n, sufficient: c.sufficient })),
    chips: dedupe([`Show me ${organism}`, wardChip(ward), worstChip(ward)]),
  };
}

type SignalItem = SignalsResponse["signals"][number];

const SEV_ORDER: Record<SignalItem["severity"], number> = { high: 0, moderate: 1, watch: 2 };

async function answerSignals(ward: string): Promise<AdvisorResponse> {
  const { signals, scanned } = await getSignals({ ward });
  const top = [...signals]
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.dropPp - a.dropPp)
    .slice(0, 3);

  if (top.length === 0) {
    return {
      intent: "signals",
      answer: `No resistance signals on ${ward} right now: ${scanned} ward×organism×antibiotic cells were scanned against the trailing 12-month baseline and none crossed the alert threshold.`,
      bullets: [
        "Susceptibility in the current 28-day rolling window is consistent with baseline.",
        "Cells are re-scored automatically every time new isolates land in the dataset.",
      ],
      chips: [worstChip(ward), "Best antibiotic for E. coli?", "Show me Klebsiella pneumoniae"],
    };
  }

  const label = (s: SignalItem) => `${s.organism} × ${s.antibiotic}${s.sampleType ? ` (${s.sampleType})` : ""}`;
  return {
    intent: "signals",
    answer: `${signals.length} resistance signal${signals.length === 1 ? "" : "s"} on ${ward} in the current 28-day window (${scanned} cells scanned). Most severe first:`,
    bullets: top.map(
      (s) =>
        `${label(s)} — ${fmt(s.windowS)}% susceptible now vs ${fmt(s.baselineS)}% baseline, a ${fmt(s.dropPp)} pp drop (z=${fmt(s.z)}, n=${s.nWindow} window vs ${s.nBaseline} baseline) — severity: ${s.severity}`,
    ),
    table: top.map((s) => ({
      label: label(s),
      sPct: s.windowS,
      n: s.nWindow,
      sufficient: s.nWindow >= MIN_ISOLATES,
    })),
    chips: dedupe([`Best antibiotic for ${top[0].organism}?`, `Show me ${top[0].organism}`, worstChip(ward)]),
  };
}

async function answerWorstCells(ward: string, meta: MetaResponse): Promise<AdvisorResponse> {
  const abg = await getAntibiogram({ ward, sampleType: null, window: WINDOW });
  const cells = abg.rows.flatMap((row) => row.cells.map((c) => ({ organism: row.organism, cell: c })));
  const sufficient = cells
    .filter((x) => x.cell.sufficient)
    .sort((a, b) => a.cell.sPct - b.cell.sPct || b.cell.n - a.cell.n);
  const bottom = sufficient.slice(0, 5);

  if (bottom.length === 0) {
    return {
      intent: "worst-cells",
      answer: `On ${ward}, no organism×antibiotic cell reached ${MIN_ISOLATES} isolates in the last 4 weeks (${cells.length} cells reported), so resistance can't be ranked reliably yet.`,
      bullets: [
        'Widen the view by selecting "All wards", or wait for more isolates to land in the window.',
        `Tracked organisms: ${organismList(meta)}.`,
      ],
      chips: [wardChip(ward), "Best antibiotic for E. coli?", "Show me Klebsiella pneumoniae"],
    };
  }

  return {
    intent: "worst-cells",
    answer: `Lowest susceptibility on ${ward} in the last 4 weeks (all sample types) — bottom ${bottom.length} of ${sufficient.length} sufficient cells:`,
    bullets: bottom.map((x) => cellBullet(x.organism, x.cell)),
    table: bottom.map((x) => ({
      label: `${x.organism} × ${x.cell.antibiotic}`,
      sPct: x.cell.sPct,
      n: x.cell.n,
      sufficient: true,
    })),
    chips: dedupe([
      `Best antibiotic for ${bottom[0].organism}?`,
      `Show me ${bottom[0].organism}`,
      wardChip(ward),
    ]),
  };
}

async function answerOrganismProfile(organism: string, ward: string, meta: MetaResponse): Promise<AdvisorResponse> {
  const abg = await getAntibiogram({ ward, sampleType: null, window: WINDOW });
  const row: OrganismRow | undefined = abg.rows.find(
    (r) => r.organism.toLowerCase() === organism.toLowerCase(),
  );

  if (!row) {
    return {
      intent: "organism-profile",
      answer: `No ${organism} isolates on ${ward} in the current 4-week window.`,
      bullets: [
        `Tracked organisms: ${organismList(meta)}.`,
        'Try "All wards" in the ward selector for a broader view.',
      ],
      chips: dedupe([
        wardChip(ward),
        worstChip(ward),
        `Best antibiotic for ${meta.organisms[0] ?? organism}?`,
      ]),
    };
  }

  const sorted = [...row.cells].sort((a, b) => b.sPct - a.sPct || b.n - a.n);
  return {
    intent: "organism-profile",
    answer: `Susceptibility profile for ${organism} on ${ward} — last 4 weeks, all sample types, n=${row.n} isolates:`,
    bullets:
      sorted.length > 0
        ? sorted.map((c) => cellBullet(null, c))
        : [`No organism×antibiotic cells were reported for ${organism} in this window.`],
    table: sorted.map((c) => ({ label: c.antibiotic, sPct: c.sPct, n: c.n, sufficient: c.sufficient })),
    chips: dedupe([`Best antibiotic for ${organism}?`, wardChip(ward), worstChip(ward)]),
  };
}

function answerUnknownOrganism(meta: MetaResponse): AdvisorResponse {
  const first = meta.organisms[0];
  const second = meta.organisms[1] ?? meta.organisms[0];
  return {
    intent: "organism-unknown",
    answer: `I couldn't match that to an organism I track. The dataset currently covers: ${organismList(meta)}.`,
    bullets: [
      first ? `Try: "Best antibiotic for ${first}?"` : 'Ask about a tracked organism by name, e.g. "Show me Escherichia coli".',
      second ? `Try: "Show me ${second}"` : "Ask for resistance signals or the worst-performing cells.",
    ],
    chips: dedupe([
      first ? `Best antibiotic for ${first}?` : "What changed recently?",
      second ? `Show me ${second}` : "Where is resistance worst?",
      "What changed recently?",
      "Where is resistance worst?",
    ]),
  };
}

function answerHelp(meta: MetaResponse): AdvisorResponse {
  return {
    intent: "help",
    answer:
      "I'm the AEI advisor — a rule-based assistant over the live surveillance dataset, no black box. Ask about empiric options per organism, resistance signals, worst-performing cells, or a full susceptibility profile; every number is computed from the antibiogram with Wilson 95% CIs, and cells with fewer than 30 isolates are flagged as insufficient.",
    bullets: [
      'Empiric therapy — "Best antibiotic for E. coli?" or "What to use for Klebsiella pneumoniae?"',
      'Resistance signals — "What changed recently?" or "Any resistance alerts?"',
      'Worst cells — "Where is resistance worst?"',
      `Organism profile — "Show me ${meta.organisms[0] ?? "Pseudomonas aeruginosa"}"`,
    ],
    chips: [
      "Best antibiotic for E. coli?",
      "What changed recently?",
      "Where is resistance worst?",
      "Show me Klebsiella pneumoniae",
    ],
  };
}

// ── Entry point ──────────────────────────────────────────────────────

export async function answerQuestion(question: string, ward?: string): Promise<AdvisorResponse> {
  const meta = await getMeta();
  const w = ward && meta.wards.includes(ward) ? ward : "All wards";
  const org = resolveOrganism(question, meta.organisms);
  const therapy = THERAPY_RE.test(question);

  if (therapy && org?.known) return answerEmpiric(org.name, w, meta);
  if (SIGNALS_RE.test(question)) return answerSignals(w);
  if (WORST_RE.test(question)) return answerWorstCells(w, meta);
  if (org) {
    return org.known
      ? answerOrganismProfile(org.name, w, meta)
      : answerUnknownOrganism(meta);
  }
  if (therapy) return answerUnknownOrganism(meta);
  return answerHelp(meta);
}
