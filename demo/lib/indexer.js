import { num, numOrNull, nowIso } from './util.js';
import { applySchema, stmt } from './db.js';

/**
 * The derived index layer.
 *
 * indexDocument() is the ONLY function that maps a tree record into query
 * tables. Every write path (transform, dataset import, invoice save, receipt
 * post, fake-data generator) calls it, which is how the tree and the indexes
 * stay in agreement: they are written in the same SQLite transaction.
 *
 * Rebuildability: rebuildIndexes() can throw every derived table away and
 * rebuild it from `documents` alone. That is also the recovery path if an
 * index is ever suspected wrong ("derived values never silently wrong").
 */

export function indexDocument(db, collection, docId, doc, ctx = {}) {
  switch (collection) {
    case 'sales/invoices': return indexInvoice(db, docId, doc, ctx);
    case 'sales/customers': return indexCustomer(db, docId, doc);
    case 'inventory/materials': return indexMaterial(db, docId, doc);
    case 'inventory/stockLevels': return indexStock(db, docId, doc);
    case 'inventory/transactions': return indexMovement(db, docId, doc);
    case 'purchasing/vendors': return indexVendor(db, docId, doc);
    case 'purchasing/purchaseOrders': return indexPO(db, docId, doc);
    case 'purchasing/purchaseReceipts': return indexReceipt(db, docId, doc);
    default: return; // collections with no screen yet (units, adjustments…) stay tree-only
  }
}

/**
 * Legacy line references are composite: '<materialId>_<batchId>'. The batch
 * row id itself can contain '_', so strip the known material prefix instead of
 * splitting on the last underscore. New writes store a plain batch id.
 * Verified on the export: 4,684 of 4,717 references resolve this way.
 */
function resolveBatchRef(db, ref, materialId, ctx) {
  if (!ref) return null;
  const has = ctx.stockIds
    ? (id) => ctx.stockIds.has(id)
    : (id) => !!stmt(db, 'SELECT 1 FROM idx_stock WHERE batch_id = ?').get(id);
  if (has(ref)) return ref;
  if (materialId && ref.startsWith(`${materialId}_`)) {
    const candidate = ref.slice(materialId.length + 1);
    if (has(candidate)) return candidate;
  }
  return null;
}

