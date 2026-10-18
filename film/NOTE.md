# AEI Pulse — Motion Film Director's Note

## The One Idea
An antimicrobial surveillance instrument that never sleeps: replacing the annual backward glance with a live, 28-day rolling window that alerts clinicians and infection-control specialists before an outbreak expands.

## PAGE Analysis
- **Problem**: Traditional hospital AMR surveillance is compiled annually at hospital level. It is too delayed (up to 12 months lag) and too aggregated (ward-level spikes are buried in the mean).
- **Audience**: Clinical microbiologists, ward physicians, epidemiologists, and challenge evaluators at Tyks Laboratories.
- **Goal**: Make the viewer believe AEI Pulse transforms AMR monitoring from a retrospective archive into a real-time clinical instrument.
- **Emotion**: Archival dread (stagnant annual papers) → kinetic alarm (infection speed) → precision control (clean live instrument).

## Beat Architecture & Value Delivered

| Beat | Frames | Time | Role | Buys | Voiceover |
|---|---|---|---|---|---|
| 1 | 0–150 | 0.0–5.0s | Hook | The physical weight and backward-looking delay of annual paper reports | "Every year, the laboratory looks back." |
| 2 | 150–330 | 5.0–11.0s | Hook | Stagnation: 12 months compressed into one static table concealing ward spikes | "Twelve months of resistance, condensed into one report." |
| 3 | 330–480 | 11.0–16.0s | Turn | Temporal urgency: infections spread in days, not years | "But an infection does not wait a year." |
| 4 | 480–600 | 16.0–20.0s | Turn | Name arrival by cause: the clinical instrument opens into light | "This is AEI Pulse." |
| 5 | 600–840 | 20.0–28.0s | Proof | Real rolling window mechanics: 28-day window sweeps over daily data | "A rolling, real-time window on antimicrobial resistance. Updated every day." |
| 6 | 840–1140 | 28.0–38.0s | Proof | Scale as countable lattice: 9 wards × 7 antibiotics heatmap | "Every ward. Every organism. Every antibiotic. Susceptible, or resistant." |
| 7 | 1140–1440 | 38.0–48.0s | Proof (Hero) | Statistical deviation detection: ICU E. coli to Ciprofloxacin z = −5.8 alert slam | "When a signal drifts from its baseline, Pulse raises the alert. Early, while the outcome can still change." |
| 8 | 1440–1665 | 48.0–55.5s | Proof | Bedside utility: what still works (Meropenem 96.5% S) vs stopped (Ciprofloxacin 62.7% R) | "For the doctor at the bedside: what still works. What has stopped." |
| 9 | 1665–1860 | 55.5–62.0s | CTA | Contrast synthesis: retrospective archive discarded in favor of active instrument | "Not a report of the past. An instrument for the next decision." |
| 10 | 1860–2058 | 62.0–68.6s | CTA | Identity, ownership, and quiet resolved stillness | "AEI Pulse. Tyks Laboratories. Surveillance, in real time." |

## What is Real vs Illustrative
- **Real (from Tyks application & dataset)**:
  - Total isolates count: 1,212 (+1.9% vs previous 4 weeks).
  - Resistant isolates: 64.3%.
  - Top organism: *Escherichia coli* (42.7% of isolates, n=518).
  - Highest resistance: 81.9% (*S. aureus* to Penicillin).
  - 9 hospital wards: Emergency Department, General Surgery, Health Centre East, Health Centre West, ICU, Infectious Diseases Ward, Internal Medicine A, Internal Medicine B, Pediatrics.
  - 7 standard antibiotics: Trimethoprim, Ciprofloxacin, Cefuroxime, Pivmecillinam, Nitrofurantoin, Gentamicin, Meropenem.
  - Anomaly finding: *Escherichia coli* resistance to Ciprofloxacin on ICU falling 37.8 pp to 37.3% susceptible (62.7% resistant, z = −5.8, n=51).
  - Hospital-wide annual baseline: 25.3% resistant.
  - Bedside guidance: Meropenem 96.5% susceptible (3.5% resistant, n=487) as active option; Ciprofloxacin 62.7% resistant as compromised option.
  - Tyks logo mark: official house/ward SVG mark in `#0f6b7c`.
  - Fonts: official IBM Plex Sans and IBM Plex Mono.
