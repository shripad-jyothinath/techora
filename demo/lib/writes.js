import { randomUUID } from 'node:crypto';
import { addDays, HttpError, nowIso, num, numOrNull, round2 } from './util.js';
import { readDocument, upsertDocument } from './tree.js';
import { indexDocument } from './indexer.js';
import { stmt } from './db.js';
import { lastSalePrice } from './queries.js';

/**
 * Write paths. Every stock-affecting operation is ONE SQLite transaction:
 *   documents (tree) + index tables + idempotency log are committed together
 * or not at all. The write lock (BEGIN IMMEDIATE via better-sqlite3's
 * .immediate()) serializes writers, so two people selling the last units
 * cannot both succeed.
 */

function nextSeq(db, key, fallback) {
  const row = stmt(db, 'SELECT value FROM meta WHERE key = ?').get(key);
  const next = row ? Number(row.value) : fallback;
  stmt(
    db,
    `INSERT INTO meta(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(next + 1));
  return next;
}

function idempotentReplay(db, requestId) {
  if (!requestId) return null;
  const prev = stmt(db, 'SELECT response FROM request_log WHERE request_id = ?').get(requestId);
  return prev ? { ...JSON.parse(prev.response), idempotent: true } : null;
}

function rememberRequest(db, requestId, endpoint, status, response) {
  if (!requestId) return;
  stmt(
    db,
    `INSERT OR REPLACE INTO request_log(request_id, endpoint, status, response, created_at)
     VALUES(?, ?, ?, ?, ?)`
  ).run(requestId, endpoint, status, JSON.stringify(response), nowIso());
}

const INVOICE_STATUSES = ['sent', 'paid', 'partial', 'draft'];

/* -------------------------------------------------------------------------- */
/* Saving an invoice                                                           */
/* -------------------------------------------------------------------------- */

export function saveInvoice(db, payload, user = '1') {
  if (!payload || typeof payload !== 'object') throw new HttpError(400, 'JSON body required');
  const rawLines = Array.isArray(payload.lines) ? payload.lines : [];
  if (!rawLines.length) throw new HttpError(400, 'At least one line is required');
  if (!payload.customer_id) throw new HttpError(400, 'customer_id is required');

  const run = db.transaction(() => {
    const replay = idempotentReplay(db, payload.request_id);
    if (replay) return replay;

    const customer = stmt(db, 'SELECT * FROM idx_customer WHERE id = @ref OR alias_id = @ref LIMIT 1').get({ ref: payload.customer_id });
    if (!customer) throw new HttpError(404, `Customer ${payload.customer_id} not found`);

    // 1) Resolve every line: material, batch, money. Aggregate demand per batch
    //    because two lines may pick the same batch.
    const perBatch = new Map();
    const lines = rawLines.map((l, i) => {
      const material = stmt(db, 'SELECT * FROM idx_material WHERE id = @ref OR alias_id = @ref LIMIT 1').get({ ref: l.material_id });
      if (!material) throw new HttpError(400, `Line ${i + 1}: material not found`);
      const batch = stmt(db, 'SELECT * FROM idx_stock WHERE batch_id = ?').get(l.batch_id);
      if (!batch) throw new HttpError(409, `Line ${i + 1}: stock batch not found`, { batch_id: l.batch_id });
      if (batch.material_id !== material.id) {
        throw new HttpError(400, `Line ${i + 1}: that batch belongs to a different material`);
      }
      const qty = num(l.quantity);
      if (!(qty > 0)) throw new HttpError(400, `Line ${i + 1}: quantity must be greater than zero`);
      const unitPrice =
        l.unit_price === undefined || l.unit_price === null || l.unit_price === '' ? num(batch.unit_cost) : num(l.unit_price);
      const discount = num(l.discount);
      perBatch.set(batch.batch_id, (perBatch.get(batch.batch_id) ?? 0) + qty);
      return { material, batch, qty, unitPrice, discount, total: round2(qty * unitPrice - discount) };
    });

    // 2) Stock check as a sum per batch (clear 409 before we write anything).
    for (const [batchId, qty] of perBatch) {
      const batch = stmt(db, 'SELECT * FROM idx_stock WHERE batch_id = ?').get(batchId);
      if (qty > batch.quantity + 1e-9) {
        throw new HttpError(409, `Not enough stock in a batch you picked (${batchId})`, {
          batch_id: batchId,
          material_id: batch.material_id,
          requested: round2(qty),
          available: batch.quantity,
        });
      }
    }

    // 3) Build the invoice document with the same field names as the vendor
    //    tree (customer snapshot, items with unitPrice/totalPrice), plus the
    //    structured batchId the old system never stored. No UI scratch fields.
    const id = randomUUID();
    const invoiceNumber = `INV-${nextSeq(db, 'next_invoice_no', 100001)}`;
    const date = payload.date ?? nowIso().slice(0, 10);
    const dueDate = payload.due_date ?? addDays(date, 30);
    const status = INVOICE_STATUSES.includes(payload.status) ? payload.status : 'sent';
    const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));
    const discountTotal = round2(lines.reduce((s, l) => s + l.discount, 0));
    const total = subtotal;
    const paidAmount = status === 'paid' ? total : status === 'partial' ? round2(total / 2) : 0;
    const balance = round2(total - paidAmount);
    const movementDate = payload.date ? `${payload.date}T12:00:00.000Z` : nowIso();

    const invoice = {
      id,
      invoiceNumber,
      customerId: customer.id,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email ?? '',
        phone: customer.phone ?? '',
        address: JSON.parse(customer.address_json || '{}'),
      },
      date,
      dueDate,
      status,
      type: 'standard',
      terms: payload.terms ?? 'Net 30',
      notes: payload.notes ?? '',
      items: lines.map((l) => ({
        id: randomUUID(),
        productId: l.material.id,
        description: l.material.name,
        quantity: l.qty,
        unit: l.unit ?? l.material.default_unit ?? '',
        unitPrice: l.unitPrice,
        discount: l.discount,
        totalPrice: l.total,
        batchId: l.batch.batch_id,
        batchCost: num(l.batch.unit_cost),
        storageLocation: l.batch.location_id ?? '',
      })),
      subtotal,
      discountTotal,
      taxTotal: 0,
      total,
      paidAmount,
      balance,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    upsertDocument(db, 'sales/invoices', id, invoice);
    indexDocument(db, 'sales/invoices', id, invoice);

    // 4) Decrement each chosen batch, write one movement per line. The UPDATE
    //    guard (quantity >= ?) plus the single-writer transaction make negative
    //    stock impossible at the storage layer, not just by convention.
    const movements = [];
    const stockChanges = [];
    for (const l of lines) {
      const before = stmt(db, 'SELECT quantity FROM idx_stock WHERE batch_id = ?').get(l.batch.batch_id);
      const upd = stmt(db, 'UPDATE idx_stock SET quantity = ROUND(quantity - ?, 6) WHERE batch_id = ? AND quantity >= ?').run(
        l.qty, l.batch.batch_id, l.qty
      );
      if (upd.changes !== 1) {
        throw new HttpError(409, 'Stock changed while saving — refresh availability and retry', {
          batch_id: l.batch.batch_id,
          material_id: l.material.id,
        });
      }

      const stockDoc = readDocument(db, `inventory/stockLevels/${l.batch.batch_id}`) ?? {
        id: l.batch.batch_id,
        itemId: l.material.id,
      };
      const updatedStock = {
        ...stockDoc,
        quantity: round2(num(stockDoc.quantity) - l.qty),
        lastUpdated: nowIso(),
      };
      upsertDocument(db, 'inventory/stockLevels', l.batch.batch_id, updatedStock);
      indexDocument(db, 'inventory/stockLevels', l.batch.batch_id, updatedStock);

      const movement = {
        id: randomUUID(),
        itemId: l.material.id,
        quantity: l.qty,
        unit: l.unit ?? l.material.default_unit ?? '',
        costPerUnit: num(l.batch.unit_cost),
        totalCost: round2(l.qty * num(l.batch.unit_cost)),
        transactionType: 'sales',
        // The fix for the old system's biggest data defect: a real, typed link
        // to the document — and the batch it came from.
        relatedDocumentType: 'invoice',
        relatedDocumentId: id,
        batchId: l.batch.batch_id,
        storageLocation: l.batch.location_id ?? '',
        transactionDate: movementDate,
        performedBy: String(user),
        notes: `Sold via Invoice #${invoiceNumber} - Batch: ${l.batch.batch_id}`,
      };
      upsertDocument(db, 'inventory/transactions', movement.id, movement);
      indexDocument(db, 'inventory/transactions', movement.id, movement);

      movements.push(movement);
      stockChanges.push({
        batch_id: l.batch.batch_id,
        material_id: l.material.id,
        before: before.quantity,
        after: round2(before.quantity - l.qty),
      });
    }

    const response = {
      invoice_id: id,
      invoice_number: invoiceNumber,
      total: invoice.total,
      movements: movements.length,
      stock_changes: stockChanges,
      material_ids: [...new Set(lines.map((l) => l.material.id))],
    };
    rememberRequest(db, payload.request_id, 'POST /api/invoices', 201, response);
    return response;
  });

  return run.immediate();
}

