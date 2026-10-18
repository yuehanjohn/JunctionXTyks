/**
 * AEI seed: synthetic microbiology dataset generator + CSV importer.
 *
 * Flow: if ./data/*.csv exist, import them (drop-in path for the real
 * challenge dataset). Otherwise generate a schema-faithful synthetic
 * dataset (~10,000 patients, ~47,000 cultures over 3 years, 9 wards),
 * write it to ./data/*.csv, then import.
 *
 * CSV columns (lowercase, matching the challenge join keys):
 *   patients.csv          patient_id,sex,birth_year
 *   cultures.csv          culture_id,patient_id,sample_type,ward,taken_at
 *   isolates.csv          isolate_id,culture_id,organism
 *   susceptibilities.csv  susceptibility_id,isolate_id,antibiotic,result
 *
 * Result encoding: S | R (fully susceptible vs resistant; no intermediate).
 */
import { PrismaClient } from "@prisma/client";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const db = new PrismaClient();
const DATA_DIR = join(process.cwd(), "data");
const rng = mulberry32(42);

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLE_TYPES = ["urine", "blood", "wound"] as const;
const SAMPLE_WEIGHTS: Record<string, number> = { urine: 0.68, blood: 0.12, wound: 0.2 };

const WARDS = [
  { name: "ICU", weight: 0.08, factor: 0.94 },
  { name: "Emergency Department", weight: 0.14, factor: 1.0 },
  { name: "Internal Medicine A", weight: 0.14, factor: 0.98 },
  { name: "Internal Medicine B", weight: 0.12, factor: 0.98 },
  { name: "General Surgery", weight: 0.12, factor: 0.97 },
  { name: "Infectious Diseases Ward", weight: 0.1, factor: 0.96 },
  { name: "Long-term Care Facility", weight: 0.1, factor: 0.93 },
  { name: "Health Centre West", weight: 0.11, factor: 1.02 },
  { name: "Health Centre East", weight: 0.09, factor: 1.0 },
];

type Panel = [organism: string, antibiotics: [string, number][]][];

const PANELS: Record<string, Panel> = {
  urine: [
    ["Escherichia coli", [["Nitrofurantoin", 0.88], ["Pivmecillinam", 0.84], ["Trimethoprim", 0.72], ["Ciprofloxacin", 0.78], ["Cefuroxime", 0.82], ["Gentamicin", 0.9], ["Meropenem", 0.99]]],
    ["Klebsiella pneumoniae", [["Cefuroxime", 0.74], ["Ciprofloxacin", 0.8], ["Gentamicin", 0.88], ["Meropenem", 0.98], ["Trimethoprim", 0.66]]],
    ["Enterococcus faecalis", [["Ampicillin", 0.95], ["Vancomycin", 0.99], ["Nitrofurantoin", 0.92]]],
    ["Proteus mirabilis", [["Ampicillin", 0.72], ["Cefuroxime", 0.88], ["Ciprofloxacin", 0.84], ["Gentamicin", 0.9], ["Meropenem", 0.99]]],
    ["Pseudomonas aeruginosa", [["Ciprofloxacin", 0.8], ["Meropenem", 0.88], ["Gentamicin", 0.88]]],
    ["Enterococcus faecium", [["Ampicillin", 0.35], ["Vancomycin", 0.96], ["Nitrofurantoin", 0.6]]],
  ],
  blood: [
    ["Escherichia coli", [["Ciprofloxacin", 0.78], ["Cefuroxime", 0.82], ["Gentamicin", 0.9], ["Meropenem", 0.99]]],
    ["Staphylococcus aureus", [["Cefoxitin (methicillin)", 0.86], ["Penicillin", 0.18], ["Clindamycin", 0.84], ["Vancomycin", 1.0], ["Rifampicin", 0.92]]],
    ["Coagulase-negative staphylococci", [["Cefoxitin (methicillin)", 0.68], ["Vancomycin", 1.0], ["Rifampicin", 0.88]]],
    ["Klebsiella pneumoniae", [["Cefuroxime", 0.74], ["Ciprofloxacin", 0.8], ["Meropenem", 0.98]]],
    ["Streptococcus agalactiae", [["Penicillin", 0.99], ["Erythromycin", 0.78], ["Clindamycin", 0.84]]],
    ["Enterococcus faecium", [["Ampicillin", 0.35], ["Vancomycin", 0.96]]],
  ],
  wound: [
    ["Staphylococcus aureus", [["Cefoxitin (methicillin)", 0.86], ["Penicillin", 0.18], ["Clindamycin", 0.84], ["Fusidic acid", 0.88], ["Rifampicin", 0.92]]],
    ["Escherichia coli", [["Ciprofloxacin", 0.78], ["Cefuroxime", 0.82], ["Gentamicin", 0.9]]],
    ["Pseudomonas aeruginosa", [["Piperacillin-tazobactam", 0.84], ["Ceftazidime", 0.82], ["Ciprofloxacin", 0.8], ["Meropenem", 0.88]]],
    ["Streptococcus pyogenes", [["Penicillin", 0.99], ["Erythromycin", 0.85], ["Clindamycin", 0.9]]],
    ["Enterobacter cloacae", [["Cefuroxime", 0.3], ["Ciprofloxacin", 0.84], ["Gentamicin", 0.88], ["Meropenem", 0.96]]],
    ["Proteus mirabilis", [["Ampicillin", 0.72], ["Cefuroxime", 0.88], ["Ciprofloxacin", 0.84]]],
  ],
};

