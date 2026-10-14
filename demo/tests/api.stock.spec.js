import { test, expect } from '@playwright/test';
import { pickSellable, resetToSampleData } from './helpers.js';

/** Stock, movements and tree-inspection contract. */
test.beforeAll(async ({ request }) => {
  await resetToSampleData(request);
});

test('material search finds a material by its model number', async ({ request }) => {
  const browse = await (await request.get('/api/materials/search?limit=20')).json();
  const withModel = browse.rows.find((r) => r.model_number);
  expect(withModel, 'sample materials carry model numbers').toBeTruthy();

  const prefix = withModel.model_number.slice(0, 4);
  const found = await (await request.get(`/api/materials/search?q=${encodeURIComponent(prefix)}&limit=20`)).json();
  expect(found.rows.some((r) => r.id === withModel.id)).toBeTruthy();
});

test('stock panel lists usable batches first and the availability is their sum', async ({ request }) => {
  // Sell an entire batch so a zero-quantity row exists alongside usable ones.
  const { materialId, batch } = await pickSellable(request);
  const customer = await (await request.get('/api/customers')).json();
  const sold = await request.post('/api/invoices', {
    data: {
      customer_id: customer.rows[0].id,
      lines: [{ material_id: materialId, batch_id: batch.batch_id, quantity: batch.quantity, unit_price: 5 }],
    },
  });
  expect(sold.status()).toBe(201);

  const stock = await (await request.get(`/api/materials/${encodeURIComponent(materialId)}/stock`)).json();
  const usable = stock.batches.filter((b) => b.quantity > 0);
  const zero = stock.batches.filter((b) => b.quantity <= 0);
  expect(zero.length).toBeGreaterThan(0);
  // usable rows come first in the payload
  expect(stock.batches.indexOf(usable[0])).toBeLessThan(stock.batches.indexOf(zero[0]));
  expect(stock.available).toBeCloseTo(usable.reduce((s, b) => s + b.quantity, 0), 5);
});

test('posting a receipt creates a batch and a linked purchase movement', async ({ request }) => {
  const browse = await (await request.get('/api/materials/search?limit=5')).json();
  const material = browse.rows[0];
  const before = (await (await request.get(`/api/materials/${encodeURIComponent(material.id)}/stock`)).json()).available;

  const receipt = await request.post('/api/receipts', {
    data: { lines: [{ material_id: material.id, quantity: 7, unit_cost: 3.5 }] },
  });
  expect(receipt.status()).toBe(201);
  const out = await receipt.json();
  expect(out.batches_created).toBe(1);
  expect(out.movements).toBe(1);

  const after = await (await request.get(`/api/materials/${encodeURIComponent(material.id)}/stock`)).json();
  expect(after.available).toBeCloseTo(before + 7, 5);

  const movements = await (await request.get(`/api/movements?material_id=${encodeURIComponent(material.id)}`)).json();
  const linked = movements.rows.find((m) => m.document_no === out.receipt_number);
  expect(linked, 'the receipt movement is retrievable by its document number').toBeTruthy();
  expect(linked.type).toBe('purchase');
  expect(linked.document_id).toBe(out.receipt_id);
  expect(linked.batch_id).toBeTruthy();
});

test('movement date filtering is inclusive of the end date', async ({ request }) => {
  const { materialId } = await pickSellable(request);
  const all = await (await request.get(`/api/movements?material_id=${encodeURIComponent(materialId)}`)).json();
  expect(all.count).toBeGreaterThan(0);

  const today = new Date().toISOString().slice(0, 10);
  const throughToday = await (await request.get(`/api/movements?material_id=${encodeURIComponent(materialId)}&to=${today}`)).json();
  expect(throughToday.count).toBe(all.count); // everything happened in this test run

  const fromFuture = await (await request.get(`/api/movements?material_id=${encodeURIComponent(materialId)}&from=2030-01-01`)).json();
  expect(fromFuture.count).toBe(0);
});

test('the unified search returns invoices and materials in one call', async ({ request }) => {
  const first = await (await request.get('/api/invoices?limit=1')).json();
  const number = first.rows[0].invoice_number;

  const byNumber = await (await request.get(`/api/search?q=${encodeURIComponent(number)}`)).json();
  expect(byNumber.invoices.some((i) => i.invoice_number === number)).toBeTruthy();

  const browse = await (await request.get('/api/materials/search?limit=1')).json();
  const model = browse.rows[0].model_number;
  const byModel = await (await request.get(`/api/search?q=${encodeURIComponent(model)}`)).json();
  expect(byModel.materials.some((m) => m.model_number === model)).toBeTruthy();
});

test('the tree endpoint serves raw records and blocks traversal', async ({ request }) => {
  const first = await (await request.get('/api/invoices?limit=1')).json();
  const id = first.rows[0].id;

  const ok = await request.get(`/api/tree?path=${encodeURIComponent(`sales/invoices/${id}`)}`);
  expect(ok.ok()).toBeTruthy();
  const body = await ok.json();
  expect(body.document.invoiceNumber).toBe(first.rows[0].invoice_number);

  expect((await request.get('/api/tree?path=../../etc/passwd')).status()).toBe(400);
  expect((await request.get('/api/tree?path=nope/nothing')).status()).toBe(404);
});
