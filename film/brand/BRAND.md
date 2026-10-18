# AEI Pulse

Source: http://localhost:3777/  |  captured 2026-10-18  |  theme: **light**

Tagline / hero: **Antimicrobial Resistance Overview**

Description: Rolling, real-time antimicrobial resistance surveillance for Tyks Laboratories

## Palette

| hex | role | notes |
|---|---|---|
| `#fcfcfd` | ground (light theme) | 85% of area |
| `#eeeae9` | surface/ground 2 | 7% of area |
| `#14171c` | ink (headline / logo ink) | contrast 17.5:1 on ground |
| `#5b6472` | ink-soft (body copy) | contrast 5.8:1 on ground |
| `#0f6b7c` | accent (primary) | css var --primary, logo, link, text, background |
| `#fde2b1` | accent 2 | screenshot pixels, background |

Accent candidates (from imagery): `#2562e9` from screens/02.jpg (0.22% of pixels), `#16a349` from screens/02.jpg (0.06% of pixels), `#48878c` from screens/02.jpg (0.04% of pixels), `#da2525` from screens/02.jpg (0.04% of pixels)

Brand CSS variables: --background=#f5f6f7, --primary=#0f6b7c, --primary-foreground=#ffffff

## Fonts

- heading: **IBM Plex Sans** weight 700, 20px (no file: system/fallback)
- body: **IBM Plex Sans** weight 400, 13px (no file: system/fallback)
- nav: **IBM Plex Sans** weight 600, 13.5px (no file: system/fallback)

Downloaded: fonts/ibm-plex-sans-400.woff2, fonts/ibm-plex-mono-400.woff2

## Logo

- `logo/logo.svg` (inline svg (home-link,header,top)) fills: #0f6b7c (dark mark: place on light ground)

## Copy

H1: "Antimicrobial Resistance Overview"

H2:
- Resistance trend over time
- 8 significant alerts
- Resistance by organism and antibiotic
- Automated insights
- Specimen type distribution
- Top organisms
- Recent isolates

CTAs: none found

Nav: Overview | Early Warning | Antibiotic Guidance

Product sentences:
- Emerging signal — Escherichia coli resistance to Ciprofloxacin on ICU: susceptible share fell 37.8 pp to 37.3% in the last 4 weeks (z −5.8, n=51).
- Comparative — Escherichia coli resistance to Ciprofloxacin on ICU is 62.7% in the current window, vs 25.3% hospital-wide (n=518).
- Panel note — Meropenem remains the most active standard option against Escherichia coli in the current window (3.5% resistant, n=487).

## Assets

- screens/01.jpg (scroll 0px)
- screens/02.jpg (scroll 398px)
- board.png (one-image overview)

## Warnings

- page is short (1478px): only 2 screenshots
- favicon fetch failed (http://localhost:3777/favicon.ico): HTTP 404
- heading font "IBM Plex Sans" has no downloadable file (system font or blocked)
- body font "IBM Plex Sans" has no downloadable file (system font or blocked)