/** Weighted organism mix per sample type (aligned with PANELS arrays). */
const ORG_WEIGHTS: Record<string, number[]> = {
  urine: [0.58, 0.13, 0.1, 0.07, 0.05, 0.07],
  blood: [0.3, 0.26, 0.16, 0.11, 0.09, 0.08],
  wound: [0.38, 0.14, 0.14, 0.12, 0.11, 0.11],
};

/** Injected anomalies so the signal detector has real deviations to find. */
const ANOMALIES: {
  ward: string;
  organism: string;
  antibiotic: string;
  daysBack: number;
  overrideS: number;
}[] = [
  { ward: "ICU", organism: "Escherichia coli", antibiotic: "Ciprofloxacin", daysBack: 28, overrideS: 0.45 },
  { ward: "Long-term Care Facility", organism: "Staphylococcus aureus", antibiotic: "Cefoxitin (methicillin)", daysBack: 42, overrideS: 0.55 },
  { ward: "General Surgery", organism: "Klebsiella pneumoniae", antibiotic: "Meropenem", daysBack: 21, overrideS: 0.86 },
  { ward: "Health Centre East", organism: "Escherichia coli", antibiotic: "Nitrofurantoin", daysBack: 28, overrideS: 0.7 },
];

function pick<T>(weights: number[], items: T[]): T {
  const r = rng();
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (r < acc) return items[i];
  }
  return items[items.length - 1];
}

