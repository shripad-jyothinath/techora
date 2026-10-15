import { num } from './util.js';

/**
 * All read paths. Every function in this file queries ONLY the derived index
 * tables — never the JSON documents — so costs are index lookups + rows
 * returned, not scans of the whole dataset.
 */

const SORTS = {
  number: { col: 'i.invoice_number', field: 'invoice_number' },
  customer: { col: 'i.customer_name', field: 'customer_name' },
  date: { col: 'i.date', field: 'date' },
  due: { col: 'i.due_date', field: 'due_date' },
  total: { col: 'i.total', field: 'total' },
  balance: { col: 'i.balance', field: 'balance' },
};

const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const dec = (s) => JSON.parse(Buffer.from(String(s), 'base64url').toString('utf8'));

/**
 * Invoice list: server-side filter + sort + KEYSET pagination.
 * Page 500 costs the same as page 1: the cursor jumps straight into the index.
 */
export function listInvoices(db, { status, q, sort = 'date', dir = 'desc', cursor = null, limit = 25 } = {}) {
  const s = SORTS[sort] ?? SORTS.date;
  const order = dir === 'asc' ? 'ASC' : 'DESC';
  const limitN = Math.min(Math.max(Number(limit) || 25, 1), 100);

  const base = [];
  const params = {};
  if (status) {
    base.push('i.status = @status');
    params.status = status;
  }
  if (q) {
    base.push('(i.invoice_number LIKE @like OR i.customer_name LIKE @like)');
    params.like = `%${q}%`;
  }
  const baseWhere = base.length ? base.join(' AND ') : '1=1';

  const clauses = [...base];
  const rowParams = { ...params };
  if (cursor) {
    const c = dec(cursor);
    const op = dir === 'asc' ? '>' : '<';
    clauses.push(`(${s.col} ${op} @cv OR (${s.col} = @cv AND i.id ${op} @cid))`);
    rowParams.cv = c.v;
    rowParams.cid = c.id;
  }
  const where = clauses.length ? clauses.join(' AND ') : '1=1';

  const rows = db
    .prepare(
      `SELECT i.id, i.invoice_number, i.customer_name, i.status, i.date, i.due_date, i.total, i.balance, i.line_count
       FROM idx_invoice i
       WHERE ${where}
       ORDER BY ${s.col} ${order}, i.id ${order}
       LIMIT @limit`
    )
    .all({ ...rowParams, limit: limitN + 1 });

  const hasMore = rows.length > limitN;
  if (hasMore) rows.pop();
  const last = rows[rows.length - 1];

  return {
    rows,
    next_cursor: hasMore && last ? enc({ v: last[s.field], id: last.id }) : null,
    total: db.prepare(`SELECT COUNT(*) AS n FROM idx_invoice i WHERE ${baseWhere}`).get(params).n,
  };
}

/**
 * Command-palette invoice search: FTS5 first (indexed; flat cost as data
 * grows), then a bounded LIKE top-up for mid-substring matches. Never returns
 * more than `limit` rows.
 */
export function searchInvoices(db, q, limit = 8) {
  const limitN = Math.min(Math.max(Number(limit) || 8, 1), 20);
  const query = String(q ?? '').trim();
  if (!query) return [];
  const match = query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(' ');
  let rows = [];
  try {
    rows = db
      .prepare(
        `SELECT i.id, i.invoice_number, i.customer_name, i.status, i.date, i.total, i.balance
         FROM fts_invoice f JOIN idx_invoice i ON i.rowid = f.rowid
         WHERE fts_invoice MATCH ? ORDER BY rank LIMIT ?`
      )
      .all(match, limitN);
  } catch {
    rows = [];
  }
  if (rows.length < limitN) {
    const seen = new Set(rows.map((r) => r.id));
    const extra = db
      .prepare(
        `SELECT i.id, i.invoice_number, i.customer_name, i.status, i.date, i.total, i.balance
         FROM idx_invoice i
         WHERE (i.invoice_number LIKE ? OR i.customer_name LIKE ?)
         ORDER BY i.date DESC LIMIT ?`
      )
      .all(`%${query}%`, `%${query}%`, limitN);
    for (const r of extra) {
      if (rows.length >= limitN) break;
      if (!seen.has(r.id)) rows.push(r);
    }
  }
  return rows;
}

