import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../dataset/cora-erp-masked.json', import.meta.url), 'utf8'));
const S = Object.values(data.inventory.stockLevels);
const I = Object.values(data.sales.invoices);
const T = Object.values(data.inventory.transactions);
const items = I.flatMap(i => i.items ?? []);

const key = (s) => `${s.itemId}|${s.destinationLocationId}`;
const distinctAll = new Set(S.map(key)).size;
const distinctNonzero = new Set(S.filter(s => Number(s.quantity) > 0).map(key)).size;
const distinctMaterialsNonzero = new Set(S.filter(s => Number(s.quantity) > 0).map(s => s.itemId)).size;

const st = {}; for (const i of I) st[i.status] = (st[i.status] || 0) + 1;
const sst = {}; for (const s of S) sst[s.status] = (sst[s.status] || 0) + 1;

const withSel = items.filter(x => x.selectedBatchId).length;
const withAvail = items.filter(x => 'availableStock' in x).length;
const withIsValid = items.filter(x => 'isValid' in x).length;
const originalLoc = items.filter(x => x._originalStorageLocation).length;
const itemIdEmpty = items.filter(x => !x.id).length;

const docType = {}; for (const t of T) { const k = `${t.transactionType}/${t.relatedDocumentType}`; docType[k] = (docType[k] || 0) + 1; }

console.log(JSON.stringify({
  stockLevels: { totalRows: S.length, distinctMaterialLocationAll: distinctAll, distinctMaterialLocationNonzero: distinctNonzero, distinctMaterialsNonzero },
  invoiceStatus: st,
  stockStatus: sst,
  invoiceItemUiFields: { totalLines: items.length, withSelectedBatchId: withSel, withAvailableStockField: withAvail, withIsValidField: withIsValid, withOriginalStorageLocation: originalLoc, emptyLineId: itemIdEmpty },
  docType,
}, null, 2));
