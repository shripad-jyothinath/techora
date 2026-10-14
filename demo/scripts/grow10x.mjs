/**
 * Grow the dataset to ≈10× the brief's volumes, through the same write paths
 * (receipts create batches + movements; invoices sell from real batches), so
 * every invariant from the audit still holds on the grown data.
 *
 *   node scripts/grow10x.mjs [out.sqlite]
 *
 * Growth model: the real system grows by ~500 movements and ~150 stock rows a
 * month. Ten years at the current pace is not ten years of the same thing, so
 * this generator keeps the SAME distributions (line counts, zero-stock ratio,
 * string/number mix is not reproduced — that is legacy noise) and scales the
 * volumes to ≈10× today's rows. It is synthetic by construction; the report
 * states the multipliers it actually produced.
 */
import { existsSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applySchema, openDb } from '../lib/db.js';
import { generateFakeData } from '../lib/fakedata.js';

const dbPath = process.argv[2] ?? fileURLToPath(new URL('../data/erp10x.sqlite', import.meta.url));

for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (existsSync(f)) rmSync(f);

const db = openDb(dbPath);
applySchema(db);

const t0 = Date.now();
const out = generateFakeData(
  db,
  {
    reset: true,
    materials: 3000,
    vendors: 50,
    customers: 400,
    receipts: 12000,
    invoices: 24000,
    pos: 1500,
    months: 18,
  },
  'grow10x'
);

const count = (sql) => db.prepare(sql).get().n;
const rows = {
  documents: count('SELECT COUNT(*) AS n FROM documents'),
  invoices: count('SELECT COUNT(*) AS n FROM idx_invoice'),
  invoiceLines: count('SELECT COUNT(*) AS n FROM idx_invoice_line'),
  movements: count('SELECT COUNT(*) AS n FROM idx_movement'),
  batches: count('SELECT COUNT(*) AS n FROM idx_stock'),
  materials: count('SELECT COUNT(*) AS n FROM idx_material'),
};
const base = { invoices: 2869, movements: 7761, batches: 2656, materials: 1346 };
const mult = (a, b) => (a / b).toFixed(1);

console.log(`grown database: ${dbPath}`);
console.log(`generated in ${((Date.now() - t0) / 1000).toFixed(1)}s  (${out.ms} ms inside the generator)`);
console.log(`  invoices   ${rows.invoices.toLocaleString()}  (×${mult(rows.invoices, base.invoices)} of the export)`);
console.log(`  lines      ${rows.invoiceLines.toLocaleString()}`);
console.log(`  movements  ${rows.movements.toLocaleString()}  (×${mult(rows.movements, base.movements)})`);
console.log(`  batches    ${rows.batches.toLocaleString()}  (×${mult(rows.batches, base.batches)})`);
console.log(`  materials  ${rows.materials.toLocaleString()}  (×${mult(rows.materials, base.materials)})`);
console.log(`  documents  ${rows.documents.toLocaleString()}`);
console.log(`  file size  ${(statSync(dbPath).size / 1048576).toFixed(1)} MB`);

db.close();
