import Database from 'better-sqlite3';
const db = new Database('data/erp.sqlite', { readonly: true });

const invs = db.prepare("SELECT id, invoice_number, total FROM idx_invoice WHERE date >= '2026-10-01' ORDER BY date DESC LIMIT 6").all();
for (const i of invs) {
  const lines = db.prepare('SELECT quantity, unit_price, total_price FROM idx_invoice_line WHERE invoice_id = ?').all(i.id);
  const movs = db.prepare('SELECT quantity, unit_cost, total_cost FROM idx_movement WHERE document_no = ?').all(i.invoice_number);
  console.log(`\n${i.invoice_number} total=${i.total}`);
  console.log('  lines  :', JSON.stringify(lines));
  console.log('  movs   :', JSON.stringify(movs));
}

// Distribution: for legacy linked-by-note movements, compare movement total_cost vs invoice totals
const pairs = db.prepare(`
  SELECT mt.document_no AS no, SUM(mt.total_cost) AS mov_total, iv.total AS inv_total
  FROM idx_movement mt JOIN idx_invoice iv ON iv.invoice_number = mt.document_no
  WHERE mt.type = 'sales' AND mt.document_no IS NOT NULL
  GROUP BY mt.document_no LIMIT 8`).all();
console.log('\nsample comparison:', JSON.stringify(pairs, null, 1));

const same = db.prepare(`
  SELECT COUNT(*) AS n FROM (
    SELECT mt.document_no AS no FROM idx_movement mt JOIN idx_invoice iv ON iv.invoice_number = mt.document_no
    WHERE mt.type='sales' GROUP BY mt.document_no
    HAVING ABS(SUM(mt.total_cost) - MAX(iv.total)) < 0.02)`).get().n;
const all = db.prepare(`
  SELECT COUNT(*) AS n FROM (
    SELECT mt.document_no FROM idx_movement mt JOIN idx_invoice iv ON iv.invoice_number = mt.document_no
    WHERE mt.type='sales' GROUP BY mt.document_no)`).get().n;
console.log(`documents where sum(movement.total_cost) == invoice.total: ${same} of ${all}`);
