# AEI Pulse — AMR Intelligence for Tyks Laboratories

Rolling, real-time antimicrobial resistance (AMR) surveillance **and early outbreak warning** for Tyks Laboratories (Junction x Tyks challenge mock-up).

A doctor on a ward opens AEI Pulse and sees, **right now**, which antibiotics still work for the bacteria on **their** ward — and an infection-control practitioner sees, with evidence attached, whether a ward's pattern deserves investigation.

## Screens

- **Overview** — KPI strip (total isolates, resistant isolates, most common organism, highest resistance — each vs the previous 4 weeks), daily resistance trend per top-5 organism, resistance heatmap (antibiotic × ward) for a selected organism, live alert card with a mini daily-resistance chart, rule-based automated insights, specimen donut, top organisms and a recent-isolates feed.
- **Early Warning** — the outbreak layer: unified warning feed (proportion-drop z-tests with Benjamini–Hochberg FDR control, weekly-count CUSUM, 14-day Poisson cluster scan, MDRO-phenotype rare-event CUSUM) with an **alert-budget meter** (thresholds tuned on the backtest harness so ≤2 false alarms/month — what fires here is unusual), MDRO prevalence (26-week weekly trend, per-ward table, newest MDRO isolates, phenotype definitions), patient-transfer pathways reconstructed from repeat cultures, and the **backtest panel**: detection latency and false-alarm rates against injected, deterministic outbreak scenarios.
- **Alerts** — severity-ranked signals, each expanding into an **investigation workbench**: isolate timeline with repeat/new classification and MDRO phenotypes, involved patients' ward pathways, co-location count, putative import attribution, and an epidemiologist's checklist. **Historical replay** (`asOf`) recomputes every window as if today were that date.
- **Sitrep** — one-click automated weekly resistance situation report per ward (markdown, copy/download).
- **Antibiotic Guidance** — rule-based natural-language queries over the live surveillance data (no external LLM): best-susceptibility options, recent changes, worst resistance — answers always cite %S, n and 95% CI. Population-level only.
- **Trends & Analytics** — 24-month susceptibility curve per organism/antibiotic/ward/specimen/sex/age band, points sized by sample size and hollow-ringed where `n < 30`; 4-week vs annual baseline summary; monthly detail table; full antibiogram matrix with 4w/1y toggle.
- **Ward Comparison** — per-ward isolates, resistance %, top organism, active signals and a ward × organism resistance grid, plus computed key observations. A dedicated **statistical comparison** panel benchmarks wards properly: Wilson 95% CIs per ward (forest plot against the hospital mean), a funnel plot with binomial 95%/99.8% control limits, and all pairwise two-proportion z-tests with Benjamini–Hochberg FDR control (5%) — multiple-comparison-corrected, never bare percentages.
- **Organism View** — per-organism deep dive: susceptibility panel with Wilson 95% CI whiskers, resistance by ward, monthly resistance per antibiotic, specimen mix.
- **Data Explorer** — row-level isolate listing with all dataset filters (ward, specimen, organism, antibiotic + S/R, sex, age band, date range), pagination and CSV export. Patient identifiers are never shown.

## Methodology

- **First isolate per patient per organism per period** (EARS-Net practice) before computing percentages.
- Metric: % susceptible `S/(S+R)` (resistance screens show the complement `R/(S+R)`); Wilson score 95% CI per cell.
- **Minimum 30 isolates** per cell (MIN_ISOLATES) — below that, percentages are not reported (grey).
- Rolling window = last 28 days anchored at the newest sample; baseline = trailing 365 days before the window. Signals: pooled two-proportion z-test, FDR-controlled across the scan.
- **Detection stack** (Early Warning): D1 proportion-drop z-test (z ≤ −3 raw gate + Benjamini–Hochberg 5%) · D2 weekly-count CUSUM per ward×organism · D3 14-day Poisson cluster scan vs the cell's own 90-day rate · D4 MDRO-phenotype rare-event CUSUM. Thresholds tuned on the **backtest harness** (deterministic seeded outbreaks injected into a synthetic outbreak-free baseline) against an alert budget of ≤2 false alarms/month; per-scenario detection latency and PPV are measured, not asserted.
- **MDRO phenotypes** are panel-derived proxies (MRSA-type, VRE, CRE-proxy, ESBL-proxy, 3GC-R, MDR ≥3 classes) — no molecular typing exists in this dataset.
- **Clinical safety:** surveillance tool only. No patient-specific antibiotic recommendations; no output may declare a confirmed outbreak or assign ward blame. Every detection is a hypothesis with evidence and an investigation checklist.

