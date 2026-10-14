import { expect } from '@playwright/test';

export const CREDS = { username: 'e2e-admin', name: 'E2E Admin', password: 'e2e-password-123' };
export const AUTH_FILE = 'tests/.auth/admin.json';

export const SMALL_DATA = {
  materials: 40,
  vendors: 6,
  customers: 15,
  receipts: 20,
  invoices: 60,
  pos: 12,
};

/** Replace all business data with a fresh, coherent sample dataset. */
export async function resetToSampleData(request) {
  const res = await request.post('/api/demo/generate-fake', { data: { reset: true, ...SMALL_DATA } });
  expect(res.ok(), `generate-fake failed: ${res.status()}`).toBeTruthy();
  return res.json();
}

/** Replace all business data with the masked production export. */
export async function loadMaskedDataset(request) {
  const wipe = await request.post('/api/demo/wipe', { data: { confirm: 'wipe' } });
  expect(wipe.ok()).toBeTruthy();
  const res = await request.post('/api/demo/load-dataset', { data: {} });
  expect(res.ok(), `load-dataset failed: ${res.status()}`).toBeTruthy();
  return res.json();
}

/** Find a material that currently has at least one usable batch. */
export async function pickSellable(request) {
  const list = await (await request.get('/api/stock-levels?limit=10')).json();
  expect(list.rows.length, 'sample data has stock').toBeGreaterThan(0);
  for (const row of list.rows) {
    const stock = await (await request.get(`/api/materials/${encodeURIComponent(row.id)}/stock`)).json();
    const batch = stock.batches.find((b) => b.quantity > 0);
    if (batch) return { materialId: row.id, material: stock.material, stock, batch };
  }
  throw new Error('no sellable material found');
}

export async function firstCustomerId(request) {
  const customers = await (await request.get('/api/customers')).json();
  expect(customers.rows.length).toBeGreaterThan(0);
  return customers.rows[0].id;
}