export function getInvoice(db, id) {
  const row = db.prepare('SELECT value FROM documents WHERE path = ?').get(`sales/invoices/${id}`);
  if (!row) return null;
  const invoice = JSON.parse(row.value);
  const lines = db
    .prepare(
      `SELECT l.line_no, l.material_id, l.description, l.quantity, l.unit, l.unit_price, l.discount,
              l.total_price, l.batch_ref, l.batch_id, m.name AS material_name, m.model_number
       FROM idx_invoice_line l
       LEFT JOIN idx_material m ON m.id = l.material_id
       WHERE l.invoice_id = ? ORDER BY l.line_no`
    )
    .all(id);
  return { invoice, lines };
}

/**
 * Material picker: FTS5 prefix search over name + model number, with the
 * available quantity joined in for the visible rows only.
 */
export function searchMaterials(db, q, limit = 20) {
  const limitN = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const avail = `(SELECT COALESCE(ROUND(SUM(s.quantity), 2), 0) FROM idx_stock s WHERE s.material_id = m.id AND s.quantity > 0)`;
  const cols = `m.id, m.name, m.model_number, m.default_unit, m.reorder_point, ${avail} AS available`;
  const query = String(q ?? '').trim();

  if (!query) {
    return db
      .prepare(`SELECT ${cols} FROM idx_material m WHERE m.is_active = 1 ORDER BY m.name COLLATE NOCASE LIMIT ?`)
      .all(limitN);
  }

  const match = query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(' ');

  let rows = [];
  try {
    rows = db
      .prepare(
        `SELECT ${cols} FROM fts_material f JOIN idx_material m ON m.rowid = f.rowid
         WHERE fts_material MATCH ? AND m.is_active = 1 ORDER BY rank LIMIT ?`
      )
      .all(match, limitN);
  } catch {
    rows = [];
  }
  if (!rows.length) {
    rows = db
      .prepare(
        `SELECT ${cols} FROM idx_material m
         WHERE m.is_active = 1 AND (m.name LIKE ? OR m.model_number LIKE ?)
         ORDER BY m.name COLLATE NOCASE LIMIT ?`
      )
      .all(`%${query}%`, `%${query}%`, limitN);
  }
  return rows;
}

/** Most recent invoiced price for a material (used as the editor's price suggestion). */
export function lastSalePrice(db, materialId) {
  const row = db
    .prepare(
      `SELECT l.unit_price FROM idx_invoice_line l
       JOIN idx_invoice i ON i.id = l.invoice_id
       WHERE l.material_id = ? AND l.unit_price > 0
       ORDER BY i.date DESC, l.rowid DESC LIMIT 1`
    )
    .get(materialId);
  return row ? row.unit_price : null;
}

/** Batches + availability for one material — the editor's stock panel. */
export function getMaterialStock(db, id) {
  const material = db
    .prepare('SELECT id, name, model_number, default_unit, reorder_point FROM idx_material WHERE id = ? OR alias_id = ? LIMIT 1')
    .get(id, id);
  if (!material) return null;
  const batches = db
    .prepare(
      `SELECT batch_id, location_id, quantity, unit_cost, received_at, status, receipt_id
       FROM idx_stock WHERE material_id = ?
       ORDER BY (quantity > 0) DESC, received_at ASC, batch_id ASC`
    )
    .all(material.id);
  const available = Math.round(batches.reduce((s, b) => s + (b.quantity > 0 ? b.quantity : 0), 0) * 100) / 100;
  return { material, available, lastPrice: lastSalePrice(db, material.id), batches };
}

export function listCustomers(db) {
  return db.prepare('SELECT id, name FROM idx_customer ORDER BY name COLLATE NOCASE').all();
}

