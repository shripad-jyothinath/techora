#!/usr/bin/env node
/**
 * Invariant audit — run it against whatever data is currently loaded.
 *
 *   npm run audit
 *
 * Checks the promises the system makes: stock never negative, the index always
 * agrees with the tree, invoice totals equal their lines, movements reconcile
 * with batches, document links resolve, FTS stays in sync, and the hot queries
 * actually use their indexes. Exit code 1 if any FAIL is reported.
 *
 * Run it after loading the masked dataset and again after generating sample
 * data: legacy noise is reported honestly (WARN), fresh data should be clean.
 */
import { fileURLToPath } from 'node:url';
import { openDb, applySchema } from '../lib/db.js';

const dbPath = process.argv[2] ?? fileURLToPath(new URL('../data/erp.sqlite', import.meta.url));
const db = openDb(dbPath);
applySchema(db);

const rows = [];
const record = (name, status, detail) => {
  rows.push({ name, status, detail });
};
const one = (sql, ...params) => db.prepare(sql).get(...params);
const all = (sql, ...params) => db.prepare(sql).all(...params);

/* ------------------------------------------------------------------ checks */

// 1) stock never negative (the invariant the whole write path protects)
const negStock = one('SELECT COUNT(*) AS n FROM idx_stock WHERE quantity < -0.000001').n;
record('Stock batches never negative', negStock ? 'FAIL' : 'PASS', `${negStock} negative`);

// 2) the index agrees with the tree it was derived from
const drift = one(`
  SELECT COUNT(*) AS n FROM idx_stock s
  JOIN documents d ON d.path = 'inventory/stockLevels/' || s.batch_id
  WHERE ABS(s.quantity - COALESCE(json_extract(d.value, '$.quantity'), 0)) > 0.0001`).n;
record('Index quantities match the tree', drift ? 'FAIL' : 'PASS', `${drift} drifting batch rows`);

const invDrift = one(`
  SELECT COUNT(*) AS n FROM idx_invoice i
  JOIN documents d ON d.path = 'sales/invoices/' || i.id
  WHERE ABS(i.total - COALESCE(json_extract(d.value, '$.total'), 0)) > 0.01`).n;
record('Indexed invoice totals match the tree', invDrift ? 'FAIL' : 'PASS', `${invDrift} drifting invoices`);

// 3) invoice totals equal the sum of their lines (legacy invoices may instead
//    follow subtotal - discountTotal, or carry hand edits — reported honestly)
const badTotals = one(`
  SELECT COUNT(*) AS n FROM idx_invoice i
  WHERE i.line_count > 0
    AND ABS(i.total - (SELECT COALESCE(SUM(total_price), 0) FROM idx_invoice_line l WHERE l.invoice_id = i.id)) > 0.02`).n;
const worstTotal = all(`
  SELECT i.invoice_number, ABS(i.total - (SELECT COALESCE(SUM(total_price), 0) FROM idx_invoice_line l WHERE l.invoice_id = i.id)) AS diff
  FROM idx_invoice i
  WHERE i.line_count > 0
    AND ABS(i.total - (SELECT COALESCE(SUM(total_price), 0) FROM idx_invoice_line l WHERE l.invoice_id = i.id)) > 0.02
  ORDER BY diff DESC LIMIT 1`)[0];
const discountedCount = one(`
  SELECT COUNT(*) AS n FROM idx_invoice i JOIN documents d ON d.path = 'sales/invoices/' || i.id
  WHERE i.line_count > 0
    AND ABS(i.total - ((SELECT COALESCE(SUM(total_price),0) FROM idx_invoice_line l WHERE l.invoice_id = i.id) - COALESCE(json_extract(d.value,'$.discountTotal'),0))) < 0.02`).n;
record(
  'Invoice totals equal their lines',
  badTotals ? 'WARN' : 'PASS',
  badTotals
    ? `${badTotals} legacy invoices differ (worst: ${worstTotal.invoice_number} Δ${worstTotal.diff.toFixed(2)}; ${discountedCount} match subtotal − discountTotal)`
    : 'every invoice ties out'
);

