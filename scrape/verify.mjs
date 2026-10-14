import { readFileSync, writeFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../dataset/cora-erp-masked.json', import.meta.url), 'utf8'));
const out = {};
const n = (x) => Number(x);
const fmt = (x) => typeof x === 'number' ? x.toLocaleString('en-US') : x;

const inv = data.inventory, sales = data.sales, pur = data.purchasing;
const T = Object.values(inv.transactions);
const I = Object.values(sales.invoices);
const M = Object.entries(inv.materials);
const S = Object.values(inv.stockLevels);
const PO = Object.values(pur.purchaseOrders);
const PR = Object.values(pur.purchaseReceipts);
const C = Object.entries(sales.customers);
const V = Object.entries(pur.vendors);

const say = (label, val) => { console.log(`${label}: ${val}`); };

// --- collection counts
out.counts = {
  transactions: T.length, invoices: I.length, materials: M.length, stockLevels: S.length,
  purchaseOrders: PO.length, purchaseReceipts: PR.length, customers: C.length, vendors: V.length,
  stockAdjustments: Object.keys(inv.stockAdjustments).length,
  directDeliveries: Object.keys(sales['direct-deliveries']).length,
  storageLocations: Object.keys(inv.storageLocations).length,
  storage_locations: Object.keys(inv.storage_locations).length,
  units: Object.keys(data.units).length,
};
console.log('--- counts ---'); for (const [k, v] of Object.entries(out.counts)) say(k, fmt(v));

// --- line totals
const invLines = I.flatMap(i => i.items ?? []);
const poLines = PO.flatMap(p => p.items ?? []);
const prLines = PR.flatMap(p => p.items ?? []);
out.lines = { invoiceLines: invLines.length, poLines: poLines.length, prLines: prLines.length };
console.log('--- lines ---'); for (const [k, v] of Object.entries(out.lines)) say(k, fmt(v));

// --- transaction types
const txnByType = {};
for (const t of T) txnByType[t.transactionType] = (txnByType[t.transactionType] || 0) + 1;
out.txnByType = txnByType;
console.log('--- transactionType distribution ---', JSON.stringify(txnByType));

// --- claim: 88% of sales movements missing invoice link
const salesTypes = ['sale', 'sales', 'sold', 'sales_delivery'];
const salesMovements = T.filter(t => salesTypes.includes(t.transactionType));
const missingDoc = salesMovements.filter(t => t.relatedDocumentId === 'new');
out.salesMovementLink = { salesMovements: salesMovements.length, relatedDocNew: missingDoc.length, pct: (100 * missingDoc.length / salesMovements.length).toFixed(1) };
console.log('--- sales movements ---', JSON.stringify(out.salesMovementLink));

// --- claim: quantity string counts
out.stringQty = {
  movements: T.filter(t => typeof t.quantity === 'string').length,
  invoiceLines: invLines.filter(l => typeof l.quantity === 'string').length,
  invoiceLineUnitPriceStrings: invLines.filter(l => typeof l.unitPrice === 'string').length,
  movementCostStrings: T.filter(t => typeof t.costPerUnit === 'string').length,
};
console.log('--- string quantities ---', JSON.stringify(out.stringQty));

// --- claim: 1,558 of 2,656 stock rows qty 0; one material 137 rows
const stockByMaterial = {};
for (const s of S) (stockByMaterial[s.itemId] ??= []).push(s);
const zeroRows = S.filter(s => n(s.quantity) === 0).length;
const perMatCounts = Object.values(stockByMaterial).map(a => a.length);
const maxRows = Math.max(...perMatCounts);
const matWithMax = Object.entries(stockByMaterial).find(([, a]) => a.length === maxRows);
out.stock = {
  zeroQtyRows: zeroRows,
  stockRowsWithNonzeroQty: S.length - zeroRows,
  distinctMaterialsInStock: Object.keys(stockByMaterial).length,
  maxRowsPerMaterial: maxRows,
  materialWithMaxRows: matWithMax?.[0],
  materialsWithNonzeroStock: Object.values(stockByMaterial).filter(a => a.some(s => n(s.quantity) !== 0)).length,
};
console.log('--- stock rows ---', JSON.stringify(out.stock));

// --- claim: 1,002 materials keyed by 13-digit timestamp
out.materialKeys = {
  totalKeys: M.length,
  timestamp13Keys: M.filter(([k]) => /^\d{13}$/.test(k)).length,
  firebasePushKeys: M.filter(([k]) => /^-/.test(k)).length,
};
console.log('--- material key kinds ---', JSON.stringify(out.materialKeys));

// --- loose ends: movements referencing missing materials, vendors id != key
const missingMatByMovements = T.filter(t => !data.inventory.materials[t.itemId]);
out.looseEnds = {
  movementsMissingMaterial: missingMatByMovements.length,
  stockRowsMissingMaterial: S.filter(s => !data.inventory.materials[s.itemId]).length,
  vendorsIdDiffersFromKey: V.filter(([k, v]) => v.id !== k).length,
};
console.log('--- loose ends ---', JSON.stringify(out.looseEnds));

// --- embedded customer drift
const custById = new Map(C.map(([k, v]) => [v.id ?? k, v]));
let driftName = 0, missingCust = 0, anyDrift = 0;
for (const i of I) {
  if (!i.customerId) continue;
  const cur = custById.get(i.customerId);
  if (!cur) { missingCust++; continue; }
  const snap = i.customer ?? {};
  const cmp = ['name', 'email', 'phone'].filter(f => JSON.stringify(snap[f] ?? '') !== JSON.stringify(cur[f] ?? ''));
  const snapAddr = JSON.stringify(snap.address ?? {});
  const curAddr = JSON.stringify(cur.address ?? {});
  if (cmp.length || snapAddr !== curAddr) { anyDrift++; if (cmp.includes('name')) driftName++; }
}
out.customerDrift = { missingCust, driftedAny: anyDrift, driftedName: driftName, totalInvoices: I.length };
console.log('--- customer drift ---', JSON.stringify(out.customerDrift));

// --- invoice line distribution
const lineCounts = I.map(i => (i.items ?? []).length).sort((a, b) => a - b);
const oneLine = lineCounts.filter(x => x === 1).length;
out.invoiceLines = {
  oneLineInvoices: oneLine,
  oneLinePct: (100 * oneLine / I.length).toFixed(1),
  maxLines: lineCounts[lineCounts.length - 1],
  avgLines: (invLines.length / I.length).toFixed(2),
};
console.log('--- invoice line distribution ---', JSON.stringify(out.invoiceLines));

// --- movements per material skew
const movByMaterial = {};
for (const t of T) movByMaterial[t.itemId] = (movByMaterial[t.itemId] || 0) + 1;
const movCounts = Object.values(movByMaterial).sort((a, b) => a - b);
const median = movCounts[Math.floor(movCounts.length / 2)];
const maxMov = movCounts[movCounts.length - 1];
const matMaxMov = Object.entries(movByMaterial).find(([, c]) => c === maxMov)?.[0];
out.movementSkew = { maxMovementsPerMaterial: maxMov, materialWithMaxMovements: matMaxMov, medianMovementsPerMaterial: median, materialsWithMovements: movCounts.length };
console.log('--- movement skew ---', JSON.stringify(out.movementSkew));

// --- users (five accounts)
const userIds = new Set();
for (const t of T) if (t.performedBy) userIds.add(String(t.performedBy));
for (const a of Object.values(inv.stockAdjustments)) { if (a.createdBy) userIds.add(String(a.createdBy)); if (a.approvedBy) userIds.add(String(a.approvedBy)); }
for (const p of [...PO, ...PR]) { if (p.createdBy) userIds.add(String(p.createdBy)); if (p.updatedBy) userIds.add(String(p.updatedBy)); }
out.users = { distinctUserIds: [...userIds].sort(), count: userIds.size };
console.log('--- user ids seen ---', JSON.stringify(out.users));

// --- sizes (MiB) for the table in the task
const mib = (o) => (JSON.stringify(o).length / 1048576).toFixed(2);
out.sizesMib = {
  total: (11696988 / 1048576).toFixed(2), rawBytes: 11696988,
  transactions: mib(inv.transactions), invoices: mib(sales.invoices), purchaseOrders: mib(pur.purchaseOrders),
  purchaseReceipts: mib(pur.purchaseReceipts), stockLevels: mib(inv.stockLevels), materials: mib(inv.materials),
  customers: mib(sales.customers), vendors: mib(pur.vendors),
  other: mib({ stockAdjustments: inv.stockAdjustments, directDeliveries: sales['direct-deliveries'], storageLocations: inv.storageLocations, storage_locations: inv.storage_locations, units: data.units }),
};
console.log('--- sizes MiB ---', JSON.stringify(out.sizesMib, null, 1));

// --- date ranges & monthly rates
function range(items, getDate, label) {
  const ds = items.map(getDate).filter(Boolean).map((d) => new Date(d)).filter((d) => !isNaN(d));
  ds.sort((a, b) => a - b);
  const months = (ds[ds.length - 1] - ds[0]) / (1000 * 60 * 60 * 24 * 30.44);
  return { label, min: ds[0]?.toISOString().slice(0, 10), max: ds[ds.length - 1]?.toISOString().slice(0, 10), months: +months.toFixed(1), perMonth: +(items.length / months).toFixed(0) };
}
out.rates = [
  range(T, (t) => t.transactionDate ?? t.createdAt, 'movements'),
  range(I, (i) => i.date ?? i.createdAt, 'invoices'),
  range(PO, (p) => p.orderDate ?? p.createdAt, 'purchaseOrders'),
  range(PR, (r) => r.receiptDate ?? r.createdAt, 'purchaseReceipts'),
];
console.log('--- date ranges & monthly rates ---');
for (const r of out.rates) console.log(`  ${r.label}: ${r.min} -> ${r.max} (${r.months} mo) = ${fmt(r.perMonth)}/mo`);

// recent 6-month receipt-pace (does stock list grow?)
const cut = new Date(Date.now() - 183 * 864e5);
const recentReceipts = PR.filter(r => new Date(r.receiptDate ?? r.createdAt) >= cut);
const recentMovements = T.filter(t => new Date(t.transactionDate ?? t.createdAt) >= cut);
out.recent = { receiptsLast6mo: recentReceipts.length, receiptLinesLast6mo: recentReceipts.flatMap(r => r.items ?? []).length, movementsLast6mo: recentMovements.length };
console.log('--- recent 6 months ---', JSON.stringify(out.recent));

// --- dashboard-ish derived numbers
const balances = I.map(i => n(i.balance ?? (n(i.total) - n(i.paidAmount ?? 0))));
const outstanding = I.filter(i => (n(i.total) - n(i.paidAmount ?? 0)) > 0.005);
out.dashboard = {
  invoicesTotal: I.length,
  outstandingCount: outstanding.length,
  outstandingAmount: outstanding.reduce((s, i) => s + n(i.total) - n(i.paidAmount ?? 0), 0).toFixed(2),
  sumBalance: balances.reduce((s, b) => s + b, 0).toFixed(2),
};
console.log('--- dashboard derived ---', JSON.stringify(out.dashboard));

// save results
writeFileSync(new URL('./verification.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('\nsaved scrape/verification.json');