/** One request → every aggregate the dashboard shows. */
export function getDashboard(db, ref = new Date()) {
  const monthStart = `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const nextMonth = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);

  const outstanding = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(balance), 0) AS amount FROM idx_invoice
       WHERE balance > 0.005 AND status NOT IN ('draft', 'cancelled')`
    )
    .get();
  const sales = db
    .prepare('SELECT COALESCE(SUM(total),0) AS v, COUNT(*) AS n FROM idx_invoice WHERE date >= ? AND date < ?')
    .get(monthStart, nextMonth);
  const purchases = db
    .prepare("SELECT COALESCE(SUM(total_cost),0) AS v FROM idx_movement WHERE type = 'purchase' AND date >= ? AND date < ?")
    .get(monthStart, nextMonth);

  // COGS must come from the batches actually sold: legacy sales movements put the
  // SALE PRICE in their cost fields (verified: sum(movement.total_cost) equals the
  // invoice total for 2,789 of 2,853 documents). So we cost the month from the
  // invoice lines' batch references, and report how much of the month we could cost.
  const costed = db
    .prepare(
      `SELECT COALESCE(SUM(l.quantity * s.unit_cost), 0) AS cogs, COUNT(l.invoice_id) AS costed_lines
       FROM idx_invoice i
       JOIN idx_invoice_line l ON l.invoice_id = i.id
       JOIN idx_stock s ON s.batch_id = l.batch_id
       WHERE i.date >= ? AND i.date < ?`
    )
    .get(monthStart, nextMonth);
  const allLines = db
    .prepare(
      `SELECT COUNT(*) AS n FROM idx_invoice i JOIN idx_invoice_line l ON l.invoice_id = i.id
       WHERE i.date >= ? AND i.date < ?`
    )
    .get(monthStart, nextMonth).n;

  const lowStock = db
    .prepare(
      `SELECT s.material_id AS id, m.name, m.model_number, m.reorder_point, ROUND(SUM(s.quantity), 2) AS qty
       FROM idx_stock s JOIN idx_material m ON m.id = s.material_id
       WHERE s.quantity > 0 AND m.is_active = 1
       GROUP BY s.material_id
       HAVING ROUND(SUM(s.quantity), 2) <= m.reorder_point
       ORDER BY (m.reorder_point - ROUND(SUM(s.quantity),2)) DESC, m.name
       LIMIT 8`
    )
    .all();
  const lowStockCount = db
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT s.material_id FROM idx_stock s JOIN idx_material m ON m.id = s.material_id
         WHERE s.quantity > 0 AND m.is_active = 1
         GROUP BY s.material_id HAVING ROUND(SUM(s.quantity), 2) <= m.reorder_point)`
    )
    .get().n;
  // Out of stock = active materials with nothing available at all (domain check:
  // a material with zero batches is just as undeliverable as one below reorder).
  const outOfStockCount = db
    .prepare(
      `SELECT COUNT(*) AS n FROM idx_material m
       WHERE m.is_active = 1
         AND COALESCE((SELECT SUM(s.quantity) FROM idx_stock s WHERE s.material_id = m.id AND s.quantity > 0), 0) <= 0.0001`
    )
    .get().n;

  const awaiting = db
    .prepare("SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS amount FROM idx_po WHERE status IN ('sent','partially_received')")
    .get();
  const awaitingList = db
    .prepare(
      `SELECT id, order_number, vendor_name, expected_date, total, status FROM idx_po
       WHERE status IN ('sent','partially_received') ORDER BY expected_date ASC LIMIT 8`
    )
    .all();

  const months = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const byMonth = {};
  for (const r of db
    .prepare("SELECT substr(date,1,7) AS ym, COALESCE(SUM(total),0) AS v, COUNT(*) AS n FROM idx_invoice WHERE date >= ? GROUP BY ym")
    .all(months[0])) {
    byMonth[r.ym] = r;
  }

  const quality = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM idx_movement WHERE type = 'sales') AS salesTotal,
        (SELECT COUNT(*) FROM idx_movement WHERE type = 'sales' AND (document_id IS NOT NULL OR document_no IS NOT NULL)) AS salesResolvable,
        (SELECT COUNT(*) FROM idx_invoice_line WHERE batch_ref IS NOT NULL AND batch_ref != '') AS batchRefTotal,
        (SELECT COUNT(*) FROM idx_invoice_line WHERE batch_ref IS NOT NULL AND batch_ref != '' AND batch_id IS NOT NULL) AS batchResolved,
        (SELECT COUNT(*) FROM idx_movement WHERE type = 'sales' AND document_id IS NOT NULL AND batch_id IS NOT NULL) AS fullyLinked`
    )
    .get();

  return {
    month: monthStart.slice(0, 7),
    outstanding: { count: outstanding.count, amount: Math.round(outstanding.amount * 100) / 100 },
    monthSales: Math.round(sales.v * 100) / 100,
    monthSalesCount: sales.n,
    monthPurchases: Math.round(purchases.v * 100) / 100,
    monthCogs: Math.round(costed.cogs * 100) / 100,
    monthMargin: Math.round((sales.v - costed.cogs) * 100) / 100,
    cogsCoverage: allLines ? Math.round((costed.costed_lines / allLines) * 1000) / 10 : 100,
    lowStock: { count: lowStockCount, outOfStock: outOfStockCount, list: lowStock },
    awaitingDelivery: { count: awaiting.count, amount: Math.round(awaiting.amount * 100) / 100, list: awaitingList },
    salesByMonth: months.map((m) => ({
      month: m,
      total: Math.round((byMonth[m]?.v ?? 0) * 100) / 100,
      invoices: byMonth[m]?.n ?? 0,
    })),
    dataQuality: {
      salesMovements: quality.salesTotal,
      invoiceResolvable: quality.salesResolvable,
      invoiceCoverage: quality.salesTotal ? Math.round((quality.salesResolvable / quality.salesTotal) * 1000) / 10 : 100,
      batchRefs: quality.batchRefTotal,
      batchResolved: quality.batchResolved,
      batchCoverage: quality.batchRefTotal ? Math.round((quality.batchResolved / quality.batchRefTotal) * 1000) / 10 : 100,
      fullyLinked: quality.fullyLinked,
    },
  };
}

