# AEI Pulse — Screen Captures & Hero Macro Crops

This catalog documents the pristine 1920×1080 UI screenshots and high-DPI macro crop fragments captured directly from the live AEI Pulse Next.js application (`http://localhost:3000`).

All assets are located in `film/media/` and formatted for direct integration into motion graphics sequences, camera tracking HUD projections, and extreme zoom cuts.

---

## 1. Full-Screen Captures (1920 × 1080 Viewport)

| File | Route | Size | Clinical Context & Features |
|:---|:---|:---|:---|
| `screen_overview.png` | `/` | 1920×1080 (241 KB) | **Hospital Overview Dashboard**: 1,212 isolates (28-day rolling window), 4 KPI cards, hospital-wide resistance longitudinal trend lines, **8 significant alerts** card (ICU *E. coli* resistance collapse to Ciprofloxacin, $z = -5.8$), specimen distribution, and top isolated organisms. |
| `screen_early_warning.png` | `/early-warning` | 1920×1080 (86 KB) | **Early Warning Center**: False-alarm budget meter (tuned against 2 alarms/month), Severity-grouped Warning Feed, **Transmission Map schematic** (ICU central hub + 8 hospital nodes), and MDRO surveillance panels. |
| `screen_guidance.png` | `/guidance` | 1920×1080 (105 KB) | **Bedside Empiric Decision Guidance**: Interactive clinical AI advisor calculating real-time empiric antibiotic susceptibility rankings (% S) and isolate counts ($n$) for *Escherichia coli*. |
| `screen_sitrep.png` | `/sitrep` | 1920×1080 (57 KB) | **Hospital Situation Report (Sitrep)**: Executive clinical intelligence document summarizing resistance shifts, ward-by-ward risks, and infection control checklists. |

---

## 2. Hero Crop Fragments (Macro Zoom & Camera Tracking)

Both 1× native bounding-box crops and **2× high-DPI macro crops** are provided to allow smooth camera zooms up to 300% without resolution loss or artifacting.

### A. ICU Anomaly Alert Card (The Anomaly Slam)
- **1× File**: `film/media/crop_icu_alert.png` (528 × 416 px, 19.1 KB)
- **2× Macro File**: `film/media/crop_icu_alert_2x.png` (1056 × 832 px, 41.7 KB)
- **Viewport Coordinates on `/`**:
  - $x$: `1360.0 px`
  - $y$: `348.8 px`
  - $\text{width}$: `528.0 px`
  - $\text{height}$: `414.5 px`
- **Clinical Content**:
  - Badge: **8 significant alerts**
  - Pathogen & Drug: **Escherichia coli resistance to Ciprofloxacin** (`high` severity badge)
  - Detail: *"in Intensive Care Unit (ICU) has changed from 75% to 37.3% susceptible in the last 4 weeks ($z = -5.8$)."*
  - Includes 28-day daily resistance bar graph series.

### B. Transmission Map Network (HUD Tracking Overlay)
- **1× Pure Network SVG**: `film/media/crop_transmission_network.png` (1574 × 431 px, 66.4 KB)
- **2× High-DPI Network**: `film/media/crop_transmission_network_2x.png` (3148 × 862 px, 200.0 KB)
- **Full Card (with timeline controls)**: `film/media/crop_transmission_map.png` (1616 × 579 px) / `_2x.png` (3232 × 1200 px)
- **Viewport Coordinates on `/early-warning`**:
  - $x$: `293.0 px`
  - $y$: `574.9 px`
  - $\text{width}$: `1574.0 px`
  - $\text{height}$: `430.0 px`
- **Clinical Content**:
  - 9 schematic ward nodes: **ICU** (central hub), **Emergency Department** (triage gate), **General Surgery**, **Internal Medicine A & B**, **Infectious Diseases Ward**, **Health Centre East & West**, and **Long-term Care Facility**.
  - Animated transmission arcs and directional infection vectors directly matching `film/media/tracking.mp4`.

