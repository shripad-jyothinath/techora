import Database from 'better-sqlite3';
const db = new Database('data/erp.sqlite', { readonly: true });

const stockIds = new Set(db.prepare('SELECT batch_id FROM idx_stock').all().map((r) => r.batch_id));
console.log('stock ids:', stockIds.size);

const lines = db
  .prepare("SELECT invoice_id, line_no, material_id, batch_ref FROM idx_invoice_line WHERE batch_ref IS NOT NULL AND batch_ref != ''")
  .all();

let direct = 0; let prefix = 0; let prefixResolved = 0; let directResolved = 0;

for (const l of lines) {
  const ref = String(l.batch_ref);
  if (stockIds.has(ref)) { direct += 1; directResolved += 1; }
  const pref = l.material_id ? `${l.material_id}_` : null;
  if (pref && ref.startsWith(pref)) {
    prefix += 1;
    const candidate = ref.slice(pref.length);
    if (stockIds.has(candidate)) prefixResolved += 1;
  }
}
console.log(`lines: ${lines.length} · direct stock-id matches: ${direct}/${directResolved} · materialId_ prefix: ${prefix} · prefix resolves to a stock row: ${prefixResolved}`);

// distribution of ref shapes
const shapes = {};
for (const l of lines) {
  const ref = String(l.batch_ref);
  const pref = l.material_id ? `${l.material_id}_` : '';
  const shape = pref && ref.startsWith(pref) ? 'materialId_<id>' : ref.includes('_') ? 'other_with_underscore' : 'plain';
  shapes[shape] = (shapes[shape] || 0) + 1;
}
console.log('shapes:', shapes);

// sample a resolved example end to end
const ex = lines.find((l) => l.material_id && String(l.batch_ref).startsWith(`${l.material_id}_`) && stockIds.has(String(l.batch_ref).slice(l.material_id.length + 1)));
if (ex) console.log('example:', ex, '→ batch', String(ex.batch_ref).slice(ex.material_id.length + 1));
