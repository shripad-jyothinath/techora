import { test, expect } from '@playwright/test';
import { loadMaskedDataset } from './helpers.js';

/**
 * The masked production export: proves the migration pipeline end-to-end on
 * the real dataset. Runs in its own spec; later specs reset to sample data.
 */
test.beforeAll(async ({ request }) => {
  const out = await loadMaskedDataset(request);
  expect(out.docs).toBe(17062);
});

test('record counts match the numbers published in the problem statement', async ({ request }) => {
  const meta = await (await request.get('/api/meta')).json();
  expect(meta.data_mode).toBe('dataset');
  expect(meta.tables.documents).toBe(17062);
  expect(meta.tables.idx_invoice).toBe(2869);
  expect(meta.tables.idx_movement).toBe(7761);
  expect(meta.tables.idx_stock).toBe(2656);
  expect(meta.tables.idx_material).toBe(1346);
});

test('legacy invoice lines resolve to batches at high coverage', async ({ request }) => {
  const list = await (await request.get('/api/invoices?limit=10')).json();
  let lines = 0;
  let resolved = 0;
  for (const row of list.rows) {
    const detail = await (await request.get(`/api/invoices/${row.id}`)).json();
    for (const line of detail.lines) {
      lines += 1;
      if (line.batch_id) resolved += 1;
    }
  }
  expect(lines).toBeGreaterThan(0);
  expect(resolved / lines, 'legacy batch references resolve once the composite prefix is stripped').toBeGreaterThan(0.9);
});

test('a known legacy invoice is searchable and complete', async ({ request }) => {
  const found = await (await request.get('/api/invoices?q=INV-43230')).json();
  expect(found.rows.length).toBeGreaterThan(0);
  const detail = await (await request.get(`/api/invoices/${found.rows[0].id}`)).json();
  expect(detail.invoice.invoiceNumber).toBe('INV-43230');
  expect(detail.lines.length).toBeGreaterThan(0);
  expect(detail.invoice.total).toBeGreaterThan(0);
});

test('the dashboard reports legacy link coverage honestly', async ({ request }) => {
  const dash = await (await request.get('/api/dashboard')).json();
  expect(dash.outstanding.count).toBeGreaterThan(2000);
  expect(dash.dataQuality.salesMovements).toBe(5240);
  expect(dash.dataQuality.invoiceCoverage).toBeGreaterThan(95);
  expect(dash.dataQuality.batchCoverage).toBeGreaterThan(95);
});

test('the movement report works on the busiest legacy material', async ({ request }) => {
  const res = await request.get('/api/movements?material_id=-OV2mo6EJK1XMroKDZUJ');
  expect(res.ok()).toBeTruthy();
  const report = await res.json();
  expect(report.count).toBeGreaterThan(0);
  expect(report.rows[0].running).toBeDefined();
});
