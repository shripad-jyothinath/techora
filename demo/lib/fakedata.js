import { randomUUID } from 'node:crypto';
import { HttpError, nowIso, round2 } from './util.js';
import { upsertDocument } from './tree.js';
import { indexDocument } from './indexer.js';
import { stmt, setMeta } from './db.js';
import { postReceipt, saveInvoice } from './writes.js';

/**
 * Sample-data tools for the demo.
 *
 * A fresh install holds zero business data. From the Demo tools you can either
 * load the masked dataset (the real exercise) or generate coherent sample data
 * here. Everything generated goes through the SAME write paths as user actions
 * (receipts create real batches + movements; invoices sell from real batches
 * inside the transaction), so stock, movements and totals always agree.
 */

const WIPE_TABLES = [
  'request_log',
  'idx_invoice_line', 'idx_invoice',
  'idx_movement', 'idx_stock', 'idx_material',
  'idx_customer', 'idx_vendor',
  'idx_po_line', 'idx_po', 'idx_receipt_line', 'idx_receipt',
  'documents',
];

export function wipeBusinessData(db) {
  const wipe = db.transaction(() => {
    for (const t of WIPE_TABLES) stmt(db, `DELETE FROM ${t}`).run();
    setMeta(db, 'next_invoice_no', 100001);
    setMeta(db, 'next_receipt_no', 10001);
    setMeta(db, 'data_mode', 'none');
  });
  wipe.immediate();
  return { wiped: true };
}

const NOUNS = ['Granule', 'Gauge', 'Pump', 'Valve', 'Coupling', 'Membrane', 'Housing', 'Bracket', 'Adapter', 'Regulator', 'Motor', 'Panel', 'Cable', 'Sensor', 'Filter', 'Nozzle', 'Flange', 'Bearing'];
const STYLES = ['Low Profile', 'Heavy Duty', 'Standard', 'Universal', 'Industrial', 'Stainless', 'Precision', 'Compact', 'Dual', 'Variable'];
const SPECS = ['12mm', '25mm', '40mm', '50mm', '5kg', '20L', '110mm', '230V', 'Type A', 'Type B', '1L', '10kg'];
const BRANDS = ['Brightwell', 'Glenrock', 'Silverline', 'Eastbank', 'Highmoor', 'Northgate', 'Stonebrook', 'Fairmont'];
const SUFFIXES = ['Trading', 'Works', 'Facilities', 'Holdings', 'Logistics', 'Supplies', 'Projects', 'Partners'];
const UNITS = ['pc', 'each', 'drum', 'box', 'kg', 'l'];

const rint = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rint(arr.length)];
const chance = (p) => Math.random() < p;
const dayOffset = (days) => new Date(Date.now() - days * 864e5);
const toDate = (d) => d.toISOString().slice(0, 10);
const whole = (min, max, fallback) => {
  const v = Number(min);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(Math.max(Math.round(v), min >= 0 ? min : 0), max);
};