function indexInvoice(db, id, inv, ctx = {}) {
  const items = Array.isArray(inv.items) ? inv.items : [];
  stmt(
    db,
    `INSERT INTO idx_invoice(id, invoice_number, customer_id, customer_name, status, date, due_date, total, balance, line_count, created_at, updated_at)
     VALUES(@id, @invoice_number, @customer_id, @customer_name, @status, @date, @due_date, @total, @balance, @line_count, @created_at, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       invoice_number=excluded.invoice_number, customer_id=excluded.customer_id, customer_name=excluded.customer_name,
       status=excluded.status, date=excluded.date, due_date=excluded.due_date, total=excluded.total,
       balance=excluded.balance, line_count=excluded.line_count, created_at=excluded.created_at, updated_at=excluded.updated_at`
  ).run({
    id,
    invoice_number: String(inv.invoiceNumber ?? ''),
    customer_id: inv.customerId ?? inv.customer?.id ?? null,
    customer_name: inv.customer?.name ?? null,
    status: inv.status ?? null,
    date: inv.date ? String(inv.date).slice(0, 10) : null,
    due_date: inv.dueDate ? String(inv.dueDate).slice(0, 10) : null,
    total: num(inv.total),
    balance: inv.balance !== undefined ? num(inv.balance) : num(inv.total) - num(inv.paidAmount),
    line_count: items.length,
    created_at: inv.createdAt ?? null,
    updated_at: inv.updatedAt ?? nowIso(),
  });

  stmt(db, 'DELETE FROM idx_invoice_line WHERE invoice_id = ?').run(id);
  const ins = stmt(
    db,
    `INSERT INTO idx_invoice_line(invoice_id, line_no, material_id, description, quantity, unit, unit_price, discount, total_price, batch_ref, batch_id)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  items.forEach((it, i) => {
    const materialId = it.productId ?? it.materialId ?? null;
    const rawRef = it.batchId ?? it.selectedBatchId ?? null;
    ins.run(
      id, i,
      materialId,
      it.description ?? '',
      num(it.quantity),
      it.unit ?? '',
      num(it.unitPrice),
      num(it.discount),
      num(it.totalPrice),
      rawRef,
      resolveBatchRef(db, rawRef, materialId, ctx)
    );
  });
}

function indexCustomer(db, id, c) {
  stmt(
    db,
    `INSERT INTO idx_customer(id, alias_id, name, email, phone, address_json)
     VALUES(@id, @alias, @name, @email, @phone, @address)
     ON CONFLICT(id) DO UPDATE SET alias_id=excluded.alias_id, name=excluded.name,
       email=excluded.email, phone=excluded.phone, address_json=excluded.address_json`
  ).run({
    id,
    alias: c.id && c.id !== id ? c.id : null,
    name: c.name ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    address: JSON.stringify(c.address ?? {}),
  });
}

function indexMaterial(db, id, m) {
  stmt(
    db,
    `INSERT INTO idx_material(id, alias_id, name, model_number, default_unit, reorder_point, is_active)
     VALUES(@id, @alias, @name, @model, @unit, @reorder, @active)
     ON CONFLICT(id) DO UPDATE SET alias_id=excluded.alias_id, name=excluded.name,
       model_number=excluded.model_number, default_unit=excluded.default_unit,
       reorder_point=excluded.reorder_point, is_active=excluded.is_active`
  ).run({
    id,
    alias: m.id && m.id !== id ? m.id : null,
    name: m.name ?? '(unnamed)',
    model: m.modelNumber ?? null,
    unit: m.defaultUnit ?? '',
    reorder: num(m.reorderPoint),
    active: m.isActive === false ? 0 : 1,
  });
}

function indexStock(db, id, s) {
  stmt(
    db,
    `INSERT INTO idx_stock(batch_id, material_id, location_id, receipt_id, receipt_line, vendor_id,
                           quantity, reserved_qty, unit_cost, total_cost, received_at, status)
     VALUES(@batch, @material, @location, @receipt, @line, @vendor,
            @qty, @reserved, @cost, @total, @received, @status)
     ON CONFLICT(batch_id) DO UPDATE SET
       material_id=excluded.material_id, location_id=excluded.location_id, receipt_id=excluded.receipt_id,
       receipt_line=excluded.receipt_line, vendor_id=excluded.vendor_id, quantity=excluded.quantity,
       reserved_qty=excluded.reserved_qty, unit_cost=excluded.unit_cost, total_cost=excluded.total_cost,
       received_at=excluded.received_at, status=excluded.status`
  ).run({
    batch: id,
    material: s.itemId ?? s.materialId ?? '',
    location: s.destinationLocationId ?? null,
    receipt: s.purchaseReceiptId ?? null,
    line: s.purchaseReceiptItemIndex ?? null,
    vendor: s.vendorId ?? null,
    qty: num(s.quantity),
    reserved: numOrNull(s.reservedQuantity),
    cost: numOrNull(s.costPerUnit),
    total: numOrNull(s.totalCost),
    received: s.lastUpdated ?? s.receivedAt ?? null,
    status: s.status ?? null,
  });
}

const INVOICE_NO_RE = /Invoice #?\s*([A-Z0-9][A-Z0-9-]*)/i;
const PO_NO_RE = /(?:PO|GRN):?\s*([A-Z0-9][A-Z0-9-]*)/i;
const BATCH_RE = /Batch:\s*([A-Za-z0-9_-]+)/;

function indexMovement(db, id, t) {
  const notes = String(t.notes ?? '');
  // 88.5% of legacy sales movements point at "new" instead of the invoice id.
  // The invoice number inside the free-text note is the only link — we parse it
  // into a searchable column, and mark document_id NULL so dashboards can be
  // honest about link coverage.
  const docNo =
    (notes.match(INVOICE_NO_RE) || [])[1] || (notes.match(PO_NO_RE) || [])[1] || null;
  // Structured batch id first (our writes); fall back to the note text (legacy).
  const batchMatch = notes.match(BATCH_RE);
  const batchId = t.batchId ?? (batchMatch && batchMatch[1] !== 'No' ? batchMatch[1] : null);
  const related = t.relatedDocumentId && t.relatedDocumentId !== 'new' ? t.relatedDocumentId : null;

  // Adjustment direction: our writes carry `direction`; legacy rows resolve it
  // from the linked stockAdjustment (adjustmentType increase/decrease).
  let direction = t.direction ?? null;
  if (!direction && t.transactionType === 'adjustment') {
    direction =
      stmt(
        db,
        `SELECT json_extract(value, '$.adjustmentType') AS dir FROM documents
         WHERE collection = 'inventory/stockAdjustments' AND json_extract(value, '$.transactionId') = ?
         LIMIT 1`
      ).get(id)?.dir ?? null;
  }

  // Keep the raw id even when the material was deleted (22 movements).
  const materialExists = stmt(db, 'SELECT 1 FROM idx_material WHERE id = ? OR alias_id = ? LIMIT 1').get(t.itemId, t.itemId);

  stmt(
    db,
    `INSERT INTO idx_movement(id, material_id, legacy_item, batch_id, type, direction, quantity, unit_cost, total_cost,
                              unit, document_type, document_id, document_no, date, performed_by, notes)
     VALUES(@id, @material, @legacy, @batch, @type, @direction, @qty, @cost, @total,
            @unit, @docType, @docId, @docNo, @date, @by, @notes)
     ON CONFLICT(id) DO UPDATE SET
       material_id=excluded.material_id, legacy_item=excluded.legacy_item, batch_id=excluded.batch_id,
       type=excluded.type, direction=excluded.direction, quantity=excluded.quantity, unit_cost=excluded.unit_cost,
       total_cost=excluded.total_cost, unit=excluded.unit, document_type=excluded.document_type,
       document_id=excluded.document_id, document_no=excluded.document_no, date=excluded.date,
       performed_by=excluded.performed_by, notes=excluded.notes`
  ).run({
    id,
    material: materialExists ? t.itemId : null,
    legacy: materialExists ? null : t.itemId,
    batch: batchId,
    type: t.transactionType ?? 'adjustment',
    direction,
    qty: num(t.quantity),
    cost: numOrNull(t.costPerUnit),
    total: numOrNull(t.totalCost),
    unit: t.unit ?? '',
    docType: t.relatedDocumentType ?? null,
    docId: related,
    docNo,
    date: t.transactionDate ?? t.createdAt ?? null,
    by: t.performedBy ?? null,
    notes,
  });
}

function indexVendor(db, id, v) {
  stmt(
    db,
    `INSERT INTO idx_vendor(id, alias_id, name) VALUES(@id, @alias, @name)
     ON CONFLICT(id) DO UPDATE SET alias_id=excluded.alias_id, name=excluded.name`
  ).run({ id, alias: v.id && v.id !== id ? v.id : null, name: v.name ?? '' });
}

function indexPO(db, id, po) {
  const items = Array.isArray(po.items) ? po.items : [];
  stmt(
    db,
    `INSERT INTO idx_po(id, order_number, vendor_id, vendor_name, status, order_date, expected_date, total, line_count)
     VALUES(@id, @number, @vendor, @vendorName, @status, @orderDate, @expected, @total, @lines)
     ON CONFLICT(id) DO UPDATE SET
       order_number=excluded.order_number, vendor_id=excluded.vendor_id, vendor_name=excluded.vendor_name,
       status=excluded.status, order_date=excluded.order_date, expected_date=excluded.expected_date,
       total=excluded.total, line_count=excluded.line_count`
  ).run({
    id,
    number: po.orderNumber ?? '',
    vendor: po.vendorId ?? null,
    vendorName: po.vendorName ?? null,
    status: po.status ?? null,
    orderDate: po.orderDate ? String(po.orderDate).slice(0, 10) : null,
    expected: po.expectedDeliveryDate ? String(po.expectedDeliveryDate).slice(0, 10) : null,
    total: num(po.total),
    lines: items.length,
  });

  stmt(db, 'DELETE FROM idx_po_line WHERE po_id = ?').run(id);
  const ins = stmt(
    db,
    `INSERT INTO idx_po_line(po_id, line_no, material_id, description, quantity, unit_price, total_price, received_qty)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
  );
  items.forEach((it, i) => {
    ins.run(id, i, it.materialId ?? null, it.description ?? '', num(it.quantity), num(it.unitPrice), num(it.totalPrice), num(it.receivedQuantity));
  });
}

