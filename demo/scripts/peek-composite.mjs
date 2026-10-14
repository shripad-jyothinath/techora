import Database from 'better-sqlite3';
const db = new Database('data/erp.sqlite', { readonly: true });

// map receipt item ids -> {receiptId, index, materialId} straight from the tree
const receiptItems = new Map();
for (const r of db.prepare("SELECT doc_id, value FROM documents WHERE collection='purchasing/purchaseReceipts'").all()) {
  const rec = JSON.parse(r.value);
  (rec.items ?? []).forEach((it, i) => {
    if (it.id) receiptItems.set(it.id, { receiptId: r.doc_id, index: i, materialId: it.materialId });
  });
}
console.log('receipt items mapped:', receiptItems.size);

const lines = db
  .prepare("SELECT invoice_id, line_no, material_id, batch_ref FROM idx_invoice_line WHERE batch_ref IS NOT NULL AND batch_ref != '' LIMIT 3000")
  .all();

let composite = 0; let resolved = 0; let materialMatch = 0;
const stockBy = db.prepare('SELECT batch_id FROM idx_stock WHERE receipt_id = ? AND receipt_line = ?');
for (const l of lines) {
  const ref = String(l.batch_ref);
  const sep = ref.lastIndexOf('_');
  if (sep <= 0) continue;
  const uuid = ref.slice(sep + 1);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(uuid)) continue;
  composite += 1;
  const info = receiptItems.get(uuid);
  if (!info) continue;
  if (info.materialId === l.material_id) materialMatch += 1;
  const stock = stockBy.get(info.receiptId, info.index);
  if (stock) resolved += 1;
}
console.log(`composite refs: ${composite} · receipt-item found: ? · material matches: ${materialMatch} · batch resolved: ${resolved}`);

// show a concrete example end to end
const example = lines.find((l) => {
  const ref = String(l.batch_ref);
  const uuid = ref.slice(ref.lastIndexOf('_') + 1);
  return receiptItems.has(uuid);
});
if (example) {
  const uuid = String(example.batch_ref).slice(String(example.batch_ref).lastIndexOf('_') + 1);
  const info = receiptItems.get(uuid);
  const stock = stockBy.get(info.receiptId, info.index);
  console.log('\nexample:', {
    ref: example.batch_ref,
    receiptItem: info,
    resolvedStock: stock,
    materialMatches: info.materialId === example.material_id,
  });
}
