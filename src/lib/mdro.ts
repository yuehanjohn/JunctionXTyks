// ── MDRO / warning-phenotype engine (pure) ────────────────────────────
//
// Classifies isolates into warning phenotypes from the susceptibility
// panel. These are PHENOTYPE PROXIES computed from a synthetic dataset —
// they signal "worth attention", they are not laboratory confirmation
// (no molecular typing exists here).
//
// Definitions (EUCAST-style screening logic, documented in the UI):
//   MRSA-type   S. aureus, cefoxitin (methicillin screen) R
//   VRE         E. faecium / E. faecalis, vancomycin R
//   CRE-proxy   Enterobacterales, meropenem R (carbapenem-non-susceptible)
//   3GC-R       Enterobacterales, cefuroxime or ceftazidime R
//   ESBL-proxy  3GC-R with meropenem S (screening combination; molecular
//               confirmation would be required)
//   MDR         non-susceptible (R) to ≥3 distinct antibiotic classes

import { cusumScan, weekStart, type DetIsolate, type DetectionConfig } from "./detect";
import type {
  MdroAssessment,
  MdroClass,
  MdroDefinition,
  MdroRecentIsolate,
  MdroWardRow,
  MdroWeeklyPoint,
} from "./types";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Antibiotic → class map for the dataset panel (MDR counting). */
export const ANTIBIOTIC_CLASS: Record<string, string> = {
  Ampicillin: "aminopenicillins",
  Penicillin: "penicillins",
  Pivmecillinam: "pencillin derivatives",
  "Piperacillin-tazobactam": "ureidopenicillins",
  Cefuroxime: "2nd-generation cephalosporins",
  Ceftazidime: "3rd-generation cephalosporins",
  "Cefoxitin (methicillin)": "cephamycins (methicillin screen)",
  Meropenem: "carbapenems",
  Ciprofloxacin: "fluoroquinolones",
  Gentamicin: "aminoglycosides",
  Trimethoprim: "folate-pathway agents",
  Nitrofurantoin: "nitrofurans",
  Erythromycin: "macrolides",
  Clindamycin: "lincosamides",
  Vancomycin: "glycopeptides",
  "Fusidic acid": "fusidanes",
  Rifampicin: "rifamycins",
};

const METHICILLIN_SCREEN = "Cefoxitin (methicillin)";
const ENTEROBACTERALES = new Set([
  "Escherichia coli",
  "Klebsiella pneumoniae",
  "Enterobacter cloacae",
  "Proteus mirabilis",
]);

export const MDRO_DEFINITIONS: MdroDefinition[] = [
  { cls: "MRSA-type", definition: "S. aureus with cefoxitin (methicillin screen) R." },
  { cls: "VRE", definition: "E. faecium or E. faecalis with vancomycin R." },
  { cls: "CRE-proxy", definition: "Enterobacterales with meropenem R (carbapenem-non-susceptible)." },
  {
    cls: "3GC-R",
    definition: "Enterobacterales with cefuroxime or ceftazidime R.",
  },
  {
    cls: "ESBL-proxy",
    definition: "3GC-R with meropenem S — screening combination only; molecular confirmation required.",
  },
  {
    cls: "MDR",
    definition: "Non-susceptible (R) to ≥3 distinct antibiotic classes on the tested panel.",
  },
];

export function classifyIsolate(row: DetIsolate): MdroAssessment {
  const isR = (ab: string): boolean => row.results[ab] === "R";
  const phenotypes: MdroClass[] = [];
  const resistantClasses = new Set<string>();
  let n = 0;
  let r = 0;
  for (const [ab, result] of Object.entries(row.results)) {
    n += 1;
    if (result === "R") {
      r += 1;
      const cls = ANTIBIOTIC_CLASS[ab];
      if (cls) resistantClasses.add(cls);
    }
  }

  const enterobacterales = ENTEROBACTERALES.has(row.organism);
  if (row.organism === "Staphylococcus aureus" && isR(METHICILLIN_SCREEN)) phenotypes.push("MRSA-type");
  if ((row.organism === "Enterococcus faecium" || row.organism === "Enterococcus faecalis") && isR("Vancomycin"))
    phenotypes.push("VRE");
  const carbapenemR = enterobacterales && isR("Meropenem");
  if (carbapenemR) phenotypes.push("CRE-proxy");
  const threeGcR =
    enterobacterales && (isR("Cefuroxime") || isR("Ceftazidime"));
  if (threeGcR) phenotypes.push("3GC-R");
  if (threeGcR && row.results["Meropenem"] === "S") phenotypes.push("ESBL-proxy");
  if (resistantClasses.size >= 3) phenotypes.push("MDR");

  return { phenotypes, resistantClasses: [...resistantClasses], n, r };
}

/** Weekly MDRO prevalence over the trailing `weeklyCount` weeks ending at
 *  `asOf`. Rows must already be first-isolate deduped. */
