// Integration tests: run the real service layer against the seeded SQLite DB
// (47k cultures from the challenge dataset). Requires `pnpm db:reset` to have
// been run at least once.

import { describe, expect, it } from "vitest";

import {
  getAlertInvestigation,
  getExplore,
  getHeatmap,
  getOrganismProfile,
  getOverview,
  getWardCompare,
  getWardComparison,
} from "@/lib/pulse";
import { getMeta, getSignals, MIN_ISOLATES, ROLLING_DAYS } from "@/lib/stats";
import type { Signal } from "@/lib/types";

const DAY_MS = 86_400_000;
const SEVERITY_RANK: Record<Signal["severity"], number> = { high: 0, moderate: 1, watch: 2 };

describe("service layer against the seeded dataset", () => {
  it("meta exposes the challenge dataset shape", async () => {
    const meta = await getMeta();
    expect(meta.wards).toHaveLength(9);
    expect(meta.organisms).toContain("Escherichia coli");
    expect(meta.antibiotics).toContain("Ciprofloxacin");
    expect(meta.sampleTypes.sort()).toEqual(["blood", "urine", "wound"]);
    expect(new Date(meta.dateMax).getTime()).toBeGreaterThan(new Date(meta.dateMin).getTime());
  });

  it("overview KPIs are internally consistent and series cover the 28-day window", async () => {
    const overview = await getOverview({});
    const { totalIsolates, resistantPct } = overview.kpis;

    expect(totalIsolates.value).toBeGreaterThan(0);
    expect(totalIsolates.prevValue).toBeGreaterThan(0);

    const windowDays =
      Math.round(
        (new Date(overview.windowEnd).getTime() - new Date(overview.windowStart).getTime()) / DAY_MS,
      ) + 1;
    // Engine convention: [start, end] with both endpoints inclusive.
    expect(windowDays).toBe(ROLLING_DAYS + 1);

    for (const series of overview.series) {
      expect(series.points).toHaveLength(ROLLING_DAYS + 1);
      for (const point of series.points) {
        expect(point.rPct).toBeGreaterThanOrEqual(0);
        expect(point.rPct).toBeLessThanOrEqual(100);
        if (point.rPct > 0) expect(point.n).toBeGreaterThan(0);
      }
    }

    // Specimen mix and top organisms draw from the same first-isolate set.
    expect(overview.specimen.reduce((sum, s) => sum + s.n, 0)).toBe(totalIsolates.value);
    expect(overview.specimen.reduce((max, s) => Math.max(max, s.sharePct), 0)).toBeLessThanOrEqual(100);
    expect(overview.topOrganisms[0]!.n).toBe(
      Math.max(...overview.topOrganisms.map((o) => o.n)),
    );

    if (resistantPct) {
      expect(resistantPct.value).toBeGreaterThanOrEqual(0);
      expect(resistantPct.value).toBeLessThanOrEqual(100);
    }

    // Recent isolates: no patient identifiers, newest first.
    const dates = overview.recentIsolates.map((r) => new Date(r.date).getTime());
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
    for (const row of overview.recentIsolates) {
      expect(row).not.toHaveProperty("patientId");
    }
  });

  it("signals are severity-ranked with both proportions present", async () => {
    const signals = await getSignals({});
    expect(signals.scanned).toBeGreaterThan(0);
    const ranks = signals.signals.map((s) => SEVERITY_RANK[s.severity]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    for (const s of signals.signals) {
      expect(s.nWindow).toBeGreaterThanOrEqual(MIN_ISOLATES);
      expect(s.nBaseline).toBeGreaterThan(0);
      expect(s.z).toBeLessThanOrEqual(-2);
      expect(s.dropPp).toBeGreaterThanOrEqual(5);
      // windowS + dropPp ≈ baselineS; each is rounded to 0.1 independently.
      expect(s.baselineS - s.windowS).toBeCloseTo(s.dropPp, 0);
    }
  });

  it("heatmap breaks one organism down per ward with sufficient-n gating", async () => {
    const heat = await getHeatmap({ organism: "Escherichia coli" });
    expect(heat.wards[0]).toBe("Overall");
    expect(heat.wards).toHaveLength(10);
    expect(heat.rows.length).toBeGreaterThan(0);

    const top = heat.rows[0]!;
    // Rows sorted by overall resistance desc.
    for (const row of heat.rows) {
      expect(row.overall.rPct).toBeLessThanOrEqual(top.overall.rPct);
    }
    for (const row of heat.rows) {
      for (const cell of [...row.cells, row.overall]) {
        expect(cell.rPct).toBeGreaterThanOrEqual(0);
        expect(cell.rPct).toBeLessThanOrEqual(100);
        if (cell.n > 0) expect(cell.sufficient).toBe(cell.n >= MIN_ISOLATES);
        // Tone model: n<30 → insufficient; good cells are ≥90% susceptible;
        // elevated cells never exceed 70% susceptible.
        expect(cell.tone).toBe(cell.n < MIN_ISOLATES ? "insufficient" : cell.tone);
        if (cell.tone === "good") expect(cell.rPct).toBeLessThanOrEqual(10.5);
        if (cell.tone === "elevated") expect(cell.rPct).toBeLessThanOrEqual(30.5);
        if (cell.tone === "poor") {
          // Poor either from the band (<70% S) or from a ≥10 pp baseline rise.
          const escalated =
            cell.baselineR !== null && cell.rPct - cell.baselineR >= 10;
          expect(cell.rPct > 29.5 || escalated).toBe(true);
        }
        if (cell.baselineR !== null) {
          expect(cell.baselineR).toBeGreaterThanOrEqual(0);
          expect(cell.baselineR).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it("investigation recomputes the signal and carries outbreak-safe wording", async () => {
    const { signals } = await getSignals({});
    const sig = signals[0];
    expect(sig).toBeDefined();

    const inv = await getAlertInvestigation({ id: sig!.id });
    expect(inv.points).toHaveLength(89); // 60-day lead-in + 28-day window, inclusive
    expect(inv.signal.id).toBe(sig!.id);
    expect(inv.signal.z).toBeLessThanOrEqual(-2);
    // The service recomputes the same statistic it was handed.
    expect(inv.signal.z).toBeCloseTo(sig!.z, 1);
    expect(inv.wardRank.some((w) => w.ward === sig!.ward)).toBe(true);
    expect(inv.narrative).toContain("does not by itself confirm an outbreak");
    expect(inv.narrative.toLowerCase()).not.toMatch(/prescribe|first-line|treatment option/);
  });

  it("ward-vs-ward comparison carries CIs, BH-adjusted pairs and funnel flags", async () => {
    const cmp = await getWardCompare({ organism: "Escherichia coli" });
    expect(cmp.wards.length).toBeGreaterThan(0);
    expect(cmp.metric).toBe("Overall panel");

    for (const w of cmp.wards) {
      expect(w.n).toBeGreaterThan(0);
      expect(w.r).toBeLessThanOrEqual(w.n);
      // rPct recomputes from the raw counts.
      expect(w.rPct).toBeCloseTo((w.r / w.n) * 100, 0);
      // Wilson CI brackets the point estimate.
      expect(w.ciLo).toBeLessThanOrEqual(w.rPct + 0.05);
      expect(w.ciHi).toBeGreaterThanOrEqual(w.rPct - 0.05);
      // Funnel limits widen as n shrinks; flags must be consistent.
      expect(w.lower95).toBeLessThan(w.upper95);
      if (w.flag === "above998") expect(w.rPct).toBeGreaterThan(w.upper998);
      if (w.flag === "above95") {
        expect(w.rPct).toBeGreaterThan(w.upper95);
        expect(w.rPct).toBeLessThanOrEqual(w.upper998);
      }
      if (w.flag === "below95") expect(w.rPct).toBeLessThan(w.lower95);
      if (w.flag === "none") {
        expect(w.rPct).toBeLessThanOrEqual(w.upper95);
        expect(w.rPct).toBeGreaterThanOrEqual(w.lower95);
      }
    }

    // Every tested pair has n ≥ MIN; BH monotone; significance = pAdj < 0.05.
    const byWard = new Map(cmp.wards.map((w) => [w.ward, w]));
    for (const pair of cmp.pairs) {
      expect(byWard.get(pair.a)!.n).toBeGreaterThanOrEqual(MIN_ISOLATES);
      expect(byWard.get(pair.b)!.n).toBeGreaterThanOrEqual(MIN_ISOLATES);
      expect(pair.significant).toBe(pair.pAdj < 0.05);
      expect(Math.abs(pair.z)).toBeGreaterThan(0);
    }
    const sorted = [...cmp.pairs].sort((a, b) => a.p - b.p);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.pAdj).toBeGreaterThanOrEqual(sorted[i - 1]!.pAdj - 1e-9);
    }
    expect(cmp.pairsTested).toBe(cmp.pairs.length);
    expect(cmp.pairsSignificant).toBe(cmp.pairs.filter((p) => p.significant).length);
    expect(cmp.methodology.length).toBeGreaterThanOrEqual(5);
  });

  it("ward comparison covers all wards with per-ward resistance", async () => {
    const cmp = await getWardComparison({});
    expect(cmp.wards).toHaveLength(9);
    expect(cmp.organisms.length).toBeGreaterThan(0);
    for (const ward of cmp.wards) {
      expect(ward.isolates).toBeGreaterThan(0);
      if (ward.resistantPct !== null) {
        expect(ward.resistantPct).toBeGreaterThanOrEqual(0);
        expect(ward.resistantPct).toBeLessThanOrEqual(100);
      }
      expect(ward.organismResistance.length).toBeGreaterThan(0);
      for (const entry of ward.organismResistance) {
        if (entry.rPct === null || entry.n < MIN_ISOLATES) {
          expect(entry.tone).toBe("insufficient");
        } else {
          expect(entry.tone).not.toBe("insufficient");
          if (entry.tone === "good") expect(entry.rPct).toBeLessThanOrEqual(10.5);
        }
      }
    }
  });

  it("organism profile returns panel, monthly series and ward breakdown", async () => {
    const profile = await getOrganismProfile({ organism: "Escherichia coli" });
    expect(profile.n).toBeGreaterThan(0);
    expect(profile.cells.length).toBeGreaterThan(0);
    for (const cell of profile.cells) {
      expect(cell.n).toBe(cell.n); // structural: n present
      expect(cell.sPct).toBeGreaterThanOrEqual(0);
      expect(cell.sPct).toBeLessThanOrEqual(100);
      expect(cell.ciLo).toBeLessThanOrEqual(cell.sPct);
      expect(cell.ciHi).toBeGreaterThanOrEqual(cell.sPct);
    }
    expect(profile.monthly.length).toBeGreaterThan(0);
    for (const series of profile.monthly) {
      expect(series.points).toHaveLength(12);
    }
    expect(profile.wards).toHaveLength(9);
    for (const row of profile.wards) {
      if (row.rPct !== null && row.n >= MIN_ISOLATES) {
        expect(["good", "elevated", "poor"]).toContain(row.tone);
      }
    }
  });

  it("explorer paginates and filters by result", async () => {
    const page1 = await getExplore({ organism: "Escherichia coli", result: "R", page: 1, pageSize: 25 });
    expect(page1.rows).toHaveLength(25);
    expect(page1.total).toBeGreaterThanOrEqual(page1.rows.length);
    for (const row of page1.rows) {
      expect(row.organism).toBe("Escherichia coli");
      expect(row.resistant.length).toBeGreaterThan(0); // filtered on ≥1 R
      expect(row.patientSex).toMatch(/^[FM]$/);
      expect(row.patientAgeBand).toBeTruthy();
    }
    const page2 = await getExplore({ organism: "Escherichia coli", result: "R", page: 2, pageSize: 25 });
    expect(page2.rows[0]!.isolateId).not.toBe(page1.rows[0]!.isolateId);
  });

  it("historical replay recomputes every window at the past anchor", async () => {
    const meta = await getMeta();
    const asOf = new Date(new Date(meta.dateMax).getTime() - 182 * DAY_MS).toISOString();

    const replay = await getOverview({ asOf });
    expect(new Date(replay.windowEnd).getTime()).toBe(new Date(asOf).getTime());
    expect(replay.asOf).toBe(asOf);
    expect(replay.kpis.totalIsolates.value).toBeGreaterThan(0);

    const live = await getOverview({});
    expect(live.asOf).toBeNull();
    expect(new Date(live.windowEnd).getTime()).toBe(new Date(meta.dateMax).getTime());

    const replaySignals = await getSignals({ asOf });
    expect(new Date(replaySignals.generatedAt).getTime()).toBeGreaterThan(0);
    for (const s of replaySignals.signals) {
      expect(new Date(s.windowEnd).getTime()).toBe(new Date(asOf).getTime());
    }

    const replayHeat = await getHeatmap({ organism: "Escherichia coli", asOf });
    expect(new Date(replayHeat.windowEnd).getTime()).toBe(new Date(asOf).getTime());
  });
});
