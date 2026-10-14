-- Techcora ERP demo schema.
--
-- Layer 1 is the JSON tree exactly as the vendor export stores it (the system of
-- record). Layer 2 is derived query state: every index table below can be
-- rebuilt from `documents` at any time with `npm run transform` or the
-- rebuildIndexes() function. All reads hit layer 2 only.

CREATE TABLE IF NOT EXISTS documents (
  path       TEXT PRIMARY KEY,      -- e.g. 'sales/invoices/<uuid>' — same paths as the export
  collection TEXT NOT NULL,         -- e.g. 'sales/invoices'
  doc_id     TEXT NOT NULL,         -- record key inside the collection
  value      TEXT NOT NULL,         -- the record as JSON, same fields as the vendor tree
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_documents_collection ON documents(collection);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Documents / indexes: invoices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idx_invoice (
  id             TEXT PRIMARY KEY,
  invoice_number TEXT NOT NULL,
  customer_id    TEXT,
  customer_name  TEXT,
  status         TEXT,
  date           TEXT,
  due_date       TEXT,
  total          REAL,
  balance        REAL,
  line_count     INTEGER,
  created_at     TEXT,
  updated_at     TEXT
);
CREATE INDEX IF NOT EXISTS ix_invoice_number ON idx_invoice(invoice_number);
CREATE INDEX IF NOT EXISTS ix_invoice_date   ON idx_invoice(date);
CREATE INDEX IF NOT EXISTS ix_invoice_due    ON idx_invoice(due_date);
CREATE INDEX IF NOT EXISTS ix_invoice_total  ON idx_invoice(total);
CREATE INDEX IF NOT EXISTS ix_invoice_balance ON idx_invoice(balance);
CREATE INDEX IF NOT EXISTS ix_invoice_customer ON idx_invoice(customer_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS ix_invoice_status ON idx_invoice(status);

CREATE TABLE IF NOT EXISTS idx_invoice_line (
  invoice_id  TEXT NOT NULL,
  line_no     INTEGER NOT NULL,
  material_id TEXT,
  description TEXT,
  quantity    REAL,
  unit        TEXT,
  unit_price  REAL,
  discount    REAL,
  total_price REAL,
  batch_ref   TEXT,              -- raw legacy reference (often 'materialId_batchId')
  batch_id    TEXT,              -- resolved stock batch (see indexer.js)
  PRIMARY KEY (invoice_id, line_no)
);
CREATE INDEX IF NOT EXISTS ix_invoice_line_material ON idx_invoice_line(material_id);

-- ---------------------------------------------------------------------------
-- Materials (+ FTS5 search index kept in sync by triggers)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idx_material (
  id            TEXT PRIMARY KEY,
  alias_id      TEXT,
  name          TEXT NOT NULL,
  model_number  TEXT,
  default_unit  TEXT,
  reorder_point REAL,
  is_active     INTEGER
);
CREATE INDEX IF NOT EXISTS ix_material_alias ON idx_material(alias_id);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_material USING fts5(
  name, model_number,
  content='idx_material', content_rowid='rowid', tokenize='unicode61'
);
CREATE TRIGGER IF NOT EXISTS trg_material_ai AFTER INSERT ON idx_material BEGIN
  INSERT INTO fts_material(rowid, name, model_number) VALUES (new.rowid, new.name, new.model_number);
END;
CREATE TRIGGER IF NOT EXISTS trg_material_ad AFTER DELETE ON idx_material BEGIN
  INSERT INTO fts_material(fts_material, rowid, name, model_number) VALUES ('delete', old.rowid, old.name, old.model_number);
END;
CREATE TRIGGER IF NOT EXISTS trg_material_au AFTER UPDATE ON idx_material BEGIN
  INSERT INTO fts_material(fts_material, rowid, name, model_number) VALUES ('delete', old.rowid, old.name, old.model_number);
  INSERT INTO fts_material(rowid, name, model_number) VALUES (new.rowid, new.name, new.model_number);
END;

-- Invoice search (command palette + "all invoices"): number and customer,
-- indexed so the palette stays flat as the data grows.
CREATE VIRTUAL TABLE IF NOT EXISTS fts_invoice USING fts5(
  invoice_number, customer_name,
  content='idx_invoice', content_rowid='rowid', tokenize='unicode61'
);
CREATE TRIGGER IF NOT EXISTS trg_invoice_ai AFTER INSERT ON idx_invoice BEGIN
  INSERT INTO fts_invoice(rowid, invoice_number, customer_name) VALUES (new.rowid, new.invoice_number, new.customer_name);
END;
CREATE TRIGGER IF NOT EXISTS trg_invoice_ad AFTER DELETE ON idx_invoice BEGIN
  INSERT INTO fts_invoice(fts_invoice, rowid, invoice_number, customer_name) VALUES ('delete', old.rowid, old.invoice_number, old.customer_name);
END;
CREATE TRIGGER IF NOT EXISTS trg_invoice_au AFTER UPDATE ON idx_invoice BEGIN
  INSERT INTO fts_invoice(fts_invoice, rowid, invoice_number, customer_name) VALUES ('delete', old.rowid, old.invoice_number, old.customer_name);
  INSERT INTO fts_invoice(rowid, invoice_number, customer_name) VALUES (new.rowid, new.invoice_number, new.customer_name);
END;

-- ---------------------------------------------------------------------------
-- Stock batches — one row per goods receipt per material (the "batch")
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idx_stock (
  batch_id     TEXT PRIMARY KEY,
  material_id  TEXT NOT NULL,
  location_id  TEXT,
  receipt_id   TEXT,
  receipt_line INTEGER,
  vendor_id    TEXT,
  quantity     REAL NOT NULL,       -- remaining quantity
  reserved_qty REAL,
  unit_cost    REAL,
  total_cost   REAL,
  received_at  TEXT,
  status       TEXT
);
CREATE INDEX IF NOT EXISTS ix_stock_material ON idx_stock(material_id, received_at);

-- ---------------------------------------------------------------------------
-- Stock movements — append-only ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idx_movement (
  id            TEXT PRIMARY KEY,
  material_id   TEXT,
  legacy_item   TEXT,
  batch_id      TEXT,
  type          TEXT,
  direction     TEXT,
  quantity      REAL,
  unit_cost     REAL,
  total_cost    REAL,
  unit          TEXT,
  document_type TEXT,
  document_id   TEXT,
  document_no   TEXT,
  date          TEXT,
  performed_by  TEXT,
  notes         TEXT
);
CREATE INDEX IF NOT EXISTS ix_movement_material_date ON idx_movement(material_id, date);
CREATE INDEX IF NOT EXISTS ix_movement_type_date     ON idx_movement(type, date);

-- ---------------------------------------------------------------------------
-- Customers / vendors
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idx_customer (
  id           TEXT PRIMARY KEY,
  alias_id     TEXT,
  name         TEXT,
  email        TEXT,
  phone        TEXT,
  address_json TEXT
);
CREATE INDEX IF NOT EXISTS ix_customer_alias ON idx_customer(alias_id);

CREATE TABLE IF NOT EXISTS idx_vendor (
  id       TEXT PRIMARY KEY,
  alias_id TEXT,
  name     TEXT
);
CREATE INDEX IF NOT EXISTS ix_vendor_alias ON idx_vendor(alias_id);

-- ---------------------------------------------------------------------------
-- Purchasing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idx_po (
  id            TEXT PRIMARY KEY,
  order_number  TEXT,
  vendor_id     TEXT,
  vendor_name   TEXT,
  status        TEXT,
  order_date    TEXT,
  expected_date TEXT,
  total         REAL,
  line_count    INTEGER
);
CREATE INDEX IF NOT EXISTS ix_po_status ON idx_po(status);
CREATE INDEX IF NOT EXISTS ix_po_date   ON idx_po(order_date);

CREATE TABLE IF NOT EXISTS idx_po_line (
  po_id        TEXT NOT NULL,
  line_no      INTEGER NOT NULL,
  material_id  TEXT,
  description  TEXT,
  quantity     REAL,
  unit_price   REAL,
  total_price  REAL,
  received_qty REAL,
  PRIMARY KEY (po_id, line_no)
);

CREATE TABLE IF NOT EXISTS idx_receipt (
  id             TEXT PRIMARY KEY,
  receipt_number TEXT,
  receipt_date   TEXT,
  po_id          TEXT,
  vendor_id      TEXT,
  status         TEXT,
  line_count     INTEGER,
  total_cost     REAL
);
CREATE INDEX IF NOT EXISTS ix_receipt_date ON idx_receipt(receipt_date);

CREATE TABLE IF NOT EXISTS idx_receipt_line (
  receipt_id  TEXT NOT NULL,
  line_no     INTEGER NOT NULL,
  material_id TEXT,
  description TEXT,
  quantity    REAL,
  location_id TEXT,
  unit        TEXT,
  PRIMARY KEY (receipt_id, line_no)
);

-- ---------------------------------------------------------------------------
-- API write log (idempotency: a retried save returns the first result)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS request_log (
  request_id TEXT PRIMARY KEY,
  endpoint   TEXT NOT NULL,
  status     INTEGER NOT NULL,
  response   TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Auth: accounts + sessions (a fresh install starts with zero accounts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff',   -- the first account becomes 'admin'
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);