/* -------------------------------------------------------------------------- */
/* Posting a goods receipt (creates new batches + movements)                   */
/* -------------------------------------------------------------------------- */

export function postReceipt(db, payload, user = '4') {
  if (!payload || typeof payload !== 'object') throw new HttpError(400, 'JSON body required');
  const rawLines = Array.isArray(payload.lines) ? payload.lines : [];
  if (!rawLines.length) throw new HttpError(400, 'At least one line is required');

  const run = db.transaction(() => {
    const replay = idempotentReplay(db, payload.request_id);
    if (replay) return replay;

    const lines = rawLines.map((l, i) => {
      const material = stmt(db, 'SELECT * FROM idx_material WHERE id = @ref OR alias_id = @ref LIMIT 1').get({ ref: l.material_id });
      if (!material) throw new HttpError(400, `Line ${i + 1}: material not found`);
      const qty = num(l.quantity);
      if (!(qty > 0)) throw new HttpError(400, `Line ${i + 1}: quantity must be greater than zero`);
      let cost = numOrNull(l.unit_cost);
      if (cost === null) {
        cost =
          stmt(
            db,
            'SELECT unit_cost FROM idx_stock WHERE material_id = ? AND unit_cost IS NOT NULL ORDER BY received_at DESC LIMIT 1'
          ).get(material.id)?.unit_cost ?? 0;
      }
      return {
        material,
        qty,
        cost: round2(cost),
        location: l.location_id ?? 'DEFAULT-LOCATION',
        unit: l.unit ?? material.default_unit ?? '',
        description: l.description ?? material.name,
      };
    });

    const receiptId = randomUUID();
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const receiptNumber = `GRN-${ymd}-${String(nextSeq(db, 'next_receipt_no', 10001)).padStart(5, '0')}`;
    const receiptDate = payload.receipt_date ?? nowIso().slice(0, 10);
    const movementDate = payload.receipt_date ? `${payload.receipt_date}T12:00:00.000Z` : nowIso();

    const receipt = {
      id: receiptId,
      receiptNumber,
      receiptDate,
      purchaseOrderId: payload.purchase_order_id ?? '',
      vendorId: payload.vendor_id ?? '',
      items: lines.map((l) => ({
        id: randomUUID(),
        materialId: l.material.id,
        description: l.description,
        receivedQuantity: l.qty,
        storageLocationId: l.location,
        unit: l.unit,
        notes: '',
        purchaseOrderItemId: '',
      })),
      landedCost: round2(lines.reduce((s, l) => s + l.qty * l.cost, 0)),
      status: 'completed',
      notes: payload.notes ?? '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: String(user),
      updatedBy: String(user),
    };
    upsertDocument(db, 'purchasing/purchaseReceipts', receiptId, receipt);
    indexDocument(db, 'purchasing/purchaseReceipts', receiptId, receipt);

    const batches = [];
    const movements = [];
    lines.forEach((l, i) => {
      const batchId = randomUUID();
      const batch = {
        id: batchId,
        itemId: l.material.id,
        itemType: 'material',
        destinationLocationId: l.location,
        quantity: l.qty,
        unit: l.unit,
        costPerUnit: l.cost,
        totalCost: round2(l.qty * l.cost),
        purchaseReceiptId: receiptId,
        purchaseReceiptItemIndex: i,
        vendorId: receipt.vendorId,
        status: 'available',
        lastUpdated: nowIso(),
      };
      upsertDocument(db, 'inventory/stockLevels', batchId, batch);
      indexDocument(db, 'inventory/stockLevels', batchId, batch);

      const movement = {
        id: randomUUID(),
        itemId: l.material.id,
        quantity: l.qty,
        unit: l.unit,
        costPerUnit: l.cost,
        totalCost: round2(l.qty * l.cost),
        transactionType: 'purchase',
        relatedDocumentType: 'purchase_receipt',
        relatedDocumentId: receiptId,
        batchId,
        destinationLocationId: l.location,
        transactionDate: movementDate,
        performedBy: String(user),
        notes: `Received from GRN ${receiptNumber}`,
      };
      upsertDocument(db, 'inventory/transactions', movement.id, movement);
      indexDocument(db, 'inventory/transactions', movement.id, movement);

      batches.push({ batch_id: batchId, material_id: l.material.id, quantity: l.qty, unit_cost: l.cost });
      movements.push(movement);
    });

    const response = {
      receipt_id: receiptId,
      receipt_number: receiptNumber,
      batches_created: batches.length,
      movements: movements.length,
      material_ids: [...new Set(lines.map((l) => l.material.id))],
    };
    rememberRequest(db, payload.request_id, 'POST /api/receipts', 201, response);
    return response;
  });

  return run.immediate();
}