export function generateFakeData(db, options = {}, user = 'system') {
  const existing = stmt(db, 'SELECT COUNT(*) AS n FROM documents').get().n;
  if (existing > 0 && !options.reset) {
    throw new HttpError(409, 'Data already exists — pass reset to replace it');
  }
  if (options.reset) wipeBusinessData(db);
  setMeta(db, 'data_mode', 'fake');

  const o = {
    materials: whole(options.materials, 20000, 40),
    vendors: whole(options.vendors, 500, 6),
    customers: whole(options.customers, 5000, 15),
    receipts: whole(options.receipts, 50000, 20),
    invoices: whole(options.invoices, 100000, 60),
    pos: whole(options.pos, 20000, 15),
    months: whole(options.months, 60, 8),
  };
  const t0 = Date.now();

  /* ---------------------------------------------------------------- master */
  const locations = [
    { id: randomUUID(), name: 'Warehouse A' },
    { id: randomUUID(), name: 'Warehouse B' },
  ];
  const masterTx = db.transaction(() => {
    for (const loc of locations) {
      const doc = { id: loc.id, name: loc.name, isActive: true, createdAt: nowIso() };
      upsertDocument(db, 'inventory/storageLocations', loc.id, doc);
    }
  });
  masterTx.immediate();

  const materials = [];
  const makeMaterial = db.transaction(() => {
    for (let i = 0; i < o.materials; i += 1) {
      const id = randomUUID();
      const name = `${pick(NOUNS)} ${pick(STYLES)} ${pick(SPECS)} ${100 + rint(900)}`;
      const doc = {
        id,
        name,
        description: '',
        gradeOrQuality: '',
        modelNumber: `M${10000 + rint(89999)}`,
        defaultUnit: pick(UNITS),
        isActive: true,
        notes: '',
        reorderPoint: 1 + rint(15),
        storageRequirements: '',
        updatedAt: nowIso(),
      };
      upsertDocument(db, 'inventory/materials', id, doc);
      indexDocument(db, 'inventory/materials', id, doc);
      materials.push({ id, name, unit: doc.defaultUnit, cost: round2(4 + Math.random() * 420), reorderPoint: doc.reorderPoint });
    }
  });
  makeMaterial.immediate();

  const customers = [];
  const makeCustomers = db.transaction(() => {
    for (let i = 0; i < o.customers; i += 1) {
      const id = randomUUID();
      const name = `${pick(BRANDS)} ${pick(SUFFIXES)} ${String(100 + i).slice(-3)}`;
      const doc = {
        id,
        name,
        email: '',
        phone: '',
        address: { city: 'Place-01', country: 'Place-02', state: 'Place-01', street: `${10 + rint(80)} Example Street`, zip: '00000' },
      };
      upsertDocument(db, 'sales/customers', id, doc);
      indexDocument(db, 'sales/customers', id, doc);
      customers.push({ id, name });
    }
  });
  makeCustomers.immediate();

  const vendors = [];
  const makeVendors = db.transaction(() => {
    for (let i = 0; i < o.vendors; i += 1) {
      const id = randomUUID();
      const name = `${pick(BRANDS)} ${pick(SUFFIXES)} Supply ${String(i + 1).padStart(2, '0')}`;
      const doc = {
        id,
        name,
        contactPerson: '',
        email: '',
        phone: '',
        address: `${10 + rint(90)} Example Street`,
        paymentTerms: '',
        taxId: '',
        isActive: true,
        notes: '',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      upsertDocument(db, 'purchasing/vendors', id, doc);
      indexDocument(db, 'purchasing/vendors', id, doc);
      vendors.push({ id, name });
    }
  });
  makeVendors.immediate();

  /* ------------------------------------------------------- purchase orders */
  const pos = [];
  for (let i = 0; i < o.pos; i += 1) {
    const vendor = pick(vendors);
    const daysBack = rint(o.months * 30);
    const orderDate = toDate(dayOffset(daysBack + 20));
    const status = chance(0.35) ? 'received' : chance(0.15) ? 'cancelled' : 'sent';
    const lineCount = 1 + rint(4);
    const used = new Set();
    const items = [];
    for (let l = 0; l < lineCount; l += 1) {
      const m = pick(materials);
      if (used.has(m.id)) continue;
      used.add(m.id);
      const qty = 5 + rint(46);
      const price = round2(m.cost * (1.15 + Math.random() * 0.45));
      items.push({
        id: randomUUID(),
        materialId: m.id,
        description: m.name,
        quantity: qty,
        unit: m.unit,
        unitPrice: price,
        totalPrice: round2(qty * price),
        discount: 0,
        originalCurrency: 'USD',
        originalUnitPrice: price,
        receivedQuantity: status === 'received' ? qty : 0,
      });
    }
    if (!items.length) continue;
    const total = round2(items.reduce((s, it) => s + it.totalPrice, 0));
    const id = randomUUID();
    const doc = {
      id,
      orderNumber: `PO-${orderDate.replaceAll('-', '')}-${1000 + i}`,
      vendorId: vendor.id,
      vendorName: vendor.name,
      status,
      orderDate,
      expectedDeliveryDate: toDate(dayOffset(daysBack + 20 - (7 + rint(14)))),
      currency: 'USD',
      exchangeRate: 1,
      discount: 0,
      courierCharges: 0,
      notes: '',
      subtotal: total,
      total,
      items,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: user,
      updatedBy: user,
    };
    upsertDocument(db, 'purchasing/purchaseOrders', id, doc);
    indexDocument(db, 'purchasing/purchaseOrders', id, doc);
    pos.push(doc);
  }

  /* --------------------------------------------------------------- receipts */
  let receiptsMade = 0;
  for (let i = 0; i < o.receipts; i += 1) {
    const daysBack = rint(o.months * 30);
    const date = toDate(dayOffset(daysBack));
    const vendor = pick(vendors);
    const linkedPo = chance(0.4) ? pick(pos.filter((p) => p.status === 'received')) : null;
    const lineCount = 1 + rint(4);
    const used = new Set();
    const lines = [];
    for (let l = 0; l < lineCount; l += 1) {
      const m = pick(materials);
      if (used.has(m.id)) continue;
      used.add(m.id);
      lines.push({
        material_id: m.id,
        description: m.name,
        quantity: 5 + rint(56),
        unit: m.unit,
        unit_cost: round2(m.cost * (0.9 + Math.random() * 0.35)),
      });
    }
    if (!lines.length) continue;
    const loc = pick(locations);
    postReceipt(
      db,
      {
        vendor_id: vendor.id,
        purchase_order_id: linkedPo?.id ?? '',
        receipt_date: date,
        lines: lines.map((l) => ({ ...l, location_id: loc.id })),
        notes: '',
        request_id: randomUUID(),
      },
      user
    );
    receiptsMade += 1;
  }

  /* --------------------------------------------------------------- invoices */
  let invoicesMade = 0;
  const invoiceWindow = Math.min(o.months * 30, 180);
  for (let i = 0; i < o.invoices; i += 1) {
    const daysBack = chance(0.25) ? rint(18) : 18 + rint(Math.max(invoiceWindow - 18, 1));
    const date = toDate(dayOffset(daysBack));
    const customer = pick(customers);
    const lineCount = 1 + rint(3);
    const used = new Set();
    const lines = [];
    let attempts = 0;
    while (lines.length < lineCount && attempts < 16) {
      attempts += 1;
      const m = pick(materials);
      if (used.has(m.id)) continue;
      const batch = stmt(
        db,
        'SELECT batch_id, quantity, unit_cost FROM idx_stock WHERE material_id = ? AND quantity > 0 ORDER BY received_at ASC, batch_id ASC LIMIT 1'
      ).get(m.id);
      if (!batch || batch.quantity < 1) continue;
      used.add(m.id);
      const qty = 1 + rint(Math.max(1, Math.min(Math.floor(batch.quantity), 8)));
      lines.push({
        material_id: m.id,
        batch_id: batch.batch_id,
        quantity: qty,
        unit_price: round2((Number(batch.unit_cost) || m.cost) * (1.15 + Math.random() * 0.55)),
        discount: 0,
      });
    }
    if (!lines.length) continue;
    const roll = Math.random();
    const status = roll < 0.7 ? 'sent' : roll < 0.9 ? 'paid' : 'partial';
    saveInvoice(db, { customer_id: customer.id, date, status, lines, request_id: randomUUID(), notes: '' }, user);
    invoicesMade += 1;
  }

  /* ------------------------------------------------------------ adjustments */
  let adjustmentsMade = 0;
  const adjCount = Math.max(2, Math.round(o.materials / 20));
  for (let i = 0; i < adjCount; i += 1) {
    const increase = chance(0.5);
    const m = pick(materials);
    const loc = pick(locations);
    const date = toDate(dayOffset(rint(o.months * 30)));
    const adjId = randomUUID();
    const qty = 1 + rint(5);
    const cost = m.cost;
    const movementId = randomUUID();

    if (increase) {
      const batchId = randomUUID();
      const batchDoc = {
        id: batchId,
        itemId: m.id,
        itemType: 'material',
        destinationLocationId: loc.id,
        quantity: qty,
        unit: m.unit,
        costPerUnit: cost,
        totalCost: round2(qty * cost),
        status: 'available',
        lastUpdated: nowIso(),
      };
      const mv = {
        id: movementId,
        itemId: m.id,
        quantity: qty,
        unit: m.unit,
        costPerUnit: cost,
        totalCost: round2(qty * cost),
        transactionType: 'adjustment',
        direction: 'increase',
        relatedDocumentType: 'stock_adjustment',
        relatedDocumentId: adjId,
        batchId,
        transactionDate: `${date}T12:00:00.000Z`,
        performedBy: user,
        notes: 'Cycle count adjustment',
      };
      const run = db.transaction(() => {
        upsertDocument(db, 'inventory/stockLevels', batchId, batchDoc);
        indexDocument(db, 'inventory/stockLevels', batchId, batchDoc);
        upsertDocument(db, 'inventory/transactions', movementId, mv);
        indexDocument(db, 'inventory/transactions', movementId, mv);
      });
      run.immediate();
    } else {
      const batch = stmt(db, 'SELECT batch_id, quantity FROM idx_stock WHERE material_id = ? AND quantity >= ? ORDER BY received_at ASC LIMIT 1').get(m.id, qty);
      if (!batch) continue;
      const mv = {
        id: movementId,
        itemId: m.id,
        quantity: qty,
        unit: m.unit,
        costPerUnit: cost,
        totalCost: round2(qty * cost),
        transactionType: 'adjustment',
        direction: 'decrease',
        relatedDocumentType: 'stock_adjustment',
        relatedDocumentId: adjId,
        batchId: batch.batch_id,
        transactionDate: `${date}T12:00:00.000Z`,
        performedBy: user,
        notes: 'Cycle count adjustment',
      };
      const run = db.transaction(() => {
        stmt(db, 'UPDATE idx_stock SET quantity = ROUND(quantity - ?, 6) WHERE batch_id = ? AND quantity >= ?').run(qty, batch.batch_id, qty);
        const doc = JSON.parse(stmt(db, 'SELECT value FROM documents WHERE path = ?').get(`inventory/stockLevels/${batch.batch_id}`).value);
        const updated = { ...doc, quantity: round2(Number(doc.quantity) - qty), lastUpdated: nowIso() };
        upsertDocument(db, 'inventory/stockLevels', batch.batch_id, updated);
        indexDocument(db, 'inventory/stockLevels', batch.batch_id, updated);
        upsertDocument(db, 'inventory/transactions', movementId, mv);
        indexDocument(db, 'inventory/transactions', movementId, mv);
      });
      run.immediate();
    }

    const adjDoc = {
      id: adjId,
      adjustmentType: increase ? 'increase' : 'decrease',
      itemId: m.id,
      itemName: m.name,
      quantity: qty,
      unit: m.unit,
      locationId: loc.id,
      locationName: loc.name,
      reason: 'cycle_count',
      status: 'approved',
      createdBy: user,
      approvedBy: user,
      createdAt: nowIso(),
      approvedAt: nowIso(),
      transactionId: movementId,
      notes: '',
    };
    upsertDocument(db, 'inventory/stockAdjustments', adjId, adjDoc);
    adjustmentsMade += 1;
  }

  return {
    mode: 'fake',
    ms: Date.now() - t0,
    materials: materials.length,
    vendors: vendors.length,
    customers: customers.length,
    locations: locations.length,
    purchaseOrders: pos.length,
    receipts: receiptsMade,
    invoices: invoicesMade,
    adjustments: adjustmentsMade,
  };
}
