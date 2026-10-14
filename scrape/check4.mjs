import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../dataset/cora-erp-masked.json', import.meta.url), 'utf8'));
const T = Object.values(data.inventory.transactions);
const poMov = T.filter(t => t.transactionType === 'purchase' && t.relatedDocumentType === 'purchase_order');
console.log('PO-linked movement samples:', JSON.stringify(poMov.slice(0, 3).map(t => ({ relatedDocumentId: t.relatedDocumentId, notes: (t.notes || '').slice(0, 60) })), null, 1));

const ids = poMov.map(t => t.relatedDocumentId);
const uniq = new Set(ids);
console.log('distinct relatedDocumentId values in PO movements:', uniq.size, 'sample:', [...uniq].slice(0, 5));

// do they match receipts?
const R = Object.values(data.purchasing.purchaseReceipts);
const rById = new Map(R.map(r => [r.id, r]));
console.log('PO-movement ids matching receipt ids:', ids.filter(id => rById.has(id)).length);

// invoice number formats
const I = Object.values(data.sales.invoices);
const plain = I.filter(i => /^\d+$/.test(i.invoiceNumber)).length;
const pref = I.filter(i => /^INV-/.test(i.invoiceNumber)).length;
const other = I.length - plain - pref;
console.log('invoiceNumber formats: plain', plain, 'INV-', pref, 'other', other);

// stockAdjustments transactionId resolve
const adj = Object.values(data.inventory.stockAdjustments);
const tById = new Map(T.map(t => [t.id, t]));
console.log('stockAdjustments with resolving transactionId:', adj.filter(a => tById.has(a.transactionId)).length, 'of', adj.length);

// do sales movements ever carry batch info?
const salesT = T.filter(t => t.transactionType === 'sales');
console.log('sales movements with "No Batch ID" note:', salesT.filter(t => /No Batch ID/.test(t.notes ?? '')).length, 'of', salesT.length);

// quantity string vs number now: totalCost/costPerUnit types
console.log('costPerUnit string in purchases:', T.filter(t => t.transactionType === 'purchase' && typeof t.costPerUnit === 'string').length);