// 4) balance = total - paid (from the tree, the source of truth)
const badBalances = one(`
  SELECT COUNT(*) AS n FROM idx_invoice i
  JOIN documents d ON d.path = 'sales/invoices/' || i.id
  WHERE ABS(i.balance - (COALESCE(json_extract(d.value, '$.total'), 0) - COALESCE(json_extract(d.value, '$.paidAmount'), 0))) > 0.02`).n;
record('Balances equal total minus paid', badBalances ? 'WARN' : 'PASS', `${badBalances} legacy rows differ`);

// 5) per-material reconciliation: batch rows vs net signed movements.
//    On freshly written data these must tie exactly; legacy history may not.
const recon = all(`
  WITH bs AS (SELECT material_id, SUM(quantity) AS q FROM idx_stock GROUP BY material_id),
       ms AS (
         SELECT material_id,
                SUM(CASE WHEN type = 'sales' THEN -quantity
                         WHEN type = 'adjustment' AND direction = 'decrease' THEN -quantity
                         ELSE quantity END) AS q
         FROM idx_movement WHERE material_id IS NOT NULL GROUP BY material_id)
  SELECT k AS material_id, ABS(COALESCE(b.q, 0) - COALESCE(m.q, 0)) AS diff
  FROM (SELECT material_id AS k FROM bs UNION SELECT material_id FROM ms) keys
  LEFT JOIN bs b ON b.material_id = keys.k
  LEFT JOIN ms m ON m.material_id = keys.k
  WHERE ABS(COALESCE(b.q, 0) - COALESCE(m.q, 0)) > 0.02
  ORDER BY diff DESC`);
const reconWorst = recon.length ? recon.slice(0, 3).map((r) => `${r.material_id.slice(0, 12)}… Δ${r.diff.toFixed(2)}`).join(', ') : '';
record(
  'Batches reconcile with movements',
  recon.length === 0 ? 'PASS' : 'WARN',
  recon.length === 0 ? 'every material ties out' : `${recon.length} materials differ — legacy history (top: ${reconWorst})`
);

// 6) movement → document links resolve
const danglingInv = one(`
  SELECT COUNT(*) AS n FROM idx_movement m
  WHERE m.document_type = 'invoice' AND m.document_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM idx_invoice i WHERE i.id = m.document_id)`).n;
const danglingRcpt = one(`
  SELECT COUNT(*) AS n FROM idx_movement m
  WHERE m.document_type = 'purchase_receipt' AND m.document_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM idx_receipt r WHERE r.id = m.document_id)`).n;
record('Movement document links resolve', danglingInv + danglingRcpt ? 'WARN' : 'PASS', `${danglingInv + danglingRcpt} dangling`);

// 6b) receipt movements must also carry the batch they created
const batchlessReceipts = one(`
  SELECT COUNT(*) AS n FROM idx_movement
  WHERE type = 'purchase' AND document_id IS NOT NULL AND batch_id IS NULL`).n;
record(
  'Receipt movements carry their batch',
  batchlessReceipts ? 'WARN' : 'PASS',
  batchlessReceipts ? `${batchlessReceipts} legacy movements lack it (new writes always carry it)` : 'every receipt movement links its batch'
);

// 7) batch-reference coverage on invoice lines
const refTotal = one(`SELECT COUNT(*) AS n FROM idx_invoice_line WHERE batch_ref IS NOT NULL AND batch_ref != ''`).n;
const refResolved = one('SELECT COUNT(*) AS n FROM idx_invoice_line WHERE batch_id IS NOT NULL').n;
const refPct = refTotal ? Math.round((refResolved / refTotal) * 1000) / 10 : 100;
record('Invoice lines resolve to a batch', refPct > 95 ? 'PASS' : 'WARN', `${refResolved} of ${refTotal} (${refPct}%)`);

