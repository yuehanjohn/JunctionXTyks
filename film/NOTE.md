# AEI Pulse — Motion Film Director's Note

## The One Idea
An antimicrobial surveillance radar that defends humanity's greatest medical triumphs: replacing the annual backward glance with a live, 28-day rolling window that alerts clinicians and intercepts outbreaks before they spread.

## PAGE Analysis
- **Problem**: Modern medicine is facing a silent, human-scale crisis: antimicrobial resistance (projected 10M deaths/yr by 2050). Routine surgery, chemotherapy, and childbirth are threatened, yet hospitals still monitor outbreaks with annual backward-looking PDF reports compiled once every 12 months with massive lag.
- **Audience**: Clinical evaluators, hospital epidemiologists, physicians at Tyks Laboratories, and challenge judges.
- **Goal**: Make the viewer believe AEI Pulse transforms AMR monitoring from a retrospective archive into an active, real-time radar that defends modern medicine and saves lives at the bedside.
- **Emotion**: Visceral crisis dread (rapid-fire media overload) → awe at human medical progress → cinematic relief & clinical control (real-time radar defense).

## Aesthetic & Technical Foundation
- **Theme & Vibe**: Inspired by fframes `made-of-motion` and `the-why`:
  - *"Cold blue for the machines. Warm light for human intent."*
  - **Analog / pixel collage**: textured newsprint paper grain, procedural halftone screen, red marker strokes, decisive punctuation stamps (**crisis.** / **radar.** / **humanity.**).
  - **Vulkan GPU SkSL camera tracking pass**: rendered directly via `ff-tracking` with camera perspective tilt, CRT phosphor bloom, scanline tears, and real coordinates (`film/media/tracking.mp4`).
  - **Real AEI Pulse application interface**: live Tyks hospital data, 1,212 acute isolates, 28-day rolling window, real 9 Wards × 7 Antibiotics matrix, Transmission Map with ward transfer pathways, ICU $z = -5.8\sigma$ alert slam, and empiric bedside decision support.

## Beat Architecture & Value Delivered

| Beat | Frames | Time | Role | Buys | Voiceover |
|---|---|---|---|---|---|
| **1A** | 0–36 | 0.0–1.2s | Hook | Global media panic | "A silent pandemic..." |
| **1B** | 36–48 | 1.2–1.6s | Hook | Microbial mutation speed | "...is accelerating..." |
| **1C** | 48–90 | 1.6–3.0s | Hook | Global health emergency | "...through modern medicine." |
| **1D** | 90–125 | 3.0–4.17s | Hook | Urgency of closing window | "Ten million lives a year." |
| **1E** | 125–240 | 4.17–8.0s | Hook | Scale of the crisis | "...The miracle drugs of our century are failing." |
| **2** | 240–450 | 8.0–15.0s | Turn | Human progress & stakes | "For a hundred years, antibiotics shielded humanity's greatest leaps: surgery, chemotherapy, childbirth." |
| **3A** | 450–495 | 15.0–16.5s | Turn | The shield breaks | "Without them, the shield breaks..." |
| **3B** | 495–630 | 16.5–21.0s | Turn | Stagnant annual PDFs | "...And hospitals still fight back with annual PDF reports." |
| **4** | 630–760 | 21.0–25.33s | Turn (Hero) | Radar arrival by cause | "An infection does not wait a year. This is AEI Pulse." |
| **5** | 760–950 | 25.33–31.66s | Proof | Real-time surveillance | "A living surveillance radar. 1,212 acute isolates, tracked in real time." |
| **6** | 950–1120 | 31.66–37.33s | Proof | Comprehensive hospital scale | "A 28-day rolling window sweeping every ward, every organism, every antibiotic." |
| **7** | 1120–1350 | 37.33–45.0s | Proof (Hero) | Outbreak anomaly catch | "When a resistant clone surges, Pulse catches it. Z-score minus 5.8: intercepted before the outbreak spreads." |
| **8** | 1350–1470 | 45.0–49.0s | Proof | Bedside decision support | "At the bedside: knowing what still works. Protecting what remains." |
| **9** | 1470–1800 | 49.0–60.0s | CTA | Saving humanity's shield | "We are defending the shield that built the modern world. AEI Pulse. Tyks Laboratories." |

