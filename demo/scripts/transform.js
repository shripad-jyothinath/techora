/**
 * Transform: the vendor JSON tree export → our store.
 *
 * The tree is copied in byte-faithfully (see lib/import.js): same collection
 * paths, same record keys, same field values — including the messy ones.
 * All normalisation happens in the derived index layer, which can be rebuilt
 * from the tree at any time (`npm run reindex`).
 *
 * Usage: node scripts/transform.js [dataset.json] [out.sqlite]
 */
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySchema, openDb } from '../lib/db.js';
import { importDatasetFile } from '../lib/import.js';
import { rebuildIndexes } from '../lib/indexer.js';
import { collectionCounts } from '../lib/tree.js';

const here = dirname(fileURLToPath(import.meta.url));
const datasetPath = resolve(process.argv[2] ?? join(here, '..', '..', 'dataset', 'cora-erp-masked.json'));
const dbPath = resolve(process.argv[3] ?? join(here, '..', 'data', 'erp.sqlite'));

if (!existsSync(datasetPath)) {
  console.error(`Dataset not found: ${datasetPath}`);
  console.error('Place cora-erp-masked.json in ./dataset/ or pass the path as the first argument.');
  process.exit(1);
}

console.log(`source : ${datasetPath} (${(statSync(datasetPath).size / 1048576).toFixed(2)} MB)`);
console.log(`target : ${dbPath}`);

// fresh database every run — the transform is deterministic
for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (existsSync(f)) rmSync(f);
mkdirSync(dirname(dbPath), { recursive: true });

const t0 = Date.now();
const db = openDb(dbPath);
applySchema(db);

const tImport = Date.now();
const imported = importDatasetFile(db, datasetPath);
console.log(`copied : ${imported.docs} records into ${imported.collections.length} collections in ${Date.now() - tImport} ms`);
for (const [collection, n] of [...imported.collections].sort()) {
  console.log(`   ${collection.padEnd(34)} ${String(n).padStart(6)}`);
}

// Build the derived indexes from the tree (the only place they are created
// from scratch — afterwards every write maintains them transactionally).
rebuildIndexes(db);

/* --------------------------------------------------------------------------
 * Verification against the numbers published in the problem statement.
 * ------------------------------------------------------------------------ */
const EXPECTED = {
  'inventory/transactions': 7761,
  'sales/invoices': 2869,
  'purchasing/purchaseOrders': 1053,
  'purchasing/purchaseReceipts': 1068,
  'inventory/stockLevels': 2656,
  'inventory/materials': 1346,
  'sales/customers': 203,
  'purchasing/vendors': 59,
};

console.log('\nverification (record counts vs the problem statement):');
let ok = true;
const counts = new Map(collectionCounts(db).map((r) => [r.collection, r.n]));
for (const [collection, expected] of Object.entries(EXPECTED)) {
  const actual = counts.get(collection) ?? 0;
  const pass = actual === expected;
  ok &&= pass;
  console.log(`   ${pass ? 'OK ' : 'BAD'} ${collection.padEnd(34)} ${String(actual).padStart(6)} (expected ${expected})`);
}

console.log('\nindex totals:');
const totals = {
  documents: db.prepare('SELECT COUNT(*) AS n FROM documents').get().n,
  invoice_lines: db.prepare('SELECT COUNT(*) AS n FROM idx_invoice_line').get().n,
  movements: db.prepare('SELECT COUNT(*) AS n FROM idx_movement').get().n,
  batches: db.prepare('SELECT COUNT(*) AS n FROM idx_stock').get().n,
  zero_batches: db.prepare('SELECT COUNT(*) AS n FROM idx_stock WHERE quantity = 0').get().n,
  materials: db.prepare('SELECT COUNT(*) AS n FROM idx_material').get().n,
};
for (const [k, v] of Object.entries(totals)) console.log(`   ${k.padEnd(14)} ${v}`);

console.log(`\ninvoice number sequence starts at INV-${imported.nextInvoice}, receipts at GRN-…-${imported.nextReceipt}`);
console.log(`done in ${Date.now() - t0} ms — ${ok ? 'all counts match' : 'COUNT MISMATCH — check the source file'}`);

db.close();
if (!ok) process.exit(2);