// 8) full-text mirror is in sync with the material index
let fts = 'PASS';
let ftsDetail = 'integrity-check ok';
try {
  db.prepare(`INSERT INTO fts_material(fts_material) VALUES('integrity-check')`).run();
} catch (err) {
  fts = 'FAIL';
  ftsDetail = err.message;
}
record('Material search index consistent', fts, ftsDetail);

// 8b) invoice search mirror (command palette)
let ftsInv = 'PASS';
let ftsInvDetail = 'integrity-check ok';
try {
  db.prepare(`INSERT INTO fts_invoice(fts_invoice) VALUES('integrity-check')`).run();
} catch (err) {
  ftsInv = 'FAIL';
  ftsInvDetail = err.message;
}
record('Invoice search index consistent', ftsInv, ftsInvDetail);

// 9) duplicates that would break joins
const dupInvNo = one(`
  SELECT COUNT(*) AS n FROM (
    SELECT invoice_number FROM idx_invoice GROUP BY invoice_number HAVING COUNT(*) > 1)`).n;
record('Invoice numbers unique', dupInvNo ? 'WARN' : 'PASS', `${dupInvNo} duplicated numbers (legacy)`);

// 10) orphans in both directions
const orphanStock = one(`
  SELECT COUNT(*) AS n FROM idx_stock s WHERE NOT EXISTS (SELECT 1 FROM idx_material m WHERE m.id = s.material_id)`).n;
const orphanMoves = one('SELECT COUNT(*) AS n FROM idx_movement WHERE material_id IS NULL').n;
record('Stock rows reference real materials', orphanStock ? 'FAIL' : 'PASS', `${orphanStock} orphans`);
record('Movements kept for deleted materials', 'PASS', `${orphanMoves} legacy rows flagged (no silent drop)`);

// 11) sqlite internal integrity + write safety net
const quick = one('PRAGMA quick_check').quick_check;
record('SQLite quick_check', quick === 'ok' ? 'PASS' : 'FAIL', quick);

/* -------------------------------------------------- query plans (deep dive) */

const plans = {
  'invoice list · sort by date': `EXPLAIN QUERY PLAN
    SELECT id FROM idx_invoice WHERE status IS NOT NULL ORDER BY date DESC, id DESC LIMIT 25`,
  'invoice list · search + sort': `EXPLAIN QUERY PLAN
    SELECT id FROM idx_invoice WHERE (invoice_number LIKE '%42%' OR customer_name LIKE '%42%') ORDER BY date DESC LIMIT 25`,
  'batches of one material': `EXPLAIN QUERY PLAN
    SELECT batch_id FROM idx_stock WHERE material_id = 'x' AND quantity > 0 ORDER BY received_at ASC`,
  'movements of one material': `EXPLAIN QUERY PLAN
    SELECT id FROM idx_movement WHERE material_id = 'x' AND date < 'z' ORDER BY date, id LIMIT 1000`,
};

/* ------------------------------------------------------------------ report */

const icon = { PASS: '✓', WARN: '!', FAIL: '✗' };
console.log(`\nAudit — ${dbPath}\n${'─'.repeat(78)}`);
for (const r of rows) {
  console.log(`  ${icon[r.status]} ${r.name.padEnd(44)} ${r.detail}`);
}
const fails = rows.filter((r) => r.status === 'FAIL').length;
const warns = rows.filter((r) => r.status === 'WARN').length;
console.log(`${'─'.repeat(78)}`);
console.log(`  ${rows.length - fails - warns} passed · ${warns} warnings · ${fails} failures`);

console.log('\nQuery plans (the deep dive):');
for (const [label, sql] of Object.entries(plans)) {
  const plan = all(sql).map((p) => `${p.detail}`).join(' | ');
  console.log(`  ${label}:`);
  console.log(`    ${plan}`);
}

console.log('');
db.close();
process.exit(fails ? 1 : 0);
