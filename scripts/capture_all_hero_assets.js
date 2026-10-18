const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT_DIR = path.resolve(__dirname, '../film/media');

async function captureRun(scale = 1, prefix = '') {
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: scale,
  });

  const page = await context.newPage();
  const results = [];

  // ------------------------------------------
  // 1. OVERVIEW PAGE (/)
  // ------------------------------------------
  console.log(`[Scale ${scale}x] Capturing Overview (/) ...`);
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  if (scale === 1) {
    const p = path.join(OUT_DIR, 'screen_overview.png');
    await page.screenshot({ path: p });
    results.push({
      id: 'screen_overview',
      file: 'screen_overview.png',
      route: '/',
      type: 'full_viewport',
      description: 'AEI Pulse Main Overview: 1,212 isolates rolling window, 4 KPI cards, hospital-wide resistance trend chart, 8 significant alerts card (ICU E. coli resistance drop to Ciprofloxacin), specimen distribution, and top organisms.',
      box: { x: 0, y: 0, width: 1920, height: 1080 }
    });
  }

  // 1a. ICU Alert Card
  const alertCard = page.locator('h2:has-text("significant alert")').locator('xpath=../..');
  if (await alertCard.count()) {
    const box = await alertCard.boundingBox();
    const fileName = `crop_icu_alert${prefix}.png`;
    const p = path.join(OUT_DIR, fileName);
    await alertCard.screenshot({ path: p });
    results.push({
      id: `crop_icu_alert${prefix}`,
      file: fileName,
      route: '/',
      type: scale === 1 ? 'hero_crop' : 'hero_crop_macro_2x',
      description: 'ICU Anomaly Alert Card: 8 significant alerts, critical alert: Escherichia coli resistance to Ciprofloxacin [high] in ICU changed from 75% to 37.3% susceptible (z = -5.8) with 28-day daily resistance bar series.',
      box
    });
    console.log(`  Saved ${fileName}`);
  }

  // 1b. Resistance Trend Chart Card
  const trendH2 = page.locator('h2:has-text("Resistance trend over time")');
  if (await trendH2.count()) {
    const trendCard = trendH2.locator('xpath=ancestor::div[contains(@class, "rounded-[10px]")][1]');
    if (await trendCard.count()) {
      const box = await trendCard.boundingBox();
      const fileName = `crop_trend_chart${prefix}.png`;
      const p = path.join(OUT_DIR, fileName);
      await trendCard.screenshot({ path: p });
      results.push({
        id: `crop_trend_chart${prefix}`,
        file: fileName,
        route: '/',
        type: 'hero_crop',
        description: 'Hospital-wide Resistance Trend Chart Card: 4-week daily longitudinal trends across key antibiotic classes with interactive hover states and legend.',
        box
      });
      console.log(`  Saved ${fileName}`);
    }
  }

  // 1c. KPI Row
  const kpiEl = page.locator('text=vs previous 4 weeks').first();
  if (await kpiEl.count()) {
    const kpiGrid = kpiEl.locator('xpath=ancestor::div[contains(@class, "grid")][1]');
    if (await kpiGrid.count()) {
      const box = await kpiGrid.boundingBox();
      const fileName = `crop_kpi_row${prefix}.png`;
      const p = path.join(OUT_DIR, fileName);
      await kpiGrid.screenshot({ path: p });
      results.push({
        id: `crop_kpi_row${prefix}`,
        file: fileName,
        route: '/',
        type: 'hero_crop',
        description: 'Hospital Surveillance KPIs: Total isolates (1,212), Resistant isolates (64.3%), Most common organism (E. coli 42.7%), Highest resistance (S. aureus to Penicillin 81.9%).',
        box
      });
      console.log(`  Saved ${fileName}`);
    }
  }

  // 1d. Antibiogram Heatmap Matrix Card
  const hmH2 = page.locator('h2:has-text("Resistance by organism and antibiotic")');
  if (await hmH2.count()) {
    const hmCard = hmH2.locator('xpath=ancestor::div[contains(@class, "rounded-[10px]")][1]');
    if (await hmCard.count()) {
      await hmCard.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      const box = await hmCard.boundingBox();
      const fileName = `crop_antibiogram_matrix${prefix}.png`;
      const p = path.join(OUT_DIR, fileName);
      await hmCard.screenshot({ path: p });
      results.push({
        id: `crop_antibiogram_matrix${prefix}`,
        file: fileName,
        route: '/',
        type: 'hero_crop',
        description: 'Antibiogram Heatmap Matrix: 9 organisms x 7 antibiotics cross-tabulation with EUCAST color banding and isolate counts.',
        box
      });
      console.log(`  Saved ${fileName}`);
    }
  }

  // ------------------------------------------
  // 2. EARLY WARNING PAGE (/early-warning)
  // ------------------------------------------
  console.log(`[Scale ${scale}x] Capturing Early Warning (/early-warning) ...`);
  await page.goto('http://localhost:3000/early-warning', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  if (scale === 1) {
    const p = path.join(OUT_DIR, 'screen_early_warning.png');
    await page.screenshot({ path: p });
    results.push({
      id: 'screen_early_warning',
      file: 'screen_early_warning.png',
      route: '/early-warning',
      type: 'full_viewport',
      description: 'AEI Pulse Early Warning & Transmission Center: False alarm budget meter, Warning Feed, Transmission Map network, and MDRO cards.',
      box: { x: 0, y: 0, width: 1920, height: 1080 }
    });
  }

  // 2a. Transmission Map Card
  const tmH2 = page.locator('h2:has-text("Transmission map")');
  if (await tmH2.count()) {
    const tmCard = tmH2.locator('xpath=ancestor::div[contains(@class, "rounded-[10px]")][1]');
    if (await tmCard.count()) {
      await tmCard.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      const box = await tmCard.boundingBox();
      const fileName = `crop_transmission_map${prefix}.png`;
      const p = path.join(OUT_DIR, fileName);
      await tmCard.screenshot({ path: p });
      results.push({
        id: `crop_transmission_map${prefix}`,
        file: fileName,
        route: '/early-warning',
        type: 'hero_crop',
        description: 'Hospital Ward Transmission Map Card: Directed patient transfer network, central ICU node, ED triage gateway, peripheral health centres, and playback scrubber.',
        box
      });
      console.log(`  Saved ${fileName}`);

      // 2b. Pure SVG network (for ff-tracking HUD telemetry overlay)
      const tmSvg = tmCard.locator('svg[viewBox="0 0 900 440"]').first();
      if (await tmSvg.count()) {
        const svgBox = await tmSvg.boundingBox();
        const svgFileName = `crop_transmission_network${prefix}.png`;
        const svgP = path.join(OUT_DIR, svgFileName);
        await tmSvg.screenshot({ path: svgP });
        results.push({
          id: `crop_transmission_network${prefix}`,
          file: svgFileName,
          route: '/early-warning',
          type: scale === 1 ? 'hero_crop' : 'hero_crop_macro_2x',
          description: 'Transmission Network HUD Vector SVG: Pure vector nodes (ICU, Emergency, Surgery, ID Ward, LTC) and curved transmission arcs matching ff-tracking telemetry.',
          box: svgBox
        });
        console.log(`  Saved ${svgFileName}`);
      }
    }
  }

  // 2c. Warning Feed Card
  const feedH2 = page.locator('h2:has-text("Warning feed")');
  if (await feedH2.count()) {
    const feedCard = feedH2.locator('xpath=ancestor::div[contains(@class, "rounded-[10px]")][1]');
    if (await feedCard.count()) {
      await feedCard.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      const box = await feedCard.boundingBox();
      const fileName = `crop_warning_feed${prefix}.png`;
      const p = path.join(OUT_DIR, fileName);
      await feedCard.screenshot({ path: p });
      results.push({
        id: `crop_warning_feed${prefix}`,
        file: fileName,
        route: '/early-warning',
        type: 'hero_crop',
        description: 'Warning Feed: High, moderate, and watch severity alerts with MDRO chips and outbreak evidence hypotheses.',
        box
      });
      console.log(`  Saved ${fileName}`);
    }
  }

  // 2d. Patient Pathways Card
  const pathH2 = page.locator('h2:has-text("Patient pathways")');
  if (await pathH2.count()) {
    const pathCard = pathH2.locator('xpath=ancestor::div[contains(@class, "rounded-[10px]")][1]');
    if (await pathCard.count()) {
      await pathCard.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      const box = await pathCard.boundingBox();
      const fileName = `crop_outbreak_pathways${prefix}.png`;
      const p = path.join(OUT_DIR, fileName);
      await pathCard.screenshot({ path: p });
      results.push({
        id: `crop_outbreak_pathways${prefix}`,
        file: fileName,
        route: '/early-warning',
        type: 'hero_crop',
        description: 'Patient Pathways & Outbreak Spread: Inter-ward patient transition matrix showing transmission vectors into ICU.',
        box
      });
      console.log(`  Saved ${fileName}`);
    }
  }

  // ------------------------------------------
  // 3. GUIDANCE PAGE (/guidance)
  // ------------------------------------------
  console.log(`[Scale ${scale}x] Capturing Guidance (/guidance) ...`);
  await page.goto('http://localhost:3000/guidance', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Click starter question: "Best antibiotic for E. coli?"
  const starterBtn = page.locator('button:has-text("Best antibiotic for E. coli?")').first();
  if (await starterBtn.count()) {
    await starterBtn.click();
    await page.waitForTimeout(3500);
  }

  if (scale === 1) {
    const p = path.join(OUT_DIR, 'screen_guidance.png');
    await page.screenshot({ path: p });
    results.push({
      id: 'screen_guidance',
      file: 'screen_guidance.png',
      route: '/guidance',
      type: 'full_viewport',
      description: 'Antibiotic Guidance Interface: Interactive AI clinical advisor computing live empiric recommendations from surveillance isolates.',
      box: { x: 0, y: 0, width: 1920, height: 1080 }
    });
  }

  // 3a. Guidance Answer & Susceptibility Table Card
  const tableLocator = page.locator('table').first();
  if (await tableLocator.count()) {
    const tableContainer = tableLocator.locator('xpath=ancestor::div[contains(@class, "border-t")][1]');
    if (await tableContainer.count()) {
      const box = await tableContainer.boundingBox();
      const fileName = `crop_guidance_card${prefix}.png`;
      const p = path.join(OUT_DIR, fileName);
      await tableContainer.screenshot({ path: p });
      results.push({
        id: `crop_guidance_card${prefix}`,
        file: fileName,
        route: '/guidance',
        type: scale === 1 ? 'hero_crop' : 'hero_crop_macro_2x',
        description: 'Empiric Bedside Guidance Card: AI recommendation for E. coli, including susceptibility rankings (% S) and isolate counts (n).',
        box
      });
      console.log(`  Saved ${fileName}`);
    }
  }

  // ------------------------------------------
  // 4. SITREP PAGE (/sitrep)
  // ------------------------------------------
  console.log(`[Scale ${scale}x] Capturing Sitrep (/sitrep) ...`);
  await page.goto('http://localhost:3000/sitrep', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  if (scale === 1) {
    const p = path.join(OUT_DIR, 'screen_sitrep.png');
    await page.screenshot({ path: p });
    results.push({
      id: 'screen_sitrep',
      file: 'screen_sitrep.png',
      route: '/sitrep',
      type: 'full_viewport',
      description: 'Hospital Situation Report (Sitrep): Executive clinical briefing on AMR metrics, ICU status, and containment actions.',
      box: { x: 0, y: 0, width: 1920, height: 1080 }
    });
  }

  // 4a. Sitrep Document Card
  const sitrepH2 = page.locator('h2:has-text("resistance sitrep")');
  if (await sitrepH2.count()) {
    const sitrepCard = sitrepH2.locator('xpath=ancestor::div[contains(@class, "rounded-[10px]")][1]');
    if (await sitrepCard.count()) {
      const box = await sitrepCard.boundingBox();
      const fileName = `crop_sitrep_doc${prefix}.png`;
      const p = path.join(OUT_DIR, fileName);
      await sitrepCard.screenshot({ path: p });
      results.push({
        id: `crop_sitrep_doc${prefix}`,
        file: fileName,
        route: '/sitrep',
        type: 'hero_crop',
        description: 'Sitrep Clinical Intelligence Document: Structured ward-level outbreak brief, pathogen shifts, and infection control checklists.',
        box
      });
      console.log(`  Saved ${fileName}`);
    }
  }

  await browser.close();
  return results;
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  console.log('=== CAPTURING 1x BASE SCREENS & CROPS ===');
  const res1x = await captureRun(1, '');

  console.log('=== CAPTURING 2x HIGH-DPI MACRO CROPS ===');
  const res2x = await captureRun(2, '_2x');

  const allManifest = [...res1x, ...res2x];
  fs.writeFileSync(path.join(OUT_DIR, 'screens_manifest.json'), JSON.stringify(allManifest, null, 2));
  console.log(`Manifest updated with ${allManifest.length} items at film/media/screens_manifest.json`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
