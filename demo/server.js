/**
 * Techcora ERP demo — API server.
 *
 * Responsibilities (and deliberately nothing else):
 *  - accounts/sessions (scrypt passwords, HttpOnly cookie sessions)
 *  - serve the built index database through small, paginated, filtered reads
 *  - execute invoice saves / receipt posts as single transactions
 *  - push thin realtime events (SSE) after a commit
 *  - demo data tools: load the masked dataset / generate sample data / wipe
 *
 * The browser never sees whole collections: every response is proportional to
 * what a screen shows.
 */
import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySchema, getMeta, openDb, stmt } from './lib/db.js';
import { broadcast, clientCount, sseHandler } from './lib/events.js';
import {
  getDashboard, getInvoice, getMaterialStock, getMovements, listCustomers,
  listInvoices, listStockLevels, searchInvoices, searchMaterials, tableCounts,
} from './lib/queries.js';
import { demoColleagueSale, demoReceipt60, demoSetupMaterial, markInvoicePaid, postReceipt, saveInvoice } from './lib/writes.js';
import { generateFakeData, wipeBusinessData } from './lib/fakedata.js';
import { importDatasetFile } from './lib/import.js';
import { rebuildIndexes } from './lib/indexer.js';
import { readDocument } from './lib/tree.js';
import { HttpError } from './lib/util.js';
import {
  clearCookie, countUsers, createSession, destroySession, login, parseCookies,
  sessionCookie, sessionUser, signup,
} from './lib/auth.js';

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.ERP_DB ?? join(here, 'data', 'erp.sqlite');
const datasetPath = resolve(process.env.ERP_DATASET ?? join(here, '..', 'dataset', 'cora-erp-masked.json'));

const db = openDb(dbPath);
applySchema(db); // idempotent; a fresh install starts with zero business data

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));