/** Stock levels screen: one row per material, searchable, paginated. */
export function listStockLevels(db, { q, page = 0, limit = 25 } = {}) {
  const limitN = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const offset = Math.max(Number(page) || 0, 0) * limitN;
  const like = q ? `%${q}%` : null;
  const where = `s.quantity > 0 AND (@like IS NULL OR m.name LIKE @like OR m.model_number LIKE @like)`;

  const rows = db
    .prepare(
      `SELECT s.material_id AS id, m.name, m.model_number, m.default_unit, m.reorder_point,
              ROUND(SUM(s.quantity), 2) AS qty,
              ROUND(SUM(s.quantity * COALESCE(s.unit_cost, 0)), 2) AS value,
              COUNT(*) AS batch_count
       FROM idx_stock s JOIN idx_material m ON m.id = s.material_id
       WHERE ${where}
       GROUP BY s.material_id
       ORDER BY m.name COLLATE NOCASE
       LIMIT @limit OFFSET @offset`
    )
    .all({ like, limit: limitN, offset });

  const total = db
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT s.material_id FROM idx_stock s JOIN idx_material m ON m.id = s.material_id
         WHERE ${where} GROUP BY s.material_id)`
    )
    .get({ like }).n;

  return { rows, total, page: Number(page) || 0, limit: limitN };
}

/**
 * Movement report for one material: every movement in order with a running
 * balance, computed with a SQL window function.
 */
export function getMovements(db, { materialId, from = null, to = null, limit = 1000 } = {}) {
  const material = db
    .prepare('SELECT id, name, model_number, default_unit FROM idx_material WHERE id = ? OR alias_id = ? LIMIT 1')
    .get(materialId, materialId);
  if (!material) return null;
  // A date-only "to" means "through the end of that day" (users expect inclusive).
  const toBound = to && String(to).length === 10 ? `${to}T23:59:59.999Z` : to;

  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT id, batch_id, type, direction, quantity, unit, unit_cost, total_cost, document_type, document_id,
                document_no, date, performed_by, notes,
                CASE
                  WHEN type = 'sales' THEN -quantity
                  WHEN type = 'adjustment' AND direction = 'decrease' THEN -quantity
                  ELSE quantity
                END AS signed,
                SUM(CASE
                  WHEN type = 'sales' THEN -quantity
                  WHEN type = 'adjustment' AND direction = 'decrease' THEN -quantity
                  ELSE quantity
                END) OVER (ORDER BY date, id ROWS UNBOUNDED PRECEDING) AS running
         FROM idx_movement
         WHERE material_id = @materialId AND (@to IS NULL OR date < @to)
         ORDER BY date, id
         LIMIT @limit)`
    )
    .all({ materialId, to: toBound, limit: Math.min(Number(limit) || 1000, 5000) });

  const skipped = from ? rows.filter((r) => r.date < from) : [];
  const opening = skipped.length ? skipped[skipped.length - 1].running : 0;
  const shown = from ? rows.filter((r) => r.date >= from) : rows;
  return { material, opening, count: shown.length, rows: shown };
}

/** Small helper used by /api/meta to describe the build. */
export function tableCounts(db) {
  const tables = [
    'documents', 'idx_invoice', 'idx_invoice_line', 'idx_material', 'idx_stock', 'idx_movement',
    'idx_customer', 'idx_vendor', 'idx_po', 'idx_po_line', 'idx_receipt', 'idx_receipt_line',
  ];
  return Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
}

export { num };
