import { describe, expect, it } from "vitest";

import {
  firstIsolates,
  round1,
  tallySusceptibilities,
  twoProportionZ,
  wilsonPct,
  windowRange,
} from "@/lib/stats";
import { normalTwoSidedP, benjaminiHochberg } from "@/lib/pulse";
import { toneForR } from "@/lib/types";
import type { IsoRec, SusRec } from "@/lib/stats";

function iso(id: string, patientId: string, organism: string, takenAt: string, ward = "ICU"): IsoRec {
  return { id, patientId, organism, ward, sampleType: "urine", takenAt: new Date(takenAt) };
}

describe("round1", () => {
  it("rounds to one decimal", () => {
    expect(round1(12.34)).toBe(12.3);
    expect(round1(12.36)).toBe(12.4);
    expect(round1(1.25)).toBe(1.3);
    expect(round1(-1.24)).toBe(-1.2);
    expect(round1(0)).toBe(0);
  });
});

describe("wilsonPct", () => {
  it("returns an empty interval for n=0", () => {
    expect(wilsonPct(0, 0)).toEqual({ lo: 0, hi: 0 });
  });

  it("matches the known Wilson interval for 50/100", () => {
    const { lo, hi } = wilsonPct(50, 100);
    expect(lo).toBeCloseTo(40.4, 1);
    expect(hi).toBeCloseTo(59.6, 1);
  });

  it("is conservative at the extremes: 1/1 never claims certainty downward", () => {
    const { lo, hi } = wilsonPct(1, 1);
    expect(lo).toBeGreaterThan(15);
    expect(lo).toBeLessThan(25);
    expect(hi).toBeLessThanOrEqual(100);
  });

  it("stays within [0, 100] for extreme proportions", () => {
    expect(wilsonPct(0, 30).lo).toBe(0);
    expect(wilsonPct(30, 30).hi).toBeLessThanOrEqual(100);
  });
});

describe("twoProportionZ", () => {
  it("returns 0 for identical proportions", () => {
    expect(twoProportionZ(50, 100, 50, 100)).toBe(0);
  });

  it("returns 0 when either group is empty", () => {
    expect(twoProportionZ(10, 0, 5, 100)).toBe(0);
    expect(twoProportionZ(10, 100, 5, 0)).toBe(0);
  });

  it("is negative when the window proportion drops", () => {
    expect(twoProportionZ(25, 100, 50, 100)).toBeLessThan(0);
  });

  it("matches the hand-computed z for 50% vs 25% at n=100", () => {
    // pooled = 0.375, SE = sqrt(0.375·0.625·(1/100+1/100)) ≈ 0.06849
    expect(twoProportionZ(50, 100, 25, 100)).toBeCloseTo(3.651, 2);
    expect(twoProportionZ(25, 100, 50, 100)).toBeCloseTo(-3.651, 2);
  });
});