function indexReceipt(db, id, r) {
  const items = Array.isArray(r.items) ? r.items : [];
  stmt(
    db,
    `INSERT INTO idx_receipt(id, receipt_number, receipt_date, po_id, vendor_id, status, line_count, total_cost)
     VALUES(@id, @number, @date, @po, @vendor, @status, @lines, @total)
     ON CONFLICT(id) DO UPDATE SET
       receipt_number=excluded.receipt_number, receipt_date=excluded.receipt_date, po_id=excluded.po_id,
       vendor_id=excluded.vendor_id, status=excluded.status, line_count=excluded.line_count,
       total_cost=excluded.total_cost`
  ).run({
    id,
    number: r.receiptNumber ?? '',
    date: r.receiptDate ? String(r.receiptDate).slice(0, 10) : null,
    po: r.purchaseOrderId ?? null,
    vendor: r.vendorId ?? null,
    status: r.status ?? null,
    lines: items.length,
    total: num(r.landedCost),
  });

  stmt(db, 'DELETE FROM idx_receipt_line WHERE receipt_id = ?').run(id);
  const ins = stmt(
    db,
    `INSERT INTO idx_receipt_line(receipt_id, line_no, material_id, description, quantity, location_id, unit)
     VALUES(?, ?, ?, ?, ?, ?, ?)`
  );
  items.forEach((it, i) => {
    ins.run(id, i, it.materialId ?? null, it.description ?? '', num(it.receivedQuantity), it.storageLocationId ?? null, it.unit ?? '');
  });
}

