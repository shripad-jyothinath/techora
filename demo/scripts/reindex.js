/**
 * Recovery path: rebuild every derived index from the JSON tree.
 *
 * Use this if an index is ever suspected of being wrong (the "derived values
 * never silently wrong" requirement). The tree in `documents` is the system of
 * record; indexes are disposable and verifiable.
 *
 * Usage: node scripts/reindex.js [db.sqlite]
 */
import { fileURLToPath } from 'node:url';
import { applySchema, openDb } from '../lib/db.js';
import { rebuildIndexes } from '../lib/indexer.js';

const dbPath = process.argv[2] ?? fileURLToPath(new URL('../data/erp.sqlite', import.meta.url));

const db = openDb(dbPath);
applySchema(db);
const result = rebuildIndexes(db);
console.log(`reindex done: ${result.ms} ms · legacy batch refs resolved ${result.resolved}/${result.withRef}`);
db.close();
