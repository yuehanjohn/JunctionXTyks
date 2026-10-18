import { launchChrome } from '/mnt/c/Users/Asus/.omp/agent/skills/motionmaxxing/scripts/_cdp.mjs';

const br = await launchChrome({});
const page = await br.newPage({ width: 1920, height: 1080 });
const errs = [];
page.on('console', msg => { if (msg.type === 'error') errs.push(msg.text); });
page.on('pageerror', err => { errs.push(String(err)); });
await page.goto('file:///mnt/c/Users/Asus/Desktop/dev/JunctionXTyks/film/index.html');
const res = await page.eval(`(() => {
  return {
    eventsCount: window.__events ? window.__events.length : 0,
    first10Events: window.__events ? window.__events.slice(0, 10) : []
  };
})()`);
console.log('Events Result:', res);
console.log('Errors:', errs);
await br.close();
