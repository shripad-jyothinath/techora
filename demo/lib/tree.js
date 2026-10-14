import { nowIso } from './util.js';
import { stmt } from './db.js';

/**
 * Helpers over the `documents` table — the JSON tree, exactly as the vendor
 * export stores it (collection/id paths, same field names inside records).
 *
 * Rule of the codebase: writes always go through upsertDocument() *and* the
 * matching indexDocument() call, inside one SQLite transaction. Nothing else
 * is allowed to touch `documents`.
 */

export const docPath = (collection, id) => `${collection}/${id}`;

export function upsertDocument(db, collection, id, value) {
  stmt(
    db,
    `INSERT INTO documents(path, collection, doc_id, value, updated_at)
     VALUES(@path, @collection, @doc_id, @value, @updated_at)
     ON CONFLICT(path) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`
  ).run({
    path: docPath(collection, id),
    collection,
    doc_id: id,
    value: JSON.stringify(value),
    updated_at: nowIso(),
  });
}

export function readDocument(db, path) {
  const row = stmt(db, 'SELECT value FROM documents WHERE path = ?').get(path);
  return row ? JSON.parse(row.value) : null;
}

export function collectionCounts(db) {
  return db
    .prepare('SELECT collection, COUNT(*) AS n FROM documents GROUP BY collection ORDER BY collection')
    .all();
}
