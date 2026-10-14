import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../dataset/cora-erp-masked.json', import.meta.url), 'utf8'));
const I = Object.values(data.sales.invoices);
const invById = new Map(I.map(i => [i.id, i]));
const invByNumber = new Map(I.map(i => [i.invoiceNumber, i]));
const T = Object.values(data.inventory.transactions);
const salesT = T.filter(t => t.transactionType === 'sales');
const purchT = T.filter(t => t.transactionType === 'purchase');

let linked = 0, resolved = 0, noteWithInvNo = 0, noteEmpty = 0;
const samples = [];
for (const t of salesT) {
  if (t.relatedDocumentId !== 'new') {
    linked++;
    if (invById.has(t.relatedDocumentId)) resolved++;
  } else {
    if (/INV-|invoice/i.test(t.notes ?? '')) noteWithInvNo++; else noteEmpty++;
    if (samples.length < 2) samples.push({ notes: t.notes, relatedDocumentId: t.relatedDocumentId, relatedDocumentType: t.relatedDocumentType, itemId: t.itemId, quantity: t.quantity, date: t.transactionDate });
  }
}
// do any note-embedded document numbers resolve to invoice numbers?
let noteNoResolves = 0, noteNoChecked = 0;
for (const t of salesT) {
  if (t.relatedDocumentId !== 'new') continue;
  const m = (t.notes ?? '').match(/(INV-)?\d{4,}/);
  if (m) { noteNoChecked++; if (invByNumber.has(m[0]) || invByNumber.has(m[0].replace(/^INV-/, ''))) noteNoResolves++; }
}

const R = Object.values(data.purchasing.purchaseReceipts);
const PO = Object.values(data.purchasing.purchaseOrders);
const rById = new Map(R.map(r => [r.id, r])), poById = new Map(PO.map(p => [p.id, p]));
let prResolve = 0, prNew = 0, poResolve = 0, poNew = 0;
for (const t of purchT) {
  if (t.relatedDocumentType === 'purchase_receipt') { rById.has(t.relatedDocumentId) ? prResolve++ : (t.relatedDocumentId === 'new' && prNew++); }
  else if (t.relatedDocumentType === 'purchase_order') { poById.has(t.relatedDocumentId) ? poResolve++ : (t.relatedDocumentId === 'new' && poNew++); }
}

console.log(JSON.stringify({
  salesMovements: salesT.length,
  linkedToSomething: linked,
  linkedResolvesToInvoiceId: resolved,
  newLinks: salesT.length - linked,
  newWithInvoiceNumberInNote: noteWithInvNo,
  newWithEmptyOrUnhelpfulNote: noteEmpty,
  noteNumberResolvesToInvoice: noteNoResolves,
  noteNumbersChecked: noteNoChecked,
  purchaseReceiptMovements: { resolved: prResolve, new: prNew },
  purchaseOrderMovements: { resolved: poResolve, new: poNew },
  samples,
}, null, 2));