describe("normalTwoSidedP", () => {
  it("gives p=1 at z=0", () => {
    expect(normalTwoSidedP(0)).toBeCloseTo(1, 6);
  });

  it("reproduces the standard normal table at z=±1.96", () => {
    expect(normalTwoSidedP(1.96)).toBeCloseTo(0.05, 2);
    expect(normalTwoSidedP(-1.96)).toBeCloseTo(0.05, 2);
  });

  it("decays monotonically with |z| and reaches tiny values for strong signals", () => {
    const p3 = normalTwoSidedP(3);
    const p5 = normalTwoSidedP(5);
    const p7 = normalTwoSidedP(7);
    expect(p3).toBeGreaterThan(p5);
    expect(p5).toBeGreaterThan(p7);
    expect(p7).toBeLessThan(1e-10);
  });

  it("never leaves [0, 1]", () => {
    for (const z of [-20, -8, -2, 0, 2, 8, 20]) {
      const p = normalTwoSidedP(z);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

describe("benjaminiHochberg", () => {
  it("passes raw values through for a single test", () => {
    expect(benjaminiHochberg([0.03])).toEqual([0.03]);
  });

  it("matches the hand-computed BH step-up for three tests", () => {
    // p = [0.01, 0.04, 0.03], m=3; sorted 0.01, 0.03, 0.04 →
    // adj_(3) = 0.04·3/3 = 0.04; adj_(2) = min(0.04, 0.03·3/2=0.045) = 0.04;
    // adj_(1) = min(0.04, 0.01·3/1 = 0.03) = 0.03.
    const adj = benjaminiHochberg([0.01, 0.04, 0.03]);
    expect(adj[0]).toBeCloseTo(0.03, 4);
    expect(adj[1]).toBeCloseTo(0.04, 4);
    expect(adj[2]).toBeCloseTo(0.04, 4);
  });

  it("is monotone in p and caps at 1", () => {
    const ps = [0.9, 0.4, 0.6, 0.2, 0.75, 0.55];
    const adj = benjaminiHochberg(ps);
    for (const a of adj) {
      expect(a).toBeLessThanOrEqual(1);
      expect(a).toBeGreaterThanOrEqual(0);
    }
    const byP = ps.map((p, i) => ({ p, a: adj[i]! })).sort((x, y) => x.p - y.p);
    for (let i = 1; i < byP.length; i++) {
      expect(byP[i]!.a).toBeGreaterThanOrEqual(byP[i - 1]!.a! - 1e-9);
    }
  });

  it("is identity at m=1 and preserves input order", () => {
    expect(benjaminiHochberg([0.5, 0.1, 0.5])).toEqual([0.5, 0.3, 0.5]);
  });
});

describe("toneForR", () => {
  it("never colors cells below the minimum isolate count", () => {
    expect(toneForR(80, 29)).toBe("insufficient");
    expect(toneForR(0, 29)).toBe("insufficient");
  });

  it("bands by susceptibility: 15% resistant is never green", () => {
    expect(toneForR(5, 100)).toBe("good"); // 95% S
    expect(toneForR(10, 100)).toBe("good"); // exactly 90% S
    expect(toneForR(15, 100)).toBe("elevated"); // 85% S
    expect(toneForR(30, 100)).toBe("elevated"); // exactly 70% S
    expect(toneForR(35, 100)).toBe("poor"); // 65% S
  });

  it("escalates one band on a ≥10 pp rise vs baseline", () => {
    expect(toneForR(15, 100, 3)).toBe("poor"); // 85% S, but 3% → 15% is a real deterioration
    expect(toneForR(12, 100, 0)).toBe("poor"); // elevated escalates to poor on a 12 pp rise
    expect(toneForR(10, 100, 0)).toBe("elevated"); // exactly 90% S: good escalates to elevated
    expect(toneForR(50, 100, 45)).toBe("poor"); // already poor, stays poor
  });

  it("does not escalate on small baseline moves", () => {
    expect(toneForR(15, 100, 8)).toBe("elevated"); // 7 pp rise: band stands
    expect(toneForR(5, 100, 2)).toBe("good"); // 3 pp rise
  });

  it("treats a missing baseline as band-only", () => {
    expect(toneForR(15, 100, null)).toBe("elevated");
    expect(toneForR(35, 100, null)).toBe("poor");
  });

  it("escalates last-line agents: ≥5% R on a carbapenem is never good, ≥25% is poor", () => {
    // ECDC describes carbapenem resistance below 5% as "low" — 8% meropenem-R
    // must not read as good, unlike the same level on a first-line drug.
    expect(toneForR(8, 100, null, "Meropenem")).toBe("elevated");
    expect(toneForR(8, 100, null, "Ciprofloxacin")).toBe("good");
    expect(toneForR(4, 100, null, "Meropenem")).toBe("good"); // below the low bound
    expect(toneForR(30, 100, null, "Meropenem")).toBe("poor"); // ≥25% R always poor
    expect(toneForR(15, 100, null, "Meropenem")).toBe("elevated"); // 5–25%: escalates only from good
    expect(toneForR(15, 100, 2, "Meropenem")).toBe("poor"); // baseline escalation still applies
    expect(toneForR(5, 100, null, "Pivmecillinam")).toBe("good"); // name must match, not substring-fuzzy
  });
});

describe("firstIsolates", () => {
  it("keeps only the earliest isolate per (patient, organism)", () => {
    const first = firstIsolates([
      iso("I2", "P1", "Escherichia coli", "2025-01-10"),
      iso("I1", "P1", "Escherichia coli", "2025-01-05"),
      iso("I3", "P1", "Escherichia coli", "2025-01-20"),
    ]);
    expect(first.map((i) => i.id)).toEqual(["I1"]);
  });

  it("breaks takenAt ties by isolate id", () => {
    const first = firstIsolates([
      iso("I9", "P1", "Escherichia coli", "2025-01-05"),
      iso("I4", "P1", "Escherichia coli", "2025-01-05"),
    ]);
    expect(first.map((i) => i.id)).toEqual(["I4"]);
  });

  it("keeps separate organisms and separate patients", () => {
    const first = firstIsolates([
      iso("I1", "P1", "Escherichia coli", "2025-01-05"),
      iso("I2", "P1", "Klebsiella pneumoniae", "2025-01-06"),
      iso("I3", "P2", "Escherichia coli", "2025-01-07"),
    ]);
    expect(first).toHaveLength(3);
  });
});

describe("tallySusceptibilities", () => {
  const ids = new Set(["I1", "I2"]);
  const rows: SusRec[] = [
    { isolateId: "I1", organism: "Escherichia coli", antibiotic: "Ciprofloxacin", result: "S" },
    { isolateId: "I1", organism: "Escherichia coli", antibiotic: "Amoxicillin", result: "R" },
    { isolateId: "I1", organism: "Escherichia coli", antibiotic: "Meropenem", result: "I" }, // ignored
    { isolateId: "I2", organism: "Escherichia coli", antibiotic: "Ciprofloxacin", result: "R" },
    { isolateId: "I9", organism: "Escherichia coli", antibiotic: "Ciprofloxacin", result: "S" }, // outside ids
  ];

  it("counts S/R per (organism, antibiotic) and ignores I and non-selected isolates", () => {
    const tally = tallySusceptibilities(rows, ids);
    const ecoli = tally.get("Escherichia coli")!;
    expect(ecoli.get("Ciprofloxacin")).toEqual({ s: 1, r: 1 });
    expect(ecoli.get("Amoxicillin")).toEqual({ s: 0, r: 1 });
    expect(ecoli.has("Meropenem")).toBe(false);
  });
});

describe("windowRange", () => {
  const dataMax = new Date("2026-10-16T16:59:08.323Z");

  it("anchors the 4-week window at the newest sample", () => {
    const { start, end } = windowRange("4w", dataMax);
    expect(end.getTime()).toBe(dataMax.getTime());
    expect(start.getTime()).toBe(dataMax.getTime() - 28 * 86_400_000);
  });

  it("anchors the 1y window at Jan 1 UTC of the anchor year", () => {
    const { start, end } = windowRange("1y", dataMax);
    expect(end.getTime()).toBe(dataMax.getTime());
    expect(start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("clamps an earlier asOf replay anchor and shifts the window", () => {
    const asOf = "2025-06-15T00:00:00.000Z";
    const { start, end } = windowRange("4w", dataMax, asOf);
    expect(end.toISOString()).toBe(asOf);
    expect(start.getTime()).toBe(new Date(asOf).getTime() - 28 * 86_400_000);
  });

  it("ignores an asOf later than the newest sample", () => {
    const { end } = windowRange("4w", dataMax, "2027-01-01T00:00:00.000Z");
    expect(end.getTime()).toBe(dataMax.getTime());
  });

  it("ignores an invalid asOf", () => {
    const { end } = windowRange("4w", dataMax, "not-a-date");
    expect(end.getTime()).toBe(dataMax.getTime());
  });

  it("falls back to now when there is no data", () => {
    const before = Date.now();
    const { end } = windowRange("4w", null);
    expect(end.getTime()).toBeGreaterThanOrEqual(before);
  });
});
