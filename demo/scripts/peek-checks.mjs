import Database from 'better-sqlite3';
const db = new Database('data/erp.sqlite', { readonly: true });
console.log('new invoice movement:', db.prepare("SELECT type, document_type, document_id IS NOT NULL AS linked, batch_id IS NOT NULL AS has_batch, quantity FROM idx_movement WHERE document_no='INV-223467'").all());
console.log('receipt-60 batches:', db.prepare("SELECT COUNT(*) AS n FROM idx_stock s JOIN idx_receipt r ON r.id = s.receipt_id WHERE r.receipt_number='GRN-20261014-22517'").get());
console.log('new invoice line:', db.prepare("SELECT batch_ref, batch_id, quantity FROM idx_invoice_line WHERE invoice_id=(SELECT id FROM idx_invoice WHERE invoice_number='INV-223467')").all());
console.log('demo material batches (usable):', db.prepare("SELECT batch_id, quantity, unit_cost FROM idx_stock WHERE material_id='-OV2mo5i74Iur7SaNqst' AND quantity > 0 ORDER BY received_at").all());
