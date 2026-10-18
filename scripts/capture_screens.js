const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT_DIR = path.resolve(__dirname, '../film/media');

async function main() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();

  // 1. Overview page (/)
  console.log('Navigating to / ...');
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000); // ensure data loads and charts render

  const overviewPath = path.join(OUT_DIR, 'screen_overview.png');
  await page.screenshot({ path: overviewPath, fullPage: false });
  console.log('Saved:', overviewPath);

  // 2. Early Warning (/early-warning)
  console.log('Navigating to /early-warning ...');
  await page.goto('http://localhost:3000/early-warning', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  const ewPath = path.join(OUT_DIR, 'screen_early_warning.png');
  await page.screenshot({ path: ewPath, fullPage: false });
  console.log('Saved:', ewPath);

  // 3. Guidance (/guidance)
  console.log('Navigating to /guidance ...');
  await page.goto('http://localhost:3000/guidance', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // On guidance page, click the first starter question
  try {
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
  } catch (e) {
    console.warn('Guidance starter click error:', e.message);
  }

  const guidancePath = path.join(OUT_DIR, 'screen_guidance.png');
  await page.screenshot({ path: guidancePath, fullPage: false });
  console.log('Saved:', guidancePath);

  // 4. Sitrep (/sitrep)
  console.log('Navigating to /sitrep ...');
  await page.goto('http://localhost:3000/sitrep', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  const sitrepPath = path.join(OUT_DIR, 'screen_sitrep.png');
  await page.screenshot({ path: sitrepPath, fullPage: false });
  console.log('Saved:', sitrepPath);

  await browser.close();
  console.log('Capture finished successfully!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
