import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../dataset/cora-erp-masked.json', import.meta.url), 'utf8'));
const size = (o) => JSON.stringify(o).length;
const trunc = (v) => {
  const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v);
  return s.length > 140 ? s.slice(0, 140) + '...' : s;
};

function printNode(path, node, indent = '  ') {
  if (Array.isArray(node)) {
    console.log(`${indent}${path}: array(${node.length}) size=${size(node)}`);
    if (node.length && node[0] && typeof node[0] === 'object' && !Array.isArray(node[0])) {
      console.log(`${indent}  sample-record keys: ${Object.keys(node[0]).join(', ')}`);
    }
  } else if (node && typeof node === 'object') {
    console.log(`${indent}${path}: object keys=[${Object.keys(node).join(', ')}] size=${size(node)}`);
    for (const [ck, cv] of Object.entries(node)) {
      printNode(ck, cv, indent + '  ');
    }
  } else {
    console.log(`${indent}${path} = ${trunc(node)}`);
  }
}

console.log('ROOT keys:', Object.keys(data).join(', '));
for (const [k, v] of Object.entries(data)) {
  console.log(`\n== ${k} ==`);
  printNode(k, v);
}

// Samples
const samples = [
  ['sales/invoices sample', data?.sales?.invoices?.[0]],
  ['inventory/transactions sample', data?.inventory?.transactions?.[0]],
  ['inventory/stockLevels sample', data?.inventory?.stockLevels?.[0]],
  ['inventory/materials sample', data?.inventory?.materials?.[0]],
  ['purchasing/purchaseOrders sample', data?.purchasing?.purchaseOrders?.[0]],
  ['purchasing/purchaseReceipts sample', data?.purchasing?.purchaseReceipts?.[0]],
];
for (const [label, val] of samples) {
  console.log(`\n--- ${label} ---`);
  if (val == null) { console.log('(missing)'); continue; }
  if (Array.isArray(val)) console.log(trunc(val.slice(0, 2)));
  else console.log(trunc(val));
}