export function mdroWeekly(
  rows: DetIsolate[],
  asOf: number,
  weeklyCount = 26,
): MdroWeeklyPoint[] {
  const out: MdroWeeklyPoint[] = [];
  const lastWeek = weekFloor(asOf);
  for (let w = weeklyCount - 1; w >= 0; w--) {
    const start = lastWeek - w * WEEK_MS;
    const end = start + WEEK_MS;
    const inWeek = rows.filter((r) => r.takenAt >= start && r.takenAt < end);
    const byClass: Partial<Record<MdroClass, number>> = {};
    let mdro = 0;
    for (const row of inWeek) {
      const a = classifyIsolate(row);
      if (a.phenotypes.length > 0) {
        mdro += 1;
        for (const p of a.phenotypes) byClass[p] = (byClass[p] ?? 0) + 1;
      }
    }
    out.push({
      week: new Date(start).toISOString().slice(0, 10),
      isolates: inWeek.length,
      mdro,
      byClass,
    });
  }
  return out;
}

export function mdroByWard(rows: DetIsolate[]): MdroWardRow[] {
  const byWard = new Map<string, DetIsolate[]>();
  for (const row of rows) {
    const list = byWard.get(row.ward);
    if (list) list.push(row);
    else byWard.set(row.ward, [row]);
  }
  const out: MdroWardRow[] = [];
  for (const [ward, wardRows] of byWard) {
    const byClass: Partial<Record<MdroClass, number>> = {};
    let mdroCount = 0;
    for (const row of wardRows) {
      const a = classifyIsolate(row);
      if (a.phenotypes.length > 0) {
        mdroCount += 1;
        for (const p of a.phenotypes) byClass[p] = (byClass[p] ?? 0) + 1;
      }
    }
    out.push({
      ward,
      isolates: wardRows.length,
      mdroCount,
      mdroPct: wardRows.length > 0 ? Math.round((mdroCount / wardRows.length) * 1000) / 10 : null,
      byClass,
    });
  }
  return out.sort((a, b) => (b.mdroPct ?? 0) - (a.mdroPct ?? 0) || b.isolates - a.isolates);
}

export function recentMdro(rows: DetIsolate[], limit = 12): MdroRecentIsolate[] {
  const withPheno = rows
    .map((row) => ({ row, a: classifyIsolate(row) }))
    .filter((x) => x.a.phenotypes.length > 0)
    .sort((x, y) => y.row.takenAt - x.row.takenAt)
    .slice(0, limit);
  return withPheno.map(({ row, a }) => ({
    isolateId: row.id,
    date: new Date(row.takenAt).toISOString(),
    ward: row.ward,
    sampleType: row.sampleType,
    organism: row.organism,
    phenotypes: a.phenotypes,
    resistant: Object.entries(row.results)
      .filter(([, res]) => res === "R")
      .map(([ab]) => ab),
  }));
}

function weekFloor(t: number): number {
  const d = new Date(t);
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = (d.getUTCDay() + 6) % 7;
  return utc - dow * DAY_MS;
}

// ── D4: rare-event CUSUM on weekly MDRO counts per (ward, phenotype) ──

export interface MdroCusumFlag {
  ward: string;
  phenotype: MdroClass;
  /** organisms contributing to the flagged cell-week */
  organisms: string[];
  week: string;
  count: number;
  expected: number;
  cusum: number;
}

/** CUSUM over weekly warning-phenotype counts per (ward, phenotype): the
 *  MDRO surveillance detector. Rare cells (μ ~0.2/week) need a lower
 *  baseline floor and a 1σ allowance; h is still budget-tuned. */
export function mdroCusumScan(rows: DetIsolate[], config: DetectionConfig): MdroCusumFlag[] {
  const expanded: DetIsolate[] = [];
  const phenotypeOf = new Map<DetIsolate, MdroClass>();
  for (const row of rows) {
    for (const p of classifyIsolate(row).phenotypes) {
      const clone: DetIsolate = { ...row };
      phenotypeOf.set(clone, p);
      expanded.push(clone);
    }
  }
  const flags = cusumScan(
    expanded,
    // h=4 with allowance 0.3 + 1·μ: elevated weeks (2-4 MDRO isolates vs a
    // trailing mean of 0.3-0.6) accumulate ~1-2/week → h crossed in ~4 weeks
    // of a genuine ramp, while isolated singletons on quiet cells reset.
    // FA ≈ 0 on clean data (harness breakdown); fixed maximum sensitivity.
    { ...config, cusumH: 4, minBaselineMean: 0.05, kCount: 0.3, kCountScale: 1, cusumSdFloor: 0.3 },
    (row) => `${row.ward}|MDRO:${phenotypeOf.get(row) ?? "?"}`,
  );
  return flags.map((f) => {
    const weekT = new Date(f.week).getTime();
    const organisms = [
      ...new Set(
        expanded
          .filter(
            (row) =>
              phenotypeOf.get(row) === f.cell.split("MDRO:")[1] &&
              row.ward === f.ward &&
              weekStart(row.takenAt) === weekT,
          )
          .map((row) => row.organism),
      ),
    ];
    const phenotype = f.cell.split("MDRO:")[1] as MdroClass;
    return {
      ward: f.ward,
      phenotype,
      organisms,
      week: f.week,
      count: f.count,
      expected: f.expected,
      cusum: f.cusum,
    };
  });
}