function csvEscape(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function generate() {
  const now = new Date();
  const start = new Date(now);
  start.setFullYear(start.getFullYear() - 3);
  const spanMs = now.getTime() - start.getTime();

  mkdirSync(DATA_DIR, { recursive: true });

  const patients: string[] = ["patient_id,sex,birth_year"];
  for (let i = 1; i <= 10000; i++) {
    const sex = rng() < 0.55 ? "F" : "M";
    const birthYear = 1930 + Math.floor(rng() * 76);
    patients.push(`P${String(i).padStart(6, "0")},${sex},${birthYear}`);
  }

  const cultures: string[] = ["culture_id,patient_id,sample_type,ward,taken_at"];
  const isolates: string[] = ["isolate_id,culture_id,organism"];
  const sus: string[] = ["susceptibility_id,isolate_id,antibiotic,result"];

  let c = 0, iso = 0, s = 0;
  const wardItems = WARDS.map((w) => w.name);
  const wardWeights = WARDS.map((w) => w.weight);

  for (let i = 0; i < 47000; i++) {
    const patient = `P${String(1 + Math.floor(rng() * 10000)).padStart(6, "0")}`;
    const ward = pick(wardWeights, wardItems);
    const wardDef = WARDS.find((w) => w.name === ward)!;
    const sampleType = pick([SAMPLE_WEIGHTS.urine, SAMPLE_WEIGHTS.blood, SAMPLE_WEIGHTS.wound], [...SAMPLE_TYPES]);
    const takenAt = new Date(start.getTime() + rng() * spanMs);
    const cid = `C${String(++c).padStart(6, "0")}`;
    cultures.push(`${cid},${patient},${sampleType},${csvEscape(ward)},${takenAt.toISOString()}`);

    const panel = PANELS[sampleType];
    const organism = pick(ORG_WEIGHTS[sampleType], panel.map((p) => p[0]));
    const iid = `I${String(++iso).padStart(6, "0")}`;
    isolates.push(`${iid},${cid},${csvEscape(organism)}`);

    const antibiotics = panel.find((p) => p[0] === organism)![1];
    const daysBack = (now.getTime() - takenAt.getTime()) / 86400000;
    for (const [ab, baseS] of antibiotics) {
      let p = baseS * wardDef.factor;
      // mild seasonal drift
      p += 0.02 * Math.sin((takenAt.getTime() / spanMs) * Math.PI * 6);
      // slow improvement over time
      p += 0.015 * (1 - daysBack / 1095);
      for (const a of ANOMALIES) {
        if (a.ward === ward && a.organism === organism && a.antibiotic === ab && daysBack <= a.daysBack) {
          p = a.overrideS;
          break;
        }
      }
      p = Math.min(0.995, Math.max(0.02, p));
      const result = rng() < p ? "S" : "R";
      sus.push(`S${String(++s).padStart(7, "0")},${iid},${csvEscape(ab)},${result}`);
    }
  }

  writeFileSync(join(DATA_DIR, "patients.csv"), patients.join("\n"));
  writeFileSync(join(DATA_DIR, "cultures.csv"), cultures.join("\n"));
  writeFileSync(join(DATA_DIR, "isolates.csv"), isolates.join("\n"));
  writeFileSync(join(DATA_DIR, "susceptibilities.csv"), sus.join("\n"));
  console.log(`generated: ${c} cultures, ${iso} isolates, ${s} susceptibilities`);
}

async function importCsv() {
  const readLines = (name: string) =>
    readFileSync(join(DATA_DIR, name), "utf8").split("\n").slice(1).filter(Boolean);

  const pats = readLines("patients.csv");
  const culs = readLines("cultures.csv");
  const isos = readLines("isolates.csv");
  const suss = readLines("susceptibilities.csv");

  const chunk = <T>(arr: T[], n: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };

  const patientRows = pats.map((l) => {
    const [id, sex, by] = l.split(",");
    return { id, sex, birthYear: parseInt(by, 10) };
  });
  for (const ch of chunk(patientRows, 5000)) await db.patient.createMany({ data: ch });

  const cultureRows = culs.map((l) => {
    const [cid, pid, st, ward, takenAt] = l.split(",");
    const m = ward.match(/^"(.*)"$/) || [null, ward];
    return { id: cid, patientId: pid, sampleType: st, ward: m[1] ?? ward, takenAt: new Date(takenAt) };
  });
  for (const ch of chunk(cultureRows, 5000)) await db.culture.createMany({ data: ch });

  const isolateRows = isos.map((l) => {
    const [iid, cid, org] = l.split(",");
    const m = org.match(/^"(.*)"$/) || [null, org];
    return { id: iid, cultureId: cid, organism: m[1] ?? org };
  });
  for (const ch of chunk(isolateRows, 5000)) await db.isolate.createMany({ data: ch });

  const susRows = suss.map((l) => {
    const [sid, iid, ab, res] = l.split(",");
    const m = ab.match(/^"(.*)"$/) || [null, ab];
    return { id: sid, isolateId: iid, antibiotic: m[1] ?? ab, result: res };
  });
  for (const ch of chunk(susRows, 5000)) await db.susceptibility.createMany({ data: ch });

  console.log(`imported: ${patientRows.length} patients, ${cultureRows.length} cultures, ${isolateRows.length} isolates, ${susRows.length} susceptibilities`);
}

async function main() {
  // Idempotent: clear existing rows (child → parent FK order) so the seed can
  // run repeatedly (e.g. on every build) without duplicating data.
  await db.susceptibility.deleteMany();
  await db.isolate.deleteMany();
  await db.culture.deleteMany();
  await db.patient.deleteMany();

  const hasCsv = existsSync(join(DATA_DIR, "patients.csv"));
  if (!hasCsv) {
    console.log("no CSVs in ./data — generating synthetic dataset");
    generate();
  } else {
    console.log("found CSVs in ./data — importing as-is (swap path for real dataset)");
  }
  await importCsv();
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