/* -------------------------------------------------------------------------- */
/* Settling an invoice (a non-stock write — shows updates are transactional)   */
/* -------------------------------------------------------------------------- */

export function markInvoicePaid(db, invoiceId, user = '1') {
  const run = db.transaction(() => {
    const row = stmt(db, 'SELECT value FROM documents WHERE path = ?').get(`sales/invoices/${invoiceId}`);
    if (!row) throw new HttpError(404, 'Invoice not found');
    const inv = JSON.parse(row.value);
    const total = num(inv.total);
    const paid = num(inv.paidAmount);
    const balance = inv.balance !== undefined ? num(inv.balance) : total - paid;
    if (balance <= 0.005) throw new HttpError(400, 'Invoice is already settled');
    const updated = {
      ...inv,
      status: 'paid',
      paidAmount: round2(paid + balance),
      balance: 0,
      updatedAt: nowIso(),
    };
    upsertDocument(db, 'sales/invoices', invoiceId, updated);
    indexDocument(db, 'sales/invoices', invoiceId, updated);
    return { invoice_id: invoiceId, invoice_number: updated.invoiceNumber, paid: updated.paidAmount };
  });
  return run.immediate();
}

/* -------------------------------------------------------------------------- */
/* Demo helpers used by the "Demo tools" drawer (they call the same write      */
/* paths above — nothing bypasses validation, transactions or events).         */
/* -------------------------------------------------------------------------- */

