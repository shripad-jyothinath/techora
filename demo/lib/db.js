import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Opens the SQLite database with the pragmas that make it behave like a small
 * production database:
 *  - WAL: readers never block the writer (and vice versa) — good for 1 writer + N readers
 *  - synchronous=NORMAL: durable across app crashes, fast (a demo trade-off, noted in README)
 *  - busy_timeout: wait for the write lock instead of throwing immediately
 */
export function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  return db;
}

export function applySchema(db) {
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  // Lightweight forward-migrations for demo databases created before a
  // schema change (CREATE TABLE IF NOT EXISTS cannot add columns).
  ensureColumn(db, 'idx_movement', 'direction', 'TEXT');
  ensureColumn(db, 'idx_invoice_line', 'batch_id', 'TEXT');
}

function ensureColumn(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export function getMeta(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setMeta(db, key, value) {
  db.prepare(
    `INSERT INTO meta(key, value) VALUES(@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run({ key, value: String(value) });
}

/**
 * Prepared-statement cache, per database instance.
 * The indexer and write paths run the same SQL thousands of times (17k
 * documents during the transform); preparing once keeps the transform ~3×
 * faster and avoids prepare overhead in per-line loops.
 */
const stmtCache = new WeakMap();

export function stmt(db, sql) {
  let cache = stmtCache.get(db);
  if (!cache) {
    cache = new Map();
    stmtCache.set(db, cache);
  }
  let prepared = cache.get(sql);
  if (!prepared) {
    prepared = db.prepare(sql);
    cache.set(sql, prepared);
  }
  return prepared;
}
