// HTTP journey smoke: probe every page + API against a running server
// (default http://localhost:3777). Usage: npx tsx scripts/smoke-http.ts [baseUrl]

const BASE = process.argv[2] ?? "http://localhost:3777";

interface Probe {
  path: string;
  check?: (body: unknown) => string | null; // return an error string on failure
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const PROBES: Probe[] = [
  { path: "/" },
  { path: "/early-warning" },
  { path: "/guidance" },
  { path: "/trends" },
  { path: "/wards" },
  { path: "/organisms" },
  { path: "/alerts" },
  { path: "/sitrep" },
  { path: "/explore" },
  {
    path: "/api/meta",
    check: (b) =>
      isObj(b) && Array.isArray(b.wards) && b.wards.length === 9 ? null : "meta shape",
  },
  {
    path: "/api/overview",
    check: (b) => {
      if (!isObj(b) || !isObj(b.kpis)) return "overview shape";
      const kpis = b.kpis as { totalIsolates?: { value?: number } };
      if ((kpis.totalIsolates?.value ?? 0) <= 0) return "overview empty";
      return null;
    },
  },
  {
    path: "/api/overview?asOf=2025-06-01",
    check: (b) =>
      isObj(b) && typeof b.windowEnd === "string" && b.windowEnd.startsWith("2025-06-01")
        ? null
        : "replay window not anchored at asOf",
  },
  {
    path: "/api/heatmap?organism=Escherichia%20coli",
    check: (b) => {
      if (!isObj(b) || !Array.isArray(b.rows) || b.rows.length === 0) return "heatmap empty";
      return null;
    },
  },
  { path: "/api/signals" },
  {
    path: "/api/warning",
    check: (b) =>
      isObj(b) && Array.isArray(b.warnings) && typeof b.expectedPerMonth === "number"
        ? null
        : "warning feed shape",
  },
  {
    path: "/api/warning/timeline?weeks=13",
    check: (b) => {
      if (!isObj(b) || !Array.isArray(b.points) || b.points.length !== 13) return "timeline points";
      const last = b.points[b.points.length - 1] as { warnings?: unknown } | undefined;
      return Array.isArray(last?.warnings) ? null : "timeline warnings";
    },
  },
  {
    path: "/api/mdro",
    check: (b) => {
      if (!isObj(b) || !Array.isArray(b.weeks) || b.weeks.length !== 26) return "mdro weeks";
      return null;
    },
  },
  { path: "/api/pathways" },
  { path: "/api/sitrep?ward=ICU" },
  {
    path: "/api/ward-comparison",
    check: (b) => (isObj(b) && Array.isArray(b.wards) && b.wards.length === 9 ? null : "ward list"),
  },
  {
    path: "/api/ward-comparison/compare?organism=Escherichia%20coli",
    check: (b) => {
      if (!isObj(b) || !Array.isArray(b.wards) || b.wards.length === 0) return "compare wards empty";
      if (!Array.isArray(b.pairs) || b.pairs.length === 0) return "compare pairs empty";
      return null;
    },
  },
  {
    path: "/api/organism?organism=Escherichia%20coli",
    check: (b) => (isObj(b) && typeof b.n === "number" && b.n > 0 ? null : "organism profile empty"),
  },
  {
    path: "/api/explore?pageSize=10",
    check: (b) => {
      if (!isObj(b) || !Array.isArray(b.rows) || b.rows.length !== 10) return "explore page size";
      return null;
    },
  },
  {
    path: "/api/trends?organism=Escherichia%20coli&antibiotic=Ciprofloxacin",
    check: (b) => (isObj(b) && Array.isArray(b.points) && b.points.length === 24 ? null : "trend points"),
  },
];

async function main() {
  let failures = 0;
  for (const probe of PROBES) {
    const url = `${BASE}${probe.path}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`FAIL ${res.status} ${probe.path}`);
        failures += 1;
        continue;
      }
      if (probe.check) {
        const body: unknown = await res.json();
        const err = probe.check(body);
        if (err) {
          console.error(`FAIL ${probe.path}: ${err}`);
          failures += 1;
          continue;
        }
      }
      console.log(`ok   ${probe.path}`);
    } catch (err) {
      console.error(`FAIL ${probe.path}: ${err instanceof Error ? err.message : String(err)}`);
      failures += 1;
    }
  }

  // Alert investigation for the first live signal (id contains "|").
  const sigRes = await fetch(`${BASE}/api/signals`);
  if (sigRes.ok) {
    const sig = (await sigRes.json()) as { signals: { id: string }[] };
    const id = sig.signals[0]?.id;
    if (id) {
      const invRes = await fetch(`${BASE}/api/alerts/investigate?id=${encodeURIComponent(id)}`);
      const invOk = invRes.ok
        ? await invRes.json().then(
            (inv) =>
              isObj(inv) &&
              typeof inv.narrative === "string" &&
              inv.narrative.includes("does not by itself confirm an outbreak") &&
              isObj(inv.workbench),
          )
        : false;
      console.log(invOk ? "ok   /api/alerts/investigate (+workbench)" : "FAIL /api/alerts/investigate");
      if (!invOk) failures += 1;
    } else {
      console.log("skip /api/alerts/investigate (no live signals)");
    }
  }

  console.log(failures === 0 ? "HTTP SMOKE OK" : `HTTP SMOKE FAILED: ${failures} failures`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