- **Illustrative**:
  - The historical 2021–2024 paper report covers in Act 1 are physical metaphors visualizing the challenge's premise.
  - Synthesized audio impact cues (sub-bass stinger, tech activation chime, alert slam impact, resolve chord).

## Gate Performance (Measured)
- **Gate G0 (Render exists)**: PASS (Decodes cleanly, valid H.264 video, duration 68.60s matches plan).
- **Gate G1 (Proof readable)**: PASS (By eye on contact sheet: all clinical tables, KPI values, and alert cards rendered at >= 0.04H text with high contrast).
- **Gate G2 (No empty frame)**: PASS (Zero flat-field runs exceeding 3 frames).
- **Gate G3 (End hold & CTA share)**: PASS (End hold: ~1.17s inside 0.60–1.40s window; CTA final shot: 6.60s = 9.6% <= 25%).
- **Gate G4 (One hero per frame)**: PASS (Single focal point per shot: paper stack -> single sheet -> timeline ticker -> name frame -> rolling window -> heatmap matrix -> macro curve & slam card -> guidance split card -> contrast boxes -> wordmark lockup).
- **Gate G5 (No page chrome / HUD)**: PASS (`lint.mjs` returns `GATE G5: PASS` with 0 failures across all 14 lint categories).

## Contact Sheet Frame Descriptions
1. **0.95s**: Three-dimensional paper stack tilts into view in dark laboratory lighting; top sheet reads 2024 Annual Report.
2. **2.86s**: Sheet 24 settles with red 'Static Report' stamp as headline rises in IBM Plex Sans.
3. **4.76s**: Camera drifts across the archival report stack as the condensation begins.
4. **6.67s**: Single 2024 annual report page lies flat, showing historical annual averages that bury ward spikes.
5. **8.57s**: 'Past Data' stamp emphasizes the 365-day reporting lag.
6. **10.48s**: An ink-drop anomaly appears on the report surface as the scene transitions.
7. **12.39s**: Red biological threat ticker whips across the dark void: 'An infection does not wait a year.'
8. **14.29s**: Expanding red stinger pulse centers on the timeline at the word 'infection'.
9. **16.20s**: Clean clinical light (#fcfcfd) floods the frame as the Tyks ward mark draws.
10. **18.10s**: 'AEI Pulse' name resolves inside the clean clinical window frame.
11. **20.00s**: KPI strip arrives with live isolate counter stepping to 1,212.
12. **24.00s**: Teal translucent 28-day window shade sweeps across the daily resistance trend curve.
13. **28.00s**: Seamless transition into the 9-ward × 7-antibiotic surveillance matrix.
14. **32.00s**: Full heatmap populates; ICU Ciprofloxacin cell pulses with red alert outline.
15. **38.00s**: Extreme macro zoom into the ICU Ciprofloxacin curve crossing the 25.3% hospital baseline.
16. **42.00s**: Alert slam card crashes in from 3.2x with z = −5.8 statistical deviation badge.
17. **48.00s**: Transition to Bedside Guidance panel showing Meropenem (96.5% S) vs Ciprofloxacin (62.7% R).
18. **52.00s**: Cursor clicks 'Select for Order' on Meropenem with tactile button compression.
19. **56.00s**: Split contrast view: dusty annual archive slides left into history while live instrument steps forward.
20. **62.00s**: Deep dark sign-off: Tyks ward logo mark draws and wordmark locks up with teal accent rule.
21. **67.43s**: Tagline 'Surveillance, in real time.' finishes reveal.
22. **68.60s**: Clean resolved stillness on the final brand lockup.

## What Could Still Be Improved
- In a full production studio pipeline with a WebGL shader pass, a subtle lens distortion or depth-of-field blur could be applied to the background paper sheets in Act 1.
- In Scene 6, the 63-cell heatmap could feature per-cell hover micro-tooltips showing isolate counts (n=51) when the cursor passes over the ICU column.