## API

All GET, all `force-dynamic`, JSON: `/api/meta`, `/api/overview`, `/api/heatmap?organism=…`, `/api/signals`, `/api/alerts/investigate?id=ward|organism|antibiotic`, `/api/ward-comparison`, `/api/organism?organism=…`, `/api/antibiogram?window=4w|1y`, `/api/trends?organism=…&antibiotic=…`, `/api/explore`, plus `POST|DELETE /api/ingest` (simulated lab feed) and `/api/advisor`. Every data endpoint accepts `ward`, `sample` and — for historical replay — `asOf`. Shared contract in `src/lib/types.ts`; stats engine `src/lib/stats.ts`, Pulse aggregates `src/lib/pulse.ts` (all cached in memory, keyed on the newest sample timestamp).

## Stack

- Next.js 15 (App Router) + TypeScript strict + Tailwind CSS v4
- Prisma ORM. Datasource is **SQLite** for the zero-setup mock-up — switch `provider` to `"postgresql"` in `prisma/schema.prisma` and set `DATABASE_URL` for production; no query changes needed.
- recharts for trend charts. Dev server on port **3777**.

## Data

The challenge's `synthetic_microbiology_dataset.zip` CSVs (10,000 patients, 47,000 cultures, ~241,000 susceptibility results over 3 years, 9 wards, urine/blood/wound) are imported from `./data/` on `pnpm db:reset`. If `./data/` is empty the seeder generates a schema-faithful synthetic stand-in with scripted resistance anomalies instead. Expected columns:

```
patients.csv          patient_id,sex,birth_year
cultures.csv          culture_id,patient_id,sample_type,ward,taken_at
isolates.csv          isolate_id,culture_id,organism
susceptibilities.csv  susceptibility_id,isolate_id,antibiotic,result
```

## Run

```bash
pnpm install
pnpm db:reset   # push schema + seed (imports ./data CSVs; generates synthetic CSVs if absent)
pnpm test       # vitest: unit tests (stats math) + integration tests (service layer vs seeded DB)
pnpm dev        # dev server: http://localhost:3777
```

Production (recommended — the stats cache warms at boot and pages load from the prebuilt bundle):

```bash
pnpm build && pnpm start   # http://localhost:3777
```

HTTP journey smoke against a running server: `npx tsx scripts/smoke-http.ts`.

Performance notes: surveillance aggregates are cached in memory (promise-deduped, keyed on the newest sample timestamp, so a reseed self-invalidates) and precomputed at server start via `src/instrumentation.ts` — every API responds in single-digit ms after boot.

## Judging criteria mapping

| Criterion | Where |
|---|---|
| Understanding the challenge | Ward-first UX; rolling 4-week vs annual view; first-isolate/≥30 methodology; in-app methodology footnotes |
| Suitability (not a plain BI dashboard) | Antibiotic Guidance queries over live data, live lab-feed ingestion demo, alert investigations with epidemiological framing, usable-by-a-doctor workflow |
| Usability | Overview KPI strip + heatmap, patient sex/age filters, historical replay, cell focus with CI, CSV export, empty/insufficient states, chat UI |
| Deviation & anomaly detection | Two-proportion z-test scan across all cells, severity-ranked alert feed with per-signal investigation, live re-scoring, trend anomalies visible as hollow low-n points |

All data shown is synthetic; nothing here is a treatment guideline.
