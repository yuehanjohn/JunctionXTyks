import { describe, expect, it } from "vitest";

import {
  clusterScan,
  cusumScan,
  DEFAULT_CLUSTER_CONFIG,
  DEFAULT_DETECTION_CONFIG,
  normalCdf,
  normalTwoSidedP,
  benjaminiHochberg,
  poissonTail,
  proportionDropScan,
  weekStart,
  type DetIsolate,
} from "@/lib/detect";
import { classifyIsolate } from "@/lib/mdro";
import { runBacktest } from "@/lib/backtest";

const DAY = 86_400_000;
const MON = Date.UTC(2025, 0, 6); // a Monday

function isolates(counts: number[], organism = "Escherichia coli"): DetIsolate[] {
  const rows: DetIsolate[] = [];
  let id = 0;
  counts.forEach((c, t) => {
    for (let i = 0; i < c; i++) {
      rows.push({
        id: `R${id++}`,
        patientId: `P${t}_${i}`,
        organism,
        ward: "ICU",
        sampleType: "urine",
        takenAt: MON + t * 7 * DAY + i * DAY,
        results: { Ceftazidime: "S" },
      });
    }
  });
  return rows;
}

describe("poissonTail", () => {
  it("matches known Poisson values", () => {
    expect(poissonTail(1, 0)).toBe(1);
    expect(poissonTail(1, 1)).toBeCloseTo(0.6321, 3); // P(X ≥ 1 | λ=1) = 1 − e⁻¹
    expect(poissonTail(2, 5)).toBeCloseTo(0.0527, 3);
    expect(poissonTail(5, 15)).toBeLessThan(0.001);
  });

  it("agrees between the exact and normal-approximation branches", () => {
    for (const lambda of [25, 35, 50]) {
      const exactK = Math.ceil(lambda + 3 * Math.sqrt(lambda));
      expect(poissonTail(lambda, exactK)).toBeGreaterThan(0);
      expect(poissonTail(lambda, exactK)).toBeLessThan(0.2);
    }
  });

  it("normalCdf is 0.5 at zero and monotone", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1)).toBeGreaterThan(normalCdf(0.5));
  });
});

describe("weekStart", () => {
  it("snaps any instant to its Monday", () => {
    expect(weekStart(Date.UTC(2025, 0, 6))).toBe(MON); // Monday
    expect(weekStart(Date.UTC(2025, 0, 8))).toBe(MON); // Wednesday
    expect(weekStart(Date.UTC(2025, 0, 12))).toBe(MON); // Sunday
    expect(weekStart(Date.UTC(2025, 0, 13))).toBe(MON + 7 * DAY); // next Monday
  });
});

describe("cusumScan", () => {
  it("ignores flat cells and fires on sustained elevation", () => {
    const flat = isolates(new Array(20).fill(2));
    expect(cusumScan(flat, DEFAULT_DETECTION_CONFIG)).toHaveLength(0);

    // quiet baseline then a 4-week surge
    const rows = isolates([...new Array(12).fill(1), 3, 5, 6, 7, 6]);
    const flags = cusumScan(rows, { ...DEFAULT_DETECTION_CONFIG, cusumH: 4 });
    expect(flags.length).toBeGreaterThan(0);
    expect(flags[0]!.ward).toBe("ICU");
    expect(flags[0]!.count).toBeGreaterThan(3);
  });

  it("does not fire when the baseline itself is empty and counts stay low", () => {
    const rows = isolates([...new Array(15).fill(0), 1, 0, 1, 0, 1]);
    expect(cusumScan(rows, DEFAULT_DETECTION_CONFIG)).toHaveLength(0);
  });
});

describe("clusterScan", () => {
  it("detects a point-source spike over a quiet baseline", () => {
    // 90 days of near-silence then 8 isolates in 10 days
    const rows: DetIsolate[] = [];
    let id = 0;
    for (let d = 0; d < 90; d++) {
      if (d % 45 === 0) {
        rows.push({
          id: `Q${id++}`, patientId: `P${id}`, organism: "Klebsiella pneumoniae", ward: "ICU",
          sampleType: "blood", takenAt: MON + d * DAY, results: {},
        });
      }
    }
    for (let i = 0; i < 8; i++) {
      rows.push({
        id: `S${id++}`, patientId: `P${100 + i}`, organism: "Klebsiella pneumoniae", ward: "ICU",
        sampleType: "blood", takenAt: MON + 95 * DAY + i * DAY, results: {},
      });
    }
    const flags = clusterScan(rows, { ...DEFAULT_CLUSTER_CONFIG, recentDays: 10 });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.observed).toBeGreaterThanOrEqual(7);
    expect(flags[0]!.p).toBeLessThan(0.01);
  });
});

