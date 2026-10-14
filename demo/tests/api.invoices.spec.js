import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { firstCustomerId, pickSellable, resetToSampleData } from './helpers.js';

/**
 * The read/write contract of the invoice screens, against coherent sample data
 * (each test relation is behavioural, not tied to exact random values).
 */
test.beforeAll(async ({ request }) => {
  await resetToSampleData(request);
});

test('invoice list is bounded and pages with a keyset cursor', async ({ request }) => {
  const p1 = await (await request.get('/api/invoices?limit=5&sort=date&dir=desc')).json();
  expect(p1.rows).toHaveLength(5);
  expect(p1.total).toBeGreaterThan(5);
  expect(p1.next_cursor).toBeTruthy();

  const p2 = await (await request.get(`/api/invoices?limit=5&sort=date&dir=desc&cursor=${encodeURIComponent(p1.next_cursor)}`)).json();
  expect(p2.rows).toHaveLength(5);
  const ids = new Set(p1.rows.map((r) => r.id));
  for (const row of p2.rows) expect(ids.has(row.id), 'pages must not overlap').toBeFalsy();
});

test('sorting by total descending is monotonic', async ({ request }) => {
  const page = await (await request.get('/api/invoices?limit=25&sort=total&dir=desc')).json();
  const totals = page.rows.map((r) => r.total);
  for (let i = 1; i < totals.length; i += 1) {
    expect(totals[i], `row ${i} total`).toBeLessThanOrEqual(totals[i - 1]);
  }
});

test('status filter returns only that status', async ({ request }) => {
  const paid = await (await request.get('/api/invoices?status=paid&limit=25')).json();
  for (const row of paid.rows) expect(row.status).toBe('paid');
  const sent = await (await request.get('/api/invoices?status=sent&limit=25')).json();
  for (const row of sent.rows) expect(row.status).toBe('sent');
});

test('search finds an invoice by its exact number', async ({ request }) => {
  const first = await (await request.get('/api/invoices?limit=1')).json();
  const number = first.rows[0].invoice_number;
  const found = await (await request.get(`/api/invoices?q=${encodeURIComponent(number)}`)).json();
  expect(found.rows.some((r) => r.invoice_number === number)).toBeTruthy();
});

test('unknown resources return 404', async ({ request }) => {
  expect((await request.get('/api/invoices/does-not-exist')).status()).toBe(404);
  expect((await request.get('/api/materials/does-not-exist/stock')).status()).toBe(404);
  expect((await request.get('/api/movements?material_id=does-not-exist')).status()).toBe(404);
});

test('saving an invoice decrements stock, links the movement, and replays idempotently', async ({ request }) => {
  const { materialId, batch } = await pickSellable(request);
  const customerId = await firstCustomerId(request);
  const requestId = randomUUID();
  const payload = {
    request_id: requestId,
    customer_id: customerId,
    lines: [{ material_id: materialId, batch_id: batch.batch_id, quantity: 1, unit_price: 10 }],
  };

  const stockBefore = await (await request.get(`/api/materials/${encodeURIComponent(materialId)}/stock`)).json();
  const before = stockBefore.batches.find((b) => b.batch_id === batch.batch_id).quantity;

  const save = await request.post('/api/invoices', { data: payload });
  expect(save.status()).toBe(201);
  const out = await save.json();
  expect(out.movements).toBe(1);
  expect(out.total).toBeCloseTo(10, 2);

  const after = (await (await request.get(`/api/materials/${encodeURIComponent(materialId)}/stock`)).json())
    .batches.find((b) => b.batch_id === batch.batch_id).quantity;
  expect(after).toBeCloseTo(before - 1, 5);

  // the saved invoice is retrievable with its batch link
  const detail = await (await request.get(`/api/invoices/${out.invoice_id}`)).json();
  expect(detail.invoice.status).toBe('sent');
  expect(detail.lines).toHaveLength(1);
  expect(detail.lines[0].batch_id).toBe(batch.batch_id);

  // a retried save with the same request_id must not double-post
  const replay = await (await request.post('/api/invoices', { data: payload })).json();
  expect(replay.idempotent).toBe(true);
  expect(replay.invoice_id).toBe(out.invoice_id);
  const afterReplay = (await (await request.get(`/api/materials/${encodeURIComponent(materialId)}/stock`)).json())
    .batches.find((b) => b.batch_id === batch.batch_id).quantity;
  expect(afterReplay).toBeCloseTo(before - 1, 5);
});

test('overselling is rejected with a 409 and fresh availability', async ({ request }) => {
  const { materialId, batch } = await pickSellable(request);
  const customerId = await firstCustomerId(request);
  const res = await request.post('/api/invoices', {
    data: {
      customer_id: customerId,
      lines: [{ material_id: materialId, batch_id: batch.batch_id, quantity: batch.quantity + 50 }],
    },
  });
  expect(res.status()).toBe(409);
  const body = await res.json();
  expect(body.details.available).toBeCloseTo(batch.quantity, 5);
  expect(body.details.material_id).toBe(materialId);
});

test('an unknown customer or empty lines are rejected', async ({ request }) => {
  const { materialId, batch } = await pickSellable(request);
  expect(
    (await request.post('/api/invoices', { data: { customer_id: 'nope', lines: [{ material_id: materialId, batch_id: batch.batch_id, quantity: 1 }] } })).status()
  ).toBe(404);
  expect((await request.post('/api/invoices', { data: { customer_id: 'nope', lines: [] } })).status()).toBe(400);
});

test('paying an invoice settles it exactly once', async ({ request }) => {
  const sent = await (await request.get('/api/invoices?status=sent&limit=1')).json();
  expect(sent.rows.length).toBeGreaterThan(0);
  const id = sent.rows[0].id;

  const pay = await request.post(`/api/invoices/${id}/pay`);
  expect(pay.ok()).toBeTruthy();

  const detail = await (await request.get(`/api/invoices/${id}`)).json();
  expect(detail.invoice.status).toBe('paid');
  expect(detail.invoice.balance).toBe(0);
  expect(detail.invoice.paidAmount).toBeCloseTo(detail.invoice.total, 2);

  expect((await request.post(`/api/invoices/${id}/pay`)).status()).toBe(400);
});
