import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../dataset/cora-erp-masked.json', import.meta.url), 'utf8'));
const sz = (o) => JSON.stringify(o).length;
const fmt = (n) => n.toLocaleString('en-US');

function shape(node, path, depth) {
  if (Array.isArray(node)) {
    console.log(`${path}  ARRAY(len=${node.length}, size=${fmt(sz(node))})`);
    if (node[0] && typeof node[0] === 'object') console.log(`    item keys: ${Object.keys(node[0]).join(', ')}`);
    return;
  }
  if (node && typeof node === 'object') {
    const keys = Object.keys(node);
    console.log(`${path}  OBJECT(keys=${keys.length}, size=${fmt(sz(node))})`);
    if (depth > 0) for (const k of keys) shape(node[k], `${path}/${k}`, depth - 1);
    return;
  }
  console.log(`${path} = ${JSON.stringify(node).slice(0, 90)}`);
}

shape(data, 'root', 2);

console.log('\n=== SAMPLES (field: type/value) ===');
function sample(label, rec) {
  console.log(`\n[${label}]`);
  if (rec == null) { console.log('  (missing)'); return; }
  for (const [k, v] of Object.entries(rec)) {
    if (Array.isArray(v)) console.log(`  ${k}: array(${v.length})`);
    else if (v && typeof v === 'object') console.log(`  ${k}: {${Object.keys(v).join(',')}}`);
    else console.log(`  ${k}: ${typeof v} = ${String(v).slice(0, 70)}`);
  }
}

const inv = data.inventory ?? {};
const sales = data.sales ?? {};
const purch = data.purchasing ?? {};
const firstOf = (o) => (o && Object.values(o)[0]) || null;

sample('inventory/transactions', firstOf(inv.transactions));
sample('inventory/stockLevels', firstOf(inv.stockLevels));
sample('inventory/materials', firstOf(inv.materials));
sample('inventory/stockAdjustments', firstOf(inv.stockAdjustments));
sample('sales/invoices', firstOf(sales.invoices));
console.log('\nsales child keys:', Object.keys(sales).join(', '));
console.log('purchasing child keys:', Object.keys(purch).join(', '));
if (sales.invoices) {
  const invs = Object.values(sales.invoices);
  sample('invoice items[0]', invs[0]?.items?.[0] ?? null);
}
if (purch.purchaseOrders) sample('purchasing/purchaseOrders', firstOf(purch.purchaseOrders));
if (purch.purchaseReceipts) sample('purchasing/purchaseReceipts', firstOf(purch.purchaseReceipts));
if (purch.vendors) sample('purchasing/vendors', firstOf(purch.vendors) ? Object.values(purch.vendors).find(v => v && typeof v === 'object' && !Array.isArray(v)) : null);
if (sales.customers) sample('sales/customers', firstOf(sales.customers));
