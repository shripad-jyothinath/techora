import Database from 'better-sqlite3';
const db = new Database('data/erp.sqlite', { readonly: true });

// what does the legacy batch reference look like?
console.log('batch_ref samples:');
console.log(
  db
    .prepare(
      `SELECT batch_ref, COUNT(*) AS n FROM idx_invoice_line
       WHERE batch_ref IS NOT NULL AND batch_ref != '' GROUP BY batch_ref ORDER BY n DESC LIMIT 10`
    )
    .all()
);

const resolvable = db
  .prepare(`SELECT COUNT(*) AS n FROM idx_invoice_line l WHERE l.batch_ref IS NOT NULL AND EXISTS (SELECT 1 FROM idx_stock s WHERE s.batch_id = l.batch_ref)`)
  .get().n;
const withRef = db.prepare("SELECT COUNT(*) AS n FROM idx_invoice_line WHERE batch_ref IS NOT NULL AND batch_ref != ''").get().n;
console.log(`lines with a batch_ref: ${withRef} of 5211 · resolving to a real batch: ${resolvable}`);

// October lines specifically
console.log(
  'october refs:',
  db
    .prepare(
      `SELECT COALESCE(NULLIF(l.batch_ref,''), '(none)') AS ref, COUNT(*) AS n
       FROM idx_invoice_line l JOIN idx_invoice i ON i.id = l.invoice_id
       WHERE i.date >= '2026-10-01' GROUP BY ref ORDER BY n DESC LIMIT 6`
    )
    .all()
);

// do line material_id + quantity let us cost anyway? check a couple of resolvable examples
console.log(
  'resolvable examples:',
  db
    .prepare(
      `SELECT l.batch_ref, s.material_id, s.unit_cost, l.quantity, l.unit_price
       FROM idx_invoice_line l JOIN idx_stock s ON s.batch_id = l.batch_ref LIMIT 5`
    )
    .all()
);

// movement cost semantics for purchases vs batch cost
console.log(
  'purchase movement vs batch cost (same material/receipt):',
  db
    .prepare(
      `SELECT m.unit_cost AS mov_cost, s.unit_cost AS batch_cost, s.quantity AS batch_qty
       FROM idx_movement m JOIN idx_stock s ON s.purchase_receipt_id = m.document_id AND s.material_id = m.material_id
       WHERE m.type='purchase' LIMIT 5`
    )
    .all()
);
