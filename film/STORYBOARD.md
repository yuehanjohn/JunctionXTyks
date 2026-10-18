# AEI Pulse — Cinematic Surveillance Film Storyboard

## PAGE
- **Problem**: Modern medicine is facing a silent, human-scale crisis: antimicrobial resistance (10M projected deaths/yr). Routine surgery, chemo, and childbirth are threatened, yet hospitals still monitor outbreaks with annual backward-looking PDF reports compiled once every 12 months.
- **Audience**: Clinical evaluators, hospital epidemiologists, physicians at Tyks Laboratories, and challenge judges.
- **Goal**: Make the viewer believe AEI Pulse transforms AMR monitoring from a retrospective archive into an active, real-time radar that defends modern medicine and saves lives at the bedside.
- **Emotion**: Visceral crisis dread (rapid-fire media overload) → awe at human medical progress → cinematic relief & clinical control (real-time radar defense).

## The One True Thing
A living surveillance radar that never closes: 28 days rolling, every acute isolate, and the alarm before the outbreak spreads.

## System & Aesthetic
- **Theme & Vibe**: Inspired by fframes `made-of-motion` and `the-why`:
  - "Cold blue for the machines. Warm light for human intent."
  - Analog / pixel collage: textured newsprint paper grain, procedural halftone screen, red marker strokes, decisive punctuation stamps (**crisis.** / **radar.** / **humanity.**).
  - High-tech camera tracking HUD pass rendered via `ff-tracking` with Vulkan GPU SkSL lens shaders (perspective tilt, CRT phosphor bloom, scanline tears, real coordinates).
  - Real AEI Pulse application interface (1,212 acute isolates, 9 Wards × 7 Antibiotics matrix, Transmission Map, ICU $z = -5.8\sigma$ alert slam, Bedside Guidance).
- **Format**: 1920×1080 @ 30 fps. Duration: 1800 frames = 60.00s.
- **Clock**: Smooth clock with seek-safe GSAP runtime (`Motion.film`).
- **Sound**: `film/build/mix.wav` mastered to EBU R128 (-14.2 LUFS, true peak -1.6 dBFS, 0 clipped samples) combining `soundtrack.mp3`, 10 ElevenLabs studio VO clips, and 9 synchronized cinematic SFX hits.

## Beat Architecture & Timings

| Beat | Frames | Time | Role | Buys | VO Script | Visual & Sound Elements |
|---|---|---|---|---|---|---|
| **1A** | 0–36 | 0.0–1.2s | Hook | Global media panic | "A silent pandemic..." | *The Guardian* broadsheet, halftone dots, red marker stroke, "crisis." stamp. Shutter ticks. |
| **1B** | 36–48 | 1.2–1.6s | Hook | Microbial mutation speed | "...is accelerating..." | Rapid thermal strobe "MUTATION." with CRT scanlines and camera snap shake. Flash hit. |
| **1C** | 48–90 | 1.6–3.0s | Hook | Global health emergency | "...through modern medicine." | TV News Chyron (BBC/CNN Breaking), LIVE beacon, crawling ticker. Radio static. |
| **1D** | 90–125 | 3.0–4.17s | Hook | Urgency of closing window | "Ten million lives a year." | Kinetic typography "ACCELERATING." toggling to "UNTREATABLE." Sub-bass drop @ 3.7s. |
| **1E** | 125–240 | 4.17–8.0s | Hook | Scale of the crisis | "...The miracle drugs of our century are failing." | *The Lancet* Infectious Diseases, hero counter 1.2M -> 10,000,000, "failing." stamp slam. |
| **2** | 240–450 | 8.0–15.0s | Turn | Human progress & stakes | "For a hundred years, antibiotics shielded humanity's greatest leaps: surgery, chemotherapy, childbirth." | Warm golden cinematic light. Sacred protective shield geometry. 3 Pillars of Modern Medicine. Warm harmonic swell. |
| **3A** | 450–495 | 15.0–16.5s | Turn | The shield breaks | "Without them, the shield breaks..." | Cold alarm wash, hairline cracks branching violently across shield, "broken." stamp. Fracture crack sound. |
| **3B** | 495–630 | 16.5–21.0s | Turn | Stagnant annual PDFs | "...And hospitals still fight back with annual PDF reports." | Dusty 3D paper stack drops (2021-2024 reports). Red rubber stamp "365-Day Lag" slam. Paper thud. |
| **4** | 630–760 | 21.0–25.33s | Turn (Hero) | Radar arrival by cause | "An infection does not wait a year. This is AEI Pulse." | High-voltage flash shatters void. Tyks ward mark draws in teal #1594ab. Wordmark crash. Laser stinger. |
| **5** | 760–950 | 25.33–31.66s | Proof | Real-time surveillance | "A living surveillance radar. 1,212 acute isolates, tracked in real time." | Embedded `ff-tracking` Vulkan SkSL camera-tracked HUD pass. Live isolate counter 840 -> 1,212. Sonar ping. |
| **6** | 950–1120 | 31.66–37.33s | Proof | Comprehensive hospital scale | "A 28-day rolling window sweeping every ward, every organism, every antibiotic." | Real AEI Pulse UI: 9 Wards x 7 Antibiotics Matrix + Ward Transmission Map network. Smooth radar sweep. |
| **7** | 1120–1350 | 37.33–45.0s | Proof (Hero) | Outbreak anomaly catch | "When a resistant clone surges, Pulse catches it. Z-score minus 5.8: intercepted before the outbreak spreads." | ICU E. coli to Ciprofloxacin trend curve crossing baseline. Alert Card SLAMS from 3.5x @ f1180. Trailer BRAAM hit & camera shake. |
| **8** | 1350–1470 | 45.0–49.0s | Proof | Bedside decision support | "At the bedside: knowing what still works. Protecting what remains." | Real Bedside Guidance Card: Meropenem 96.5% S vs Ciprofloxacin compromised. Cursor clicks "Select for Order". Haptic UI pop. |
| **9** | 1470–1800 | 49.0–60.0s | CTA | Saving humanity's shield | "We are defending the shield that built the modern world. AEI Pulse. Tyks Laboratories." | Protective shield reassembles. Tyks Laboratories signature brand lockup. Resolved hold 1.17s (f1765-f1800). Warm pad tail. |
