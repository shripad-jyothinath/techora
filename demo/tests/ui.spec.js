import { test, expect } from '@playwright/test';
import { resetToSampleData } from './helpers.js';

/**
 * Browser flows against the signed-in session (project storageState).
 * Auth-screen flows live in ui.auth.spec.js, which opts out of the session.
 */
test.beforeAll(async ({ request }) => {
  await resetToSampleData(request);
});

/* -------------------------------------------------------------- dashboard */

test('dashboard shows live KPIs, a chart and the activity feed', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.grid-stats .stat')).toHaveCount(4);
  await expect(page.locator('#stat-out')).not.toHaveText('$0.00'); // count-up lands
  await expect(page.locator('.chart .bar')).toHaveCount(6);
  await expect(page.locator('#view .card .feed[data-feed]')).toBeVisible();
});

/* ----------------------------------------------------------- invoice list */

test('invoice list: search narrows, sort toggles, keyset paging works, rows open', async ({ page, request }) => {
  const first = await (await request.get('/api/invoices?limit=1')).json();
  const number = first.rows[0].invoice_number;

  await page.goto('/#/invoices');
  await expect(page.locator('#invoice-table tbody tr').first()).toBeVisible();

  await page.fill('#inv-q', number);
  await expect(page.locator('#invoice-table tbody tr')).toHaveCount(1);
  await expect(page.locator('#invoice-table tbody td').first()).toHaveText(number);

  await page.fill('#inv-q', '');
  await expect(page.locator('#invoice-table tbody tr')).toHaveCount(25);

  await page.click('#invoice-table th[data-sort="total"]');
  await expect(page.locator('#invoice-table th[data-sort="total"] .arrow')).toHaveText(/[▲▼]/);

  await page.click('#inv-next');
  await expect(page.locator('#inv-page-info')).toHaveText(/26–50/);
  await page.click('#inv-prev');
  await expect(page.locator('#inv-page-info')).toHaveText(/1–25/);

  await page.locator('#invoice-table tr.clickable').first().click();
  await expect(page).toHaveURL(/#\/invoice\//);
  await expect(page.locator('h1')).toHaveText(/Invoice /);
});

/* ----------------------------------------------------------- invoice view */

test('invoice view: mark as paid flips the badge exactly once', async ({ page, request }) => {
  const sent = await (await request.get('/api/invoices?status=sent&limit=1')).json();
  const { id, invoice_number: number } = sent.rows[0];

  await page.goto(`/#/invoice/${id}`);
  await expect(page.locator('h1')).toContainText(number);
  await expect(page.locator('.page-head .badge')).toHaveText('sent');

  await page.click('#inv-pay');
  await expect(page.locator('.page-head .badge')).toHaveText('paid');
  await expect(page.locator('.toast')).toContainText(/paid/i);
  await expect(page.locator('#inv-pay')).toHaveCount(0);
});

/* --------------------------------------------------------------- editor */

test('invoice editor: search a model, pick a batch, add a line, save', async ({ page, request }) => {
  const list = await (await request.get('/api/stock-levels?limit=10')).json();
  const material = list.rows.find((r) => r.model_number);
  expect(material).toBeTruthy();

  await page.goto('/#/invoice/new');
  await page.fill('#m-search', material.model_number);
  await expect(page.locator('.combo-item').first()).toBeVisible();
  await page.locator('.combo-item').first().click();

  await expect(page.locator('#stock-panel .badge')).toContainText('available');
  await expect(page.locator('.batch.selected')).toBeVisible();
  await expect(page.locator('#m-add')).toBeEnabled();

  await page.click('#m-add');
  await expect(page.locator('#d-lines tbody tr')).toHaveCount(1);
  await expect(page.locator('#t-total')).not.toHaveText('$0.00');

  await page.click('#d-save');
  await expect(page).toHaveURL(/#\/invoice\//);
  await expect(page.locator('h1')).toHaveText(/Invoice /);
  await expect(page.locator('.toast')).toContainText('Invoice saved');
});

test('editor reacts live to a colleague selling the stock it holds (SSE)', async ({ page, request }) => {
  const setup = await (await request.post('/api/demo/setup-material', { data: {} })).json();
  const materialId = setup.material.id;

  await page.goto(`/#/invoice/new?material=${encodeURIComponent(materialId)}`);
  await expect(page.locator('#stock-panel .badge')).toHaveText('12 available');

  await request.post('/api/demo/colleague-sale', { data: { material_id: materialId, quantity: 10 } });

  await expect(page.locator('.banner.warn')).toContainText('Stock changed');
  await expect(page.locator('#stock-panel .badge')).toHaveText('2 available');
});

test('navigating away right after a save does not race the refresh', async ({ page, request }) => {
  // regression: an SSE-triggered refresh used to race the next navigation and
  // wipe the newer view's DOM mid-load
  const list = await (await request.get('/api/stock-levels?limit=10')).json();
  const material = list.rows.find((r) => r.model_number);

  await page.goto('/#/invoice/new');
  await page.fill('#m-search', material.model_number);
  await page.locator('.combo-item').first().waitFor();
  await page.locator('.combo-item').first().click();
  await page.locator('.batch.selected').waitFor();
  await page.click('#m-add');
  await page.click('#d-save');
  await expect(page).toHaveURL(/#\/invoice\/[0-9a-f-]{36}/);

  // immediately jump to stock while the save's SSE refresh is still in flight
  await page.click('#nav a[data-nav="stock"]');
  await expect(page.locator('#st-table tbody tr').first()).toBeVisible();
  await expect(page.locator('#st-info')).toContainText('page');
});

/* ---------------------------------------------------------------- stock */

test('stock levels: expand shows batches, movements link opens the report', async ({ page }) => {
  await page.goto('/#/stock');
  const row = page.locator('#st-table tr.clickable').first();
  await expect(row).toBeVisible();

  await row.click();
  await expect(page.locator('tr.batch-detail:not(.hidden)')).toBeVisible();
  await expect(row.locator('.chev')).toHaveText('▾');
  await expect(page.locator('tr.batch-detail:not(.hidden) table tbody tr').first()).toBeVisible();

  await row.click();
  await expect(page.locator('tr.batch-detail:not(.hidden)')).toHaveCount(0);

  await row.click();
  await page.locator('tr.batch-detail:not(.hidden) a').first().click();
  await expect(page).toHaveURL(/#\/movements\//);
  await expect(page.locator('#mv-table table')).toBeVisible();

  await page.fill('#mv-from', '2030-01-01');
  await expect(page.locator('#mv-table')).toContainText('No movements in this range');
  await page.click('#mv-clear');
  await expect(page.locator('#mv-table tbody tr').first()).toBeVisible();
});

/* -------------------------------------------------------------- palette */

test('command palette: Ctrl+K, search, actions, Escape', async ({ page, request }) => {
  const first = await (await request.get('/api/invoices?limit=1')).json();
  const number = first.rows[0].invoice_number;

  await page.goto('/#/dashboard');
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette')).toBeVisible();

  await page.fill('#palette-input', number);
  await expect(page.locator('.palette-group').first()).toHaveText('Invoices');
  await expect(page.locator('.palette-item').first()).toContainText(number);

  await page.keyboard.press('Escape');
  await expect(page.locator('#palette')).toBeHidden();

  await page.click('#palette-trigger');
  await page.fill('#palette-input', number);
  await page.locator('.palette-item', { hasText: 'All invoices matching' }).click();
  await expect(page).toHaveURL(new RegExp(`#/invoices\\?q=${number}`));
  await expect(page.locator('#inv-q')).toHaveValue(number);
  await expect(page.locator('#invoice-table tbody tr')).toHaveCount(1);
});

/* ------------------------------------------------------------ demo tools */

test('demo tools: wipe asks for confirmation and cancelling changes nothing', async ({ page, request }) => {
  const before = await (await request.get('/api/meta')).json();

  await page.goto('/#/dashboard');
  await page.click('#demo-toggle');
  await page.click('#demo-wipe');
  await expect(page.locator('#modal .modal')).toBeVisible();
  await expect(page.locator('#modal h2')).toHaveText(/Wipe all business data/);

  await page.locator('#modal [data-act="cancel"]').click();
  await expect(page.locator('#modal .modal')).toBeHidden();

  const after = await (await request.get('/api/meta')).json();
  expect(after.tables.documents).toBe(before.tables.documents);
});

/* ---------------------------------------------------------- walkthrough */

test('a full click-through raises no console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' && !/favicon/i.test(text)) errors.push(`console: ${text}`);
  });

  await page.goto('/');
  await expect(page.locator('#stat-out')).not.toHaveText('$0.00');

  await page.locator('#nav a[data-nav="invoices"]').click();
  await expect(page.locator('#invoice-table tbody tr').first()).toBeVisible();

  await page.locator('#nav a[data-nav="stock"]').click();
  await expect(page.locator('#st-table tbody tr').first()).toBeVisible();

  await page.goto('/#/invoice/new');
  await expect(page.locator('#m-search')).toBeVisible();

  await page.goto('/#/dashboard');
  await expect(page.locator('.grid-stats .stat')).toHaveCount(4);

  expect(errors, errors.join('\n')).toEqual([]);
});