export const INDEX_TABLES = [
  'idx_invoice_line', 'idx_invoice',
  'idx_movement', 'idx_stock', 'idx_material',
  'idx_customer', 'idx_vendor',
  'idx_po_line', 'idx_po', 'idx_receipt_line', 'idx_receipt',
];

const FTS_TABLES = ['fts_material', 'fts_invoice'];
const FTS_TRIGGERS = [
  'trg_material_ai', 'trg_material_ad', 'trg_material_au',
  'trg_invoice_ai', 'trg_invoice_ad', 'trg_invoice_au',
];

/**
 * Throws all derived tables away and rebuilds them from `documents`.
 *
 * The FTS mirrors are external-content tables: clear the content tables while
 * their triggers are gone, then recreate everything via applySchema() and let
 * FTS5 `rebuild` populate the mirrors from the fresh content. (Deleting
 * content rows while triggers are active would emit 'delete' marks for rows
 * the mirror never indexed — that corrupts the index.)
 */
export function rebuildIndexes(db, log = console.log) {
  const t0 = Date.now();
  const rebuild = db.transaction(() => {
    for (const trg of FTS_TRIGGERS) db.exec(`DROP TRIGGER IF EXISTS ${trg}`);
    for (const t of FTS_TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);

    for (const t of INDEX_TABLES) db.prepare(`DELETE FROM ${t}`).run();

    const docs = db.prepare('SELECT collection, doc_id, value FROM documents').all();
    // Preload stock row ids so invoice lines can resolve their (possibly
    // composite) batch references inline, regardless of document order.
    const stockIds = new Set(
      db.prepare("SELECT doc_id FROM documents WHERE collection = 'inventory/stockLevels'").all().map((r) => r.doc_id)
    );
    const ctx = { stockIds };
    for (const d of docs) indexDocument(db, d.collection, d.doc_id, JSON.parse(d.value), ctx);

    // Enrichment: stock rows know their goods receipt; use the receipt date as
    // the batch's received_at (falls back to lastUpdated from the tree).
    db.prepare(`
      UPDATE idx_stock
      SET received_at = COALESCE((SELECT r.receipt_date FROM idx_receipt r WHERE r.id = idx_stock.receipt_id), received_at)
      WHERE receipt_id IS NOT NULL`).run();
  });
  rebuild.immediate();

  // Recreate the mirrors (and their triggers) from the schema, then populate.
  applySchema(db);
  db.prepare(`INSERT INTO fts_material(fts_material) VALUES('rebuild')`).run();
  db.prepare(`INSERT INTO fts_invoice(fts_invoice) VALUES('rebuild')`).run();

  const ms = Date.now() - t0;
  const resolved = db
    .prepare('SELECT COUNT(*) AS n FROM idx_invoice_line WHERE batch_ref IS NOT NULL AND batch_id IS NOT NULL')
    .get().n;
  const withRef = db.prepare('SELECT COUNT(*) AS n FROM idx_invoice_line WHERE batch_ref IS NOT NULL').get().n;
  log(`  indexes rebuilt from ${db.prepare('SELECT COUNT(*) n FROM documents').get().n} documents in ${ms} ms`);
  log(`  legacy batch references resolved: ${resolved} of ${withRef} invoice lines`);
  return { ms, resolved, withRef };
}
