/**
 * Why are some tasks >200 ms in the harness? This script measures three
 * configurations of the same screens to separate OUR work from the harness
 * environment (headless software rendering re-rasterizes blur and animation
 * on the CPU):
 *
 *   default          as shipped
 *   reduced motion   entrance animations + count-up disabled (--reduced)
 *   no blur          backdrop-filter removed (headless raster cost)
 *
 *   node scripts/perf-variants.mjs [baseURL]
 */
import { chromium, request } from '@playwright/test';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const CREDS = { username: 'e2e-admin', name: 'E2E Admin', password: 'e2e-password-123' };

const NO_BLUR = '.topbar{backdrop-filter:none!important}.palette-backdrop{backdrop-filter:none!important}.modal-backdrop{backdrop-filter:none!important}';

async function run(label, { reduced = false, css = null } = {}) {
  const api = await request.newContext({ baseURL: BASE });
  let res = await api.post('/api/auth/signup', { data: CREDS });
  if (res.status() === 409) res = await api.post('/api/auth/login', { data: { username: CREDS.username, password: CREDS.password } });
  const storage = await api.storageState();
  await api.dispose();

  const browser = await chromium.launch();
  const context = await browser.newContext({
    storageState: storage,
    viewport: { width: 1440, height: 900 },
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  if (css) await page.addInitScript((c) => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = c;
      document.head.appendChild(s);
    });
  }, css);

  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    window.__lt = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__lt.push(e.duration);
      }).observe({ type: 'longtask', buffered: true });
    } catch { /* unsupported */ }
  });

  const task = async (fn) => {
    await page.evaluate(() => (window.__lt = []));
    await fn();
    const lt = await page.evaluate(() => (Array.isArray(window.__lt) ? Math.max(0, ...window.__lt) : 0));
    return Math.round(lt);
  };

  const dash = await task(async () => {
    await page.goto(`${BASE}/#/dashboard`);
    await page.locator('.grid-stats .stat').first().waitFor();
    await page.waitForTimeout(400); // let animations/counters finish
  });
  const editor = await task(async () => {
    await page.goto(`${BASE}/#/invoice/new`);
    await page.locator('#m-search').waitFor();
    await page.waitForTimeout(400);
  });
  const palette = await task(async () => {
    await page.goto(`${BASE}/#/dashboard`);
    await page.locator('.grid-stats .stat').first().waitFor();
    await page.keyboard.press('Control+k');
    await page.fill('#palette-input', 'inv');
    await page.locator('.palette-item').first().waitFor();
  });

  console.log(`  ${label.padEnd(16)} dashboard ${String(dash).padStart(4)} ms · editor ${String(editor).padStart(4)} ms · palette ${String(palette).padStart(4)} ms`);
  await browser.close();
}

console.log(`\nperf variants at 4× throttle against ${BASE}\n`);
await run('default');
await run('reduced motion', { reduced: true });
await run('no blur', { css: NO_BLUR });
await run('reduced+no blur', { reduced: true, css: NO_BLUR });
console.log('');
