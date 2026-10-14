import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('dataset/cora-erp-masked.json', 'utf8'));
const out = {};
const vals = (o) => Object.values(o || {});

// PO + receipt + invoice statuses
const st = (arr) => { const m = {}; for (const r of arr) m[r.status] = (m[r.status] || 0) + 1; return m; };
const POs = vals(data.purchasing.purchaseOrders), PRs = vals(data.purchasing.purchaseReceipts), INVs = vals(data.sales.invoices);
out.poStatuses = st(POs); out.receiptStatuses = st(PRs); out.invoiceStatuses = st(INVs);

// receipt + receipt-line + PO-line shapes
out.receiptSample = PRs[0];
out.receiptItemSample = PRs[0]?.items?.[0];
out.poItemSample = POs[0]?.items?.[0];

// union of keys in stockLevels (does a receipt link exist?)
const sKeys = new Set(); for (const s of vals(data.inventory.stockLevels)) for (const k of Object.keys(s)) sKeys.add(k);
out.stockUnionKeys = [...sKeys].sort();

// union of keys in transactions (per type)
const tKeys = {}; for (const t of vals(data.inventory.transactions)) { const set = (tKeys[t.transactionType] ??= new Set()); for (const k of Object.keys(t)) set.add(k); }
out.txnKeysByType = Object.fromEntries(Object.entries(tKeys).map(([k, v]) => [k, [...v].sort()]));

// how many sales movements have a cost (needed for margin)
const sales = vals(data.inventory.transactions).filter((t) => t.transactionType === 'sales');
out.salesMovementsWithCost = sales.filter((t) => Number(t.totalCost) > 0).length;
out.salesMovementsTotal = sales.length;

// invoice numbering: highest INV- suffix and plain numbers
const invNos = INVs.map((i) => String(i.invoiceNumber));
out.maxInvSuffix = Math.max(...invNos.filter((n) => n.startsWith('INV-')).map((n) => Number(n.slice(4))).filter((n) => !isNaN(n)));
out.maxPlain = Math.max(...invNos.filter((n) => /^\d+$/.test(n)).map(Number));
out.invNoSamples = invNos.slice(0, 8);

// do invoice item productIds resolve to materials? (join sanity)
const matIds = new Set(Object.keys(data.inventory.materials));
const lines = INVs.flatMap((i) => i.items || []);
out.invoiceLinesResolvingToMaterial = lines.filter((l) => matIds.has(l.productId)).length;
out.invoiceLinesTotal = lines.length;

// do stock itemIds resolve?
out.stockRowsResolvingToMaterial = vals(data.inventory.stockLevels).filter((s) => matIds.has(s.itemId)).length;

// a couple of low-stock examples for the dashboard
const byMat = {};
for (const s of vals(data.inventory.stockLevels)) { (byMat[s.itemId] ??= []).push(Number(s.quantity) || 0); }
const mats = vals(data.inventory.materials);
const low = mats.map((m) => ({ id: m.id, name: m.name, reorderPoint: m.reorderPoint, onHand: (byMat[m.id] || []).reduce((a, b) => a + b, 0) }))
  .filter((m) => m.onHand <= (Number(m.reorderPoint) || 0) && m.onHand > 0).slice(0, 5);
out.lowStockExamples = low;

console.log(JSON.stringify(out, null, 1));