/** Set the stage: find a sold-out material and receive 7 + 5 units → 12 across two batches. */
export function demoSetupMaterial(db, user = '4') {
  const material = stmt(
    db,
    `SELECT m.id, m.name, m.model_number FROM idx_material m
     WHERE m.is_active = 1
       AND NOT EXISTS (SELECT 1 FROM idx_stock s WHERE s.material_id = m.id AND s.quantity > 0)
     ORDER BY (SELECT COUNT(*) FROM idx_stock s2 WHERE s2.material_id = m.id) ASC,
              (SELECT COUNT(*) FROM idx_movement v WHERE v.material_id = m.id) DESC,
              m.name
     LIMIT 1`
  ).get();
  if (!material) throw new HttpError(500, 'No sold-out material available to demo with');
  const receipt = postReceipt(
    db,
    {
      lines: [
        { material_id: material.id, quantity: 7, unit_cost: 40 },
        { material_id: material.id, quantity: 5, unit_cost: 45 },
      ],
      notes: 'Demo setup: 12 units across two batches',
    },
    user
  );
  return { material, receipt };
}

/** The colleague in the other tab sells `quantity` (FIFO across batches) of a material. */
export function demoColleagueSale(db, { material_id, quantity = 10 } = {}, user = '7') {
  if (!material_id) throw new HttpError(400, 'material_id is required');
  const want = num(quantity);
  const batches = stmt(
    db,
    'SELECT batch_id, quantity, unit_cost FROM idx_stock WHERE material_id = ? AND quantity > 0 ORDER BY received_at ASC, batch_id ASC'
  ).all(material_id);
  const available = batches.reduce((s, b) => s + b.quantity, 0);
  if (available < want) {
    throw new HttpError(409, 'Not enough stock for the demo sale', { available, requested: want });
  }
  const suggested = lastSalePrice(db, material_id);
  let left = want;
  const lines = [];
  for (const b of batches) {
    if (left <= 1e-9) break;
    const take = Math.min(left, b.quantity);
    lines.push({
      material_id,
      batch_id: b.batch_id,
      quantity: take,
      unit_price: suggested ?? round2(Number(b.unit_cost) * 1.35),
    });
    left = round2(left - take);
  }
  const customer = stmt(db, 'SELECT id FROM idx_customer ORDER BY name LIMIT 1').get();
  const invoice = saveInvoice(
    db,
    {
      customer_id: customer.id,
      lines,
      request_id: randomUUID(),
      notes: 'Demo: colleague sale from another tab',
    },
    user
  );
  return { invoice, sold_from_batches: lines };
}

/** The storekeeper posts a receipt with 60 lines in one transaction. */
export function demoReceipt60(db, user = '4') {
  const materials = stmt(db, 'SELECT id FROM idx_material WHERE is_active = 1 ORDER BY name LIMIT 400').all();
  if (materials.length < 60) throw new HttpError(500, 'Not enough materials for the 60-line demo receipt');
  const step = Math.max(1, Math.floor(materials.length / 60));
  const picked = [];
  for (let i = 0; i < materials.length && picked.length < 60; i += step) picked.push(materials[i].id);
  const lines = picked.map((id, i) => ({
    material_id: id,
    quantity: 1 + (i % 5),
    unit_cost: round2(20 + ((i * 37) % 180) + (i % 10) / 10),
  }));
  const receipt = postReceipt(
    db,
    { lines, notes: 'Demo: storekeeper posts a 60-line goods receipt', request_id: randomUUID() },
    user
  );
  return { receipt };
}