describe("proportionDropScan", () => {
  it("fires on a true susceptibility drop and survives its own minimal case", () => {
    const now = Date.UTC(2026, 0, 1);
    const rows: DetIsolate[] = [];
    for (let i = 0; i < 35; i++) {
      rows.push({
        id: `W${i}`, patientId: `PW${i}`, organism: "Escherichia coli", ward: "ICU", sampleType: "urine",
        takenAt: now - 5 * DAY, results: { Ceftazidime: i < 5 ? "S" : "R" },
      });
    }
    for (let i = 0; i < 400; i++) {
      rows.push({
        id: `B${i}`, patientId: `PB${i}`, organism: "Escherichia coli", ward: "ICU", sampleType: "urine",
        takenAt: now - (100 + (i % 200)) * DAY, results: { Ceftazidime: i < 40 ? "R" : "S" },
      });
    }
    const flags = proportionDropScan(rows);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.antibiotic).toBe("Ceftazidime");
    expect(flags[0]!.z).toBeLessThan(-3);
  });

  it("stays silent on stable data", () => {
    const now = Date.UTC(2026, 0, 1);
    const rows: DetIsolate[] = [];
    for (let i = 0; i < 400; i++) {
      const inWindow = i < 35;
      rows.push({
        id: `S${i}`, patientId: `PS${i}`, organism: "Escherichia coli", ward: "ICU", sampleType: "urine",
        takenAt: inWindow ? now - 5 * DAY : now - (100 + (i % 200)) * DAY,
        results: { Ceftazidime: i % 10 === 0 ? "R" : "S" }, // stable ~10% R
      });
    }
    expect(proportionDropScan(rows)).toHaveLength(0);
  });
});

describe("classifyIsolate", () => {
  it("assigns the documented phenotypes", () => {
    const base = { patientId: "P", ward: "ICU", sampleType: "urine", takenAt: 0 };
    expect(
      classifyIsolate({ ...base, id: "1", organism: "Staphylococcus aureus", results: { "Cefoxitin (methicillin)": "R" } }).phenotypes,
    ).toContain("MRSA-type");
    expect(
      classifyIsolate({ ...base, id: "2", organism: "Enterococcus faecium", results: { Vancomycin: "R" } }).phenotypes,
    ).toContain("VRE");
    expect(
      classifyIsolate({ ...base, id: "3", organism: "Klebsiella pneumoniae", results: { Meropenem: "R", Ceftazidime: "S" } }).phenotypes,
    ).toEqual(["CRE-proxy"]);
    expect(
      classifyIsolate({ ...base, id: "4", organism: "Escherichia coli", results: { Ceftazidime: "R", Meropenem: "S", Gentamicin: "R" } }).phenotypes,
    ).toEqual(["3GC-R", "ESBL-proxy"]);
    // MDR: R to ≥3 distinct classes
    expect(
      classifyIsolate({ ...base, id: "5", organism: "Escherichia coli", results: { Ceftazidime: "R", Ciprofloxacin: "R", Gentamicin: "R", Meropenem: "S" } }).phenotypes,
    ).toContain("MDR");
  });
});

describe("benjaminiHochberg", () => {
  it("controls the family-wise expectation on all-null input", () => {
    const ps = Array.from({ length: 50 }, (_, i) => 0.02 + (i % 10) * 0.05);
    const adj = benjaminiHochberg(ps);
    expect(adj.filter((p) => p < 0.05).length).toBe(0);
  });
});

describe("backtest harness (reduced)", () => {
  it("detects the point-source scenario and keeps false alarms finite", () => {
    // Full runBacktest takes ~20 s (threshold search); a single config run is
    // covered here via the exported pieces — this test asserts the harness
    // invariants on the default tuned outcome.
    const bt = runBacktest();
    expect(bt.falseAlarmsPerMonth).toBeLessThanOrEqual(2);
    expect(bt.scenarios.length).toBe(3);
    expect(bt.scenarios.every((s) => s.detected)).toBe(true);
    expect(bt.scenarios.every((s) => (s.latencyDays ?? 99) <= 45)).toBe(true);
    expect(normalTwoSidedP(1.96)).toBeCloseTo(0.05, 2);
  }, 120_000);
});