// Tiny request log — useful when reading the demo measurements.
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api/')) {
      console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - t0} ms)`);
    }
  });
  next();
});

// API responses are never cached (data changes with every write).
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});

app.use(express.static(join(here, 'public')));

/* ---------------------------------------------------------------- auth */

app.get('/api/auth/status', (req, res) => {
  const user = sessionUser(db, req);
  res.json({
    users: countUsers(db),
    user: user ? { id: user.id, username: user.username, name: user.name, role: user.role } : null,
  });
});

app.post('/api/auth/signup', (req, res) => {
  const user = signup(db, req.body ?? {});
  const token = createSession(db, user.id);
  res.setHeader('Set-Cookie', sessionCookie(token));
  res.status(201).json({ user });
});

app.post('/api/auth/login', (req, res) => {
  const user = login(db, req.body ?? {});
  const token = createSession(db, user.id);
  res.setHeader('Set-Cookie', sessionCookie(token));
  res.json({ user });
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie).sid;
  destroySession(db, token);
  res.setHeader('Set-Cookie', clearCookie());
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = sessionUser(db, req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: { id: user.id, username: user.username, name: user.name, role: user.role } });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, sse_clients: clientCount(), users: countUsers(db), data_mode: getMeta(db, 'data_mode', 'none') });
});

/* ------------------------------------------------------------ auth gate */

app.use('/api', (req, res, next) => {
  const user = sessionUser(db, req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
});

/* ------------------------------------------------------------------ reads */

app.get('/api/meta', (req, res) => {
  res.json({
    built_at: getMeta(db, 'built_at'),
    data_mode: getMeta(db, 'data_mode', 'none'),
    source_file: getMeta(db, 'source_file'),
    source_bytes: Number(getMeta(db, 'source_bytes', 0)),
    next_invoice_no: getMeta(db, 'next_invoice_no'),
    next_receipt_no: getMeta(db, 'next_receipt_no'),
    tables: tableCounts(db),
  });
});

app.get('/api/invoices', (req, res) => {
  const { status, q, sort, dir, cursor, limit } = req.query;
  res.json(listInvoices(db, {
    status: status || undefined,
    q: q ? String(q) : undefined,
    sort: sort || 'date',
    dir: dir || 'desc',
    cursor: cursor || null,
    limit: limit || 25,
  }));
});

app.get('/api/invoices/:id', (req, res) => {
  const out = getInvoice(db, req.params.id);
  if (!out) return res.status(404).json({ error: 'Invoice not found' });
  res.json(out);
});

app.get('/api/materials/search', (req, res) => {
  res.json({ rows: searchMaterials(db, req.query.q ?? '', req.query.limit ?? 20) });
});

/** One request for the command palette: invoices + materials matching a term. */
app.get('/api/search', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const limit = req.query.limit ?? 8;
  res.json({
    q,
    invoices: q ? searchInvoices(db, q, limit) : [],
    materials: q ? searchMaterials(db, q, limit) : [],
  });
});

app.get('/api/materials/:id/stock', (req, res) => {
  const out = getMaterialStock(db, req.params.id);
  if (!out) return res.status(404).json({ error: 'Material not found' });
  res.json(out);
});

app.get('/api/customers', (req, res) => {
  res.json({ rows: listCustomers(db) });
});

app.get('/api/dashboard', (req, res) => {
  res.json(getDashboard(db));
});

app.get('/api/stock-levels', (req, res) => {
  res.json(listStockLevels(db, { q: req.query.q || undefined, page: req.query.page || 0, limit: req.query.limit || 25 }));
});

app.get('/api/movements', (req, res) => {
  const out = getMovements(db, {
    materialId: req.query.material_id,
    from: req.query.from || null,
    to: req.query.to || null,
    limit: req.query.limit,
  });
  if (!out) return res.status(404).json({ error: 'Material not found' });
  res.json(out);
});

/** Raw tree inspection: /api/tree?path=sales/invoices/<id> (the tree is the source of truth) */
app.get('/api/tree', (req, res) => {
  const path = String(req.query.path ?? '');
  if (!path || path.includes('..')) return res.status(400).json({ error: 'path query parameter required' });
  const doc = readDocument(db, path);
  if (!doc) return res.status(404).json({ error: 'No document at that path' });
  res.json({ path, document: doc });
});

/* ------------------------------------------------------------ realtime (SSE) */

app.get('/api/events', (req, res) => {
  sseHandler(req, res);
});

/* ------------------------------------------------------------------ writes */

app.post('/api/invoices', (req, res) => {
  const out = saveInvoice(db, req.body, req.user.id);
  broadcast({ type: 'invoice_saved', invoice_id: out.invoice_id, invoice_number: out.invoice_number, material_ids: out.material_ids, by: req.user.name });
  broadcast({ type: 'stock_changed', material_ids: out.material_ids, source: `invoice ${out.invoice_number}` });
  res.status(201).json(out);
});

app.post('/api/invoices/:id/pay', (req, res) => {
  const out = markInvoicePaid(db, req.params.id, req.user.id);
  broadcast({ type: 'invoice_saved', invoice_id: out.invoice_id, invoice_number: out.invoice_number, material_ids: [], by: req.user.name });
  res.json(out);
});

app.post('/api/receipts', (req, res) => {
  const out = postReceipt(db, req.body, req.user.id);
  broadcast({ type: 'receipt_posted', receipt_id: out.receipt_id, receipt_number: out.receipt_number, material_ids: out.material_ids, by: req.user.name });
  broadcast({ type: 'stock_changed', material_ids: out.material_ids, source: `receipt ${out.receipt_number}` });
  res.status(201).json(out);
});

/* --------------------------------------------------------- demo: scenario */
/* These call the exact same write paths — nothing bypasses validation.       */

app.post('/api/demo/setup-material', (req, res) => {
  const out = demoSetupMaterial(db, req.user.id);
  broadcast({ type: 'receipt_posted', receipt_id: out.receipt.receipt_id, receipt_number: out.receipt.receipt_number, material_ids: out.receipt.material_ids, by: req.user.name });
  broadcast({ type: 'stock_changed', material_ids: out.receipt.material_ids, source: 'demo setup receipt' });
  res.status(201).json(out);
});

app.post('/api/demo/colleague-sale', (req, res) => {
  // attribute the sale to a different account when one exists (audit realism)
  const other = stmt(db, 'SELECT id, name FROM users WHERE id != ? ORDER BY created_at LIMIT 1').get(req.user.id) ?? {
    id: req.user.id,
    name: req.user.name,
  };
  const out = demoColleagueSale(db, req.body ?? {}, other.id);
  broadcast({ type: 'invoice_saved', invoice_id: out.invoice.invoice_id, invoice_number: out.invoice.invoice_number, material_ids: out.invoice.material_ids, by: other.name });
  broadcast({ type: 'stock_changed', material_ids: out.invoice.material_ids, source: `invoice ${out.invoice.invoice_number}` });
  res.status(201).json(out);
});

app.post('/api/demo/receipt-60', (req, res) => {
  const out = demoReceipt60(db, req.user.id);
  broadcast({ type: 'receipt_posted', receipt_id: out.receipt.receipt_id, receipt_number: out.receipt.receipt_number, material_ids: out.receipt.material_ids, by: req.user.name });
  broadcast({ type: 'stock_changed', material_ids: out.receipt.material_ids, source: `receipt ${out.receipt.receipt_number}` });
  res.status(201).json(out);
});

/* --------------------------------------------------------- demo: data tools */

app.post('/api/demo/load-dataset', (req, res) => {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM documents').get().n;
  if (existing > 0 && !req.body?.force) {
    throw new HttpError(409, `Database already holds ${existing.toLocaleString()} records — pass force to replace`);
  }
  if (!existsSync(datasetPath)) {
    throw new HttpError(404, `Dataset not found at ${datasetPath} — place cora-erp-masked.json there or set ERP_DATASET`);
  }
  const t0 = Date.now();
  wipeBusinessData(db);
  const result = importDatasetFile(db, datasetPath);
  rebuildIndexes(db, () => {});
  res.json({ ...result, ms: Date.now() - t0 });
  broadcast({ type: 'data_changed', mode: 'dataset' });
});

app.post('/api/demo/generate-fake', (req, res) => {
  const result = generateFakeData(db, req.body ?? {}, req.user.id);
  res.json(result);
  broadcast({ type: 'data_changed', mode: 'fake' });
});

app.post('/api/demo/wipe', (req, res) => {
  if (req.body?.confirm !== 'wipe') throw new HttpError(400, 'Pass {"confirm":"wipe"} to confirm');
  wipeBusinessData(db);
  res.json({ ok: true });
  broadcast({ type: 'data_changed', mode: 'none' });
});

/* ------------------------------------------------------------------ errors */

app.use('/api', (req, res) => res.status(404).json({ error: `No such endpoint: ${req.method} ${req.path}` }));

app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details ?? null });
  }
  // body-parser failures are client errors, not server errors
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Body too large' });
  console.error(err);
  res.status(500).json({ error: 'Internal error', message: err.message });
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  const docs = db.prepare('SELECT COUNT(*) AS n FROM documents').get().n;
  console.log(`Techcora ERP demo on http://localhost:${PORT}`);
  console.log(`  tree documents : ${docs}${docs === 0 ? ' (fresh install — sign up and load or generate data from Demo tools)' : ''}`);
  console.log(`  database       : ${dbPath}`);
  console.log(`  dataset path   : ${datasetPath}`);
  console.log(`  build          : ${getMeta(db, 'built_at') ?? 'n/a'}`);
});
