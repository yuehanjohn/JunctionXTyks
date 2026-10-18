const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT_DIR = path.resolve(__dirname, '../film/media');

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();

  console.log('--- 1. OVERVIEW PAGE ---');
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  // Check Alert Card
  // In AlertCard, it has h2 with "significant alerts" or link to /alerts
  const alertCard = await page.locator('div:has(h2:has-text("significant alert"))').first();
  if (await alertCard.count()) {
    const box = await alertCard.boundingBox();
    console.log('Alert Card box:', box);
    const alertCardPath = path.join(OUT_DIR, 'crop_icu_alert.png');
    await alertCard.screenshot({ path: alertCardPath });
    console.log('Saved crop_icu_alert.png');
  } else {
    console.warn('Alert Card not found!');
  }

  // Check Trend Chart / Hero Chart
  const trendCard = await page.locator('div:has(h2:has-text("hospital-wide trend"))').first();
  if (await trendCard.count()) {
    const box = await trendCard.boundingBox();
    console.log('Trend Card box:', box);
    const trendPath = path.join(OUT_DIR, 'crop_trend_chart.png');
    await trendCard.screenshot({ path: trendPath });
    console.log('Saved crop_trend_chart.png');
  }

  // Check KPI row
  const kpiRow = await page.locator('div:has(div:has-text("Current window"))').first();
  if (await kpiRow.count()) {
    const box = await kpiRow.boundingBox();
    console.log('KPI Row box:', box);
  }

  console.log('--- 2. EARLY WARNING PAGE ---');
  await page.goto('http://localhost:3000/early-warning', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  // Transmission map SVG card
  const mapCard = await page.locator('div:has(h2:has-text("Transmission Map"))').first();
  if (await mapCard.count()) {
    const box = await mapCard.boundingBox();
    console.log('Transmission Map Card box:', box);
    const mapPath = path.join(OUT_DIR, 'crop_transmission_map.png');
    await mapCard.screenshot({ path: mapPath });
    console.log('Saved crop_transmission_map.png');
  }

  // SVG itself for pure node network
  const mapSvg = await page.locator('svg[viewBox="0 0 960 430"]').first();
  if (await mapSvg.count()) {
    const box = await mapSvg.boundingBox();
    console.log('Transmission Map SVG box:', box);
    const svgPath = path.join(OUT_DIR, 'crop_transmission_network.png');
    await mapSvg.screenshot({ path: svgPath });
    console.log('Saved crop_transmission_network.png');
  }

  // Outbreak pathways card
  const pathwaysCard = await page.locator('div:has(h2:has-text("Outbreak Pathways"))').first();
  if (await pathwaysCard.count()) {
    const box = await pathwaysCard.boundingBox();
    console.log('Pathways Card box:', box);
    const pathPath = path.join(OUT_DIR, 'crop_outbreak_pathways.png');
    await pathwaysCard.screenshot({ path: pathPath });
    console.log('Saved crop_outbreak_pathways.png');
  }

  // Warning feed card
  const feedCard = await page.locator('div:has(h2:has-text("Warning Feed"))').first();
  if (await feedCard.count()) {
    const box = await feedCard.boundingBox();
    console.log('Warning Feed Card box:', box);
    const feedPath = path.join(OUT_DIR, 'crop_warning_feed.png');
    await feedCard.screenshot({ path: feedPath });
    console.log('Saved crop_warning_feed.png');
  }

  // MDRO Ward Card
  const mdroCard = await page.locator('div:has(h2:has-text("MDRO Ward Heatmap"))').first();
  if (await mdroCard.count()) {
    const box = await mdroCard.boundingBox();
    console.log('MDRO Card box:', box);
    const mdroPath = path.join(OUT_DIR, 'crop_mdro_ward.png');
    await mdroCard.screenshot({ path: mdroPath });
    console.log('Saved crop_mdro_ward.png');
  }

  console.log('--- 3. GUIDANCE PAGE ---');
  await page.goto('http://localhost:3000/guidance', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Click starter question
  const starterButtons = await page.$$('button');
  for (const btn of starterButtons) {
    const text = await btn.innerText();
    if (text.includes('Best antibiotic for E. coli?')) {
      console.log('Clicking starter question:', text);
      await btn.click();
      await page.waitForTimeout(3000);
      break;
    }
  }

  // Assistant answer card / recommendation table
  const answerCard = await page.locator('div:has(table)').first();
  if (await answerCard.count()) {
    const box = await answerCard.boundingBox();
    console.log('Guidance Answer Card box:', box);
    const ansPath = path.join(OUT_DIR, 'crop_guidance_card.png');
    await answerCard.screenshot({ path: ansPath });
    console.log('Saved crop_guidance_card.png');
  }

  console.log('--- 4. SITREP PAGE ---');
  await page.goto('http://localhost:3000/sitrep', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Sitrep document container
  const sitrepCard = await page.locator('div:has(h1)').first();
  if (await sitrepCard.count()) {
    const box = await sitrepCard.boundingBox();
    console.log('Sitrep Card box:', box);
    const sitrepCropPath = path.join(OUT_DIR, 'crop_sitrep_doc.png');
    await sitrepCard.screenshot({ path: sitrepCropPath });
    console.log('Saved crop_sitrep_doc.png');
  }

  await browser.close();
  console.log('Inspection and cropping complete!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