## What is Real vs Illustrative
- **Real (from Tyks application & dataset)**:
  - 1,212 acute care isolates (+1.9% vs previous 4 weeks).
  - 9 hospital wards: Emergency Department, General Surgery, Health Centre East, Health Centre West, ICU, Infectious Diseases Ward, Internal Medicine A, Internal Medicine B, Pediatrics.
  - 7 standard antibiotics: Trimethoprim, Ciprofloxacin, Cefuroxime, Pivmecillinam, Nitrofurantoin, Gentamicin, Meropenem.
  - Real Antibiogram Matrix & Ward Transmission Map network (`film/media/crop_antibiogram_matrix_2x.png`, `crop_transmission_network_2x.png`).
  - Critical Outbreak Alert: *Escherichia coli* to Ciprofloxacin on ICU falling 37.8 pp to 37.3% susceptible (62.7% resistant, $z = -5.8\sigma$, n=51).
  - Hospital-wide annual baseline: 25.3% resistant.
  - Bedside empiric decision guidance: Meropenem 96.5% susceptible (3.5% R, n=487) recommended; Ciprofloxacin compromised on ICU.
  - Official Tyks house/ward SVG mark in `#0f6b7c` / `#1594ab`.
  - Fonts: official IBM Plex Sans and IBM Plex Mono.
- **Illustrative / Creative**:
  - The historical broadsheet newspaper (*The Guardian*), broadcast television chyrons (BBC/CNN Breaking), and medical journal (*The Lancet*) in Act 1 visualizing the global human crisis.
  - The golden geometric shield in Act 2 visualizing the 100-year antibiotic defense of human civilization.
  - `ff-tracking` camera-tracked GPU lens shader sequence (`film/media/tracking.mp4`) simulating high-tech pathogen genomic tracking.

## Audio Audit (Measured in film/build/mix.wav)
- **Integrated Loudness**: -14.2 LUFS (Target -14.0 LUFS, compliant with EBU R128).
- **Loudness Range (LRA)**: 6.4 LU.
- **True Peak**: -1.6 dBFS (under -1.0 dBFS ceiling; 0 clipped samples).
- **Audible Span**: 0.01s – 60.00s (100% of film).
- **Sound Elements**: `soundtrack.mp3` ducked smoothly (-14 dB) under voiceover, 10 ElevenLabs studio voiceover lines, and 9 synchronized cinematic SFX hits (camera shutter clicks, sub-bass drop on 10M, warm harmonic riser on humanity, paper thud, laser stinger on AEI Pulse, crystal sonar ping, trailer BRAAM hit on $z = -5.8$, tactile UI pop, and resolved harmonic tail).

## Gate Performance
- **Gate G0 (Render exists)**: PASS (1920×1080 @ 30fps, 1800 frames = 60.00s, H.264 + AAC audio present).
- **Gate G1 (Proof readable)**: PASS (All clinical tables, KPI values, and alert cards rendered at text >= 0.04H with high contrast).
- **Gate G2 (No empty frame)**: PASS (No flat black frames; continuous camera drift and kinetic motion).
- **Gate G3 (End card hold & CTA share)**: PASS (End hold: 1.17s resolved stillness from f1765 to f1800; final CTA shot: 11.0s = 18.3% of total film <= 25%).
- **Gate G4 (One hero per frame)**: PASS (Single focal point per shot with hierarchical staging).
- **Gate G5 (No page chrome / HUD)**: PASS (`lint.mjs` returns `GATE G5: PASS` with 0 failures across all 15 lint categories).
