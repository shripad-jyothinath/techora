import { readFileSync, statSync } from 'node:fs';
import { nowIso } from './util.js';
import { upsertDocument } from './tree.js';
import { stmt, setMeta } from './db.js';

/**
 * Importer for the vendor JSON tree export.
 *
 * The tree is copied in byte-faithfully: same collection paths, same record
 * keys, same field values (including the messy ones — string quantities,
 * "new" document links, timestamp ids). Nothing is "cleaned" in the source of
 * truth. All normalisation happens in the derived index layer.
 *
 * Used by scripts/transform.js and by the "Load masked dataset" demo action,
 * so both behave exactly the same.
 */

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const looksLikeRecord = (v) => isPlainObject(v) && Object.values(v).some((f) => f === null || typeof f !== 'object');

export function importTree(db, data) {
  const collections = new Map();
  let docs = 0;

  function copyCollection(collection, records) {
    const ins = stmt(
      db,
      `INSERT INTO documents(path, collection, doc_id, value, updated_at)
       VALUES(@path, @collection, @doc_id, @value, @updated_at)`
    );
    const ts = nowIso();
    const insertAll = db.transaction((entries) => {
      for (const [id, record] of entries) {
        ins.run({ path: `${collection}/${id}`, collection, doc_id: id, value: JSON.stringify(record), updated_at: ts });
        docs += 1;
      }
    });
    insertAll(Object.entries(records));
    collections.set(collection, Object.keys(records).length);
  }

  function walk(node, prefix) {
    if (!isPlainObject(node)) return;
    const children = Object.values(node);
    if (children.length && children.every(looksLikeRecord)) {
      copyCollection(prefix, node);
      return;
    }
    for (const [key, child] of Object.entries(node)) walk(child, prefix ? `${prefix}/${key}` : key);
  }

  walk(data, '');
  return { docs, collections };
}

/** Continue the invoice/receipt number formats found in the data. */
export function seedSequences(db) {
  let maxInv = 0;
  for (const r of stmt(db, "SELECT value FROM documents WHERE collection = 'sales/invoices'").all()) {
    const no = String(JSON.parse(r.value).invoiceNumber ?? '');
    if (no.startsWith('INV-')) {
      const m = no.match(/(\d+)\s*$/); // INV-223465 and INV-202512-21520 both end in a number
      if (m) maxInv = Math.max(maxInv, Number(m[1]));
    } else if (/^\d+$/.test(no)) {
      maxInv = Math.max(maxInv, Number(no));
    }
    // DOC-* direct-delivery numbers are NOT part of the invoice sequence
  }
  let maxGrn = 0;
  for (const r of stmt(db, "SELECT value FROM documents WHERE collection = 'purchasing/purchaseReceipts'").all()) {
    const m = String(JSON.parse(r.value).receiptNumber ?? '').match(/(\d+)\s*$/);
    if (m) maxGrn = Math.max(maxGrn, Number(m[1]));
  }
  setMeta(db, 'next_invoice_no', maxInv + 1);
  setMeta(db, 'next_receipt_no', maxGrn + 1);
  return { nextInvoice: maxInv + 1, nextReceipt: maxGrn + 1 };
}

export function importDatasetFile(db, filePath) {
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  const { docs, collections } = importTree(db, data);
  const seq = seedSequences(db);
  setMeta(db, 'data_mode', 'dataset');
  setMeta(db, 'built_at', nowIso());
  setMeta(db, 'source_file', filePath);
  setMeta(db, 'source_bytes', statSync(filePath).size);
  return { docs, collections: [...collections.entries()], bytes: statSync(filePath).size, ...seq };
}
