/**
 * Browser measurement harness: per screen, on a 4× throttled CPU, report
 *   - bytes transferred (resource timing, /api/ requests only)
 *   - round trips (request count)
 *   - longest main-thread task during the screen's load (longtask entries)
 *   - wall time for the screen to become usable
 *
 *   node scripts/measure.mjs [baseURL]        # default http://127.0.0.1:3000
 *
 * Logs in with the e2e credentials (creating them if the database is fresh),
 * then drives a real Chromium via Playwright. Run it once against the masked
 * dataset and once against the 10× database (see scripts/grow10x.mjs).
 */
import { chromium, request } from '@playwright/test';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const CREDS = { username: 'e2e-admin', name: 'E2E Admin', password: 'e2e-password-123' };

const results = [];
const fmtKB = (bytes) => (bytes / 1024).toFixed(1);

async function login(request) {
  let res = await request.post('/api/auth/signup', { data: CREDS });
  if (res.status() === 409) res = await request.post('/api/auth/login', { data: { username: CREDS.username, password: CREDS.password } });
  if (!res.ok()) throw new Error(`login failed: ${res.status()}`);
  return request.storageState();
}

async function screen(page, name, { goto, prepare, done }) {
  // fresh counters
  await page.evaluate(() => {
    window.__lt = [];
    window.__t0 = performance.now();
  });
  const t0 = Date.now();
  await goto();
  if (prepare) await prepare();
  await done();
  const wall = Date.now() - t0;
  const metrics = await page.evaluate(() => {
    const lt = Array.isArray(window.__lt) ? window.__lt : [];
    const start = typeof window.__t0 === 'number' ? window.__t0 : 0;
    const api = performance
      .getEntriesByType('resource')
      .filter((e) => e.name.includes('/api/') && e.startTime >= start);
    return {
      requests: api.length,
      bytes: api.reduce((s, e) => s + (e.transferSize || 0), 0),
      longtask: lt.length ? Math.max(...lt) : 0,
    };
  });
  results.push({ name, wall, ...metrics });
  console.log(
    `  ${name.padEnd(28)} ${String(metrics.requests).padStart(3)} req · ${fmtKB(metrics.bytes).padStart(7)} KB · task ${Math.round(metrics.longtask).toString().padStart(4)} ms · wall ${wall} ms`
  );
}

(async () => {
  const requestContext = await request.newContext({ baseURL: BASE });
  const storage = await login(requestContext);

  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: storage, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // CPU: 4× slower — the office-PC stand-in from the brief.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  await page.addInitScript(() => {
    window.__lt = [];
    window.__t0 = performance.now();
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__lt.push(e.duration);
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      /* not supported */
    }
  });

  // one material with stock to type into the editor
  const stock = await (await requestContext.get('/api/stock-levels?limit=1')).json();
  const materialId = stock.rows[0]?.id;
  const material = await (await requestContext.get(`/api/materials/${materialId}/stock`)).json();
  const needle = material.material.model_number || material.material.name;

  console.log(`\nmeasuring ${BASE} at 4× CPU throttle\n`);

  await screen(page, 'cold dashboard', {
    goto: () => page.goto(`${BASE}/#/dashboard`),
    done: () => page.locator('.grid-stats .stat').first().waitFor(),
  });

  await screen(page, 'invoice list (25 rows)', {
    goto: () => page.goto(`${BASE}/#/invoices`),
    done: () => page.locator('#invoice-table tbody tr').first().waitFor(),
  });

  await screen(page, 'invoice editor open', {
    goto: () => page.goto(`${BASE}/#/invoice/new`),
    done: () => page.locator('#m-search').waitFor(),
  });

  await screen(page, 'material search (typed)', {
    goto: () => Promise.resolve(),
    prepare: async () => {
      await page.fill('#m-search', needle);
      await page.locator('.combo-item').first().waitFor();
    },
    done: () => page.waitForTimeout(150), // let the debounce settle
  });

  await screen(page, 'save invoice (incl. view)', {
    goto: () => Promise.resolve(),
    prepare: async () => {
      await page.locator('.combo-item').first().click();
      await page.locator('.batch.selected').waitFor();
      await page.click('#m-add');
      await page.locator('#d-lines tbody tr').first().waitFor();
    },
    done: async () => {
      await page.click('#d-save');
      await page.waitForURL(/#\/invoice\/[0-9a-f-]{36}/); // precise: not /invoice/new
      await page.locator('.page-head .badge').waitFor();
    },
  });

  await screen(page, 'stock levels (25 rows)', {
    goto: () => page.goto(`${BASE}/#/stock`),
    done: () => page.locator('#st-table tbody tr').first().waitFor(),
  });

  await screen(page, 'palette search', {
    goto: () => page.goto(`${BASE}/#/dashboard`),
    done: async () => {
      await page.locator('.grid-stats .stat').first().waitFor();
      await page.keyboard.press('Control+k');
      await page.fill('#palette-input', needle.slice(0, 5));
      await page.locator('.palette-item').first().waitFor();
    },
  });

  console.log('');
  const worst = Math.max(...results.map((r) => r.longtask));
  console.log(`longest main-thread task across all screens: ${Math.round(worst)} ms (target: < 200 ms at 4×)`);
  console.log(`total bytes for six screens: ${fmtKB(results.reduce((s, r) => s + r.bytes, 0))} KB`);

  await browser.close();
  await requestContext.dispose();
})();