### C. Empiric Bedside Guidance & Susceptibility Table
- **1× File**: `film/media/crop_guidance_card.png` (1574 × 477 px, 57.1 KB)
- **2× Macro File**: `film/media/crop_guidance_card_2x.png` (3148 × 954 px, 143.3 KB)
- **Viewport Coordinates on `/guidance`**:
  - $x$: `293.0 px`
  - $y$: `179.3 px`
  - $\text{width}$: `1574.0 px`
  - $\text{height}$: `476.5 px`
- **Clinical Content**:
  - Clinical query: *"Best antibiotic for E. coli?"*
  - Complete susceptibility ranking table (% S, isolate count $n$, EUCAST criteria).
  - Statistically grounded empiric recommendation for clinicians.

### D. Hospital-Wide Resistance Trend Chart
- **1× File**: `film/media/crop_trend_chart.png` (1072 × 416 px, 58.8 KB)
- **2× Macro File**: `film/media/crop_trend_chart_2x.png` (2144 × 832 px, 145.2 KB)
- **Viewport Coordinates on `/`**:
  - $x$: `272.0 px`
  - $y$: `348.8 px`
  - $\text{width}$: `1072.0 px`
  - $\text{height}$: `414.5 px`
- **Clinical Content**:
  - Longitudinal multi-antibiotic trend lines across Ciprofloxacin, Meropenem, Piperacillin/tazobactam, and Cefuroxime.

### E. Hospital Surveillance KPI Indicators
- **1× File**: `film/media/crop_kpi_row.png` (1616 × 118 px, 24.3 KB)
- **2× Macro File**: `film/media/crop_kpi_row_2x.png` (3232 × 236 px, 52.6 KB)
- **Viewport Coordinates on `/`**:
  - $x$: `272.0 px`
  - $y$: `211.5 px`
  - $\text{width}$: `1616.0 px`
  - $\text{height}$: `117.3 px`
- **Clinical Content**:
  - Total isolates: **1,212** (↑1.9% vs previous 4 weeks)
  - Resistant isolates: **64.3%**
  - Most common organism: **Escherichia coli** (42.7%, $n=518$)
  - Highest resistance: **81.9%** (*Staphylococcus aureus* to Penicillin)

### F. Antibiogram Heatmap Matrix
- **1× File**: `film/media/crop_antibiogram_matrix.png` (1072 × 439 px, 74.9 KB)
- **2× Macro File**: `film/media/crop_antibiogram_matrix_2x.png` (2144 × 878 px, 179.9 KB)
- **Viewport Coordinates on `/`**:
  - $x$: `272.0 px`
  - $y$: `783.3 px`
  - $\text{width}$: `1072.0 px`
  - $\text{height}$: `438.5 px`
- **Clinical Content**:
  - Cross-tabulation of 9 pathogens against 7 antibiotics, color-banded by EUCAST breakpoints with isolate counts and confidence indicators.

### G. Early Warning Feed & Outbreak Pathways
- **Warning Feed**: `film/media/crop_warning_feed.png` (1616 × 248 px) / `_2x.png` (3232 × 846 px)
- **Outbreak Pathways**: `film/media/crop_outbreak_pathways.png` (1616 × 204 px) / `_2x.png` (3232 × 1406 px)
- **Sitrep Document**: `film/media/crop_sitrep_doc.png` (1920 × 1080 px, 56.6 KB)

---

## 3. Motion & Camera Tracking Integration (`made-of-motion` Aesthetic)

These captures and crops are structured to support the `made-of-motion` creative direction:

1. **Tactile Macro Zooms**:
   - Use `crop_icu_alert_2x.png` and `crop_guidance_card_2x.png` with physical depth, subtle film grain, and chromatic aberration for the moment the film hits the statistical anomaly alert slam ($z = -5.8$).
2. **HUD Telemetry Overlay**:
   - `crop_transmission_network_2x.png` aligns with `film/media/tracking.mp4` camera tracking points, enabling glowing phosphor green / thermal amber HUD vectors floating over physical 3D scene geometry.
3. **Punched Kinetic Rhythms**:
   - Coordinate the appearance of `screen_overview.png` and `screen_early_warning.png` on major musical downbeats and bass drops.
