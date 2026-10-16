# AEI — Antibiotic Efficacy Indicator

Rolling, real-time antimicrobial resistance (AMR) surveillance for Tyks Laboratories (Junction x Tyks challenge mock-up).

A doctor on a ward opens AEI and sees, **right now**, which antibiotics still work for the bacteria on **their** ward — not last year's hospital-wide PDF.

## Core concept

Traditional AMR reports are annual and hospital-level. AEI is **ward-first and rolling**:

- **Ward dashboard** — antibiogram matrix (organism × antibiotic) for the **last 4 weeks**, each cell compared against the **annual baseline** with a delta arrow. Green/amber/red tinting, `n<30` cells greyed out as statistically unusable.
- **Resistance signals** — automatic anomaly detection: every ward×organism×antibiotic cell with ≥30 isolates is compared (rolling 4-week window vs trailing 12-month baseline) with a **two-proportion z-test**; flagged when `z ≤ −2` and drop `≥ 5 pp`, ranked high/moderate/watch, each with a plain-language clinical implication.
- **Trends** — 24-month susceptibility curve per organism/antibiotic/ward/specimen, points sized by sample size, hollow points where `n < 30`.
- **AI advisor** — AI-native natural-language queries over the live surveillance data (rule-based, no external LLM): *"Best antibiotic for E. coli on ICU?"*, *"What changed recently?"*, *"What's the worst resistance here?"* — answers always cite sPct, n and 95% CI from the data.

## Methodology

- **First isolate per patient per organism per period** (EARS-Net practice) before computing percentages.
- Metric: % susceptible `S/(S+R)`; Wilson score 95% CI per cell.
- **Minimum 30 isolates** per cell (MIN_ISOLATES) — below that, percentages are not reported.
- Rolling window = last 28 days anchored at the newest sample; baseline = trailing 365 days before the window.

## Stack

- Next.js 15 (App Router) + TypeScript strict + Tailwind CSS v4
- Prisma ORM. Datasource is **SQLite** for the zero-setup mock-up — switch `provider` to `"postgresql"` in `prisma/schema.prisma` and set `DATABASE_URL` for production; no query changes needed.
- recharts for trend charts. Dev server on port **3777**.

## Data

The challenge's `synthetic_microbiology_dataset.zip` was not available in this workspace, so the seed generates a **schema-faithful synthetic dataset** (10,000 patients, 47,000 cultures, ~241,000 susceptibility results over 3 years, 9 wards, urine/blood/wound) with a few scripted resistance anomalies so the signal detector demonstrably fires.

**To use the real dataset:** export the four CSVs into `./data/` with columns

```
patients.csv          patient_id,sex,birth_year
cultures.csv          culture_id,patient_id,sample_type,ward,taken_at
isolates.csv          isolate_id,culture_id,organism
susceptibilities.csv  susceptibility_id,isolate_id,antibiotic,result
```

then `pnpm db:reset` — the seeder imports whatever CSVs it finds in `./data` verbatim.

## Run

```bash
pnpm install
pnpm db:reset   # push schema + seed (generates synthetic CSVs into ./data first run)
pnpm dev        # dev server: http://localhost:3777
```

Production (recommended — the stats cache warms at boot and pages load from the prebuilt bundle):

```bash
pnpm build && pnpm start   # http://localhost:3777
```

Performance notes: surveillance aggregates are cached in memory (promise-deduped, keyed on the newest sample timestamp, so a reseed self-invalidates) and precomputed at server start via `src/instrumentation.ts` — every API responds in single-digit ms after boot.

## Judging criteria mapping

| Criterion | Where |
|---|---|
| Understanding the challenge | Ward-first UX; rolling 4-week vs annual view; first-isolate/≥30 methodology |
| Suitability (not a plain BI dashboard) | AI advisor over live data, clinical implications on signals, usable-by-a-doctor workflow |
| Usability | Instant filters, sticky antibiogram matrix, cell focus with CI, empty/insufficient states, chat UI |
| Deviation & anomaly detection | Two-proportion z-test scan across all cells, severity-ranked signal feed, trend anomalies visible as hollow low-n points |

All data shown is synthetic; nothing here is a treatment guideline.
