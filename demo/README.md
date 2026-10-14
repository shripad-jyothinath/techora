# Techcora ERP demo — same JSON tree, an indexed server in front

A working prototype for the **“The ERP that freezes”** challenge:
the browser-tab freeze (~55 s on every invoice edit) is fixed **without
reshaping the vendor's data**. The JSON tree stays the system of record; a
small Node server indexes it, answers bounded queries, saves invoices in one
transaction, and pushes thin realtime events.

> The old system: the browser queried its own in-memory copy of whole lists —
> ~2,700 library queries × a full scan/sort of 2,656 stock rows per query, on
> the main thread. New writes were also non-atomic.
> This build: the tree lives in SQLite `documents`, all reads hit derived
> indexes, all stock writes happen in one `BEGIN IMMEDIATE` transaction, and
> open screens stay live over SSE.

## Run it

```bash
npm install        # Node 20+
npm start          # http://localhost:3000
```

A fresh install starts **empty**: sign up (the first account becomes admin),
then load data from **Demo tools**:
- **Generate sample data** — Small / Medium / Large (receipts → batches → invoices → adjustments, all through the real write paths)
- **Load masked dataset** — imports `../dataset/cora-erp-masked.json` (or set `ERP_DATASET`, or pass a path to the transform below)
- **Wipe all data** — back to zero (accounts are kept)

```bash
npm run transform    # optional CLI path: build the DB straight from the export
npm run reindex      # rebuild every derived index from the tree (recovery path)
npm run audit        # invariant checks + query plans (15/15 PASS on sample data)
npm run measure      # browser measurement: bytes / round trips / longest task at 4× CPU
npm run grow10x      # build data/erp10x.sqlite at ≈10× volume (same write paths)
npm run doc          # DIAGNOSIS.md → DIAGNOSIS.docx
```

The measurement and growth tools operate on whatever database the target server
has loaded; reload the masked dataset from Demo tools for a clean state after
running them.

## Tests

```bash
npm test             # full E2E suite (Playwright, 37 tests, ~45 s)
npm run test:api     # API contract only
npm run test:ui      # browser flows only
```

The suite runs against an **isolated database** (`data/test.sqlite`, port 3100,
started automatically by `playwright.config.js`) — your working data is never
touched. Coverage: auth/session lifecycle, invoice list keyset
pagination/sort/search, saving invoices (atomic decrement, movement links,
idempotent replay, oversell 409), receipts, stock-panel ordering, movement
date filters, unified search, the masked-dataset import (record counts,
legacy batch resolution), palette flows, mark-as-paid, the dynamic event over
SSE, demo-tool confirmation, and a full click-through asserting **zero console
errors**. The first run caught a real bug: receipt movements' structured
`batchId` was not read by the indexer, so purchase movements indexed without
their batch link.

## Accounts & data

| | |
|---|---|
| Sign up / log in | scrypt-hashed passwords, HttpOnly cookie sessions (`users`, `sessions` tables) |
| Writes | attributed to the signed-in account (`performedBy`) |
| Demo colleague sale | attributed to a second account when one exists |
| Fresh start | zero accounts, zero business data — the empty dashboard offers the two load options |

## What the prototype does

| Requirement (from the brief) | Where |
|---|---|
| Invoice list: page, sort, search | `#/invoices` — keyset pagination, server-side sort/filter |
| Editor: material picker + available stock + batch choice | `#/invoice/new` — FTS5 search, per-material batches, live totals |
| Saving an invoice | `POST /api/invoices` — one transaction: stock decrement, movement per line, totals |
| One aggregate view | `#/dashboard` — outstanding, month sales/purchases/margin, low stock, waiting POs |
| Dynamic event | `Demo tools` button: 12 units in 2 batches → colleague sells 10 → 60-line receipt |
| Same JSON tree | `documents` table, same paths/keys/values; `GET /api/tree?path=…` inspects it |

Extra screens: stock levels (`#/stock`) with batch drill-down, and a material
movement report with a running balance (`#/movements/:id`).

Extra UX: Ctrl/Cmd+K command palette, count-up KPIs and animated charts,
mark-as-paid + print on an invoice, date-range filter on movements, themed
confirm dialogs, reduced-motion support, and **login / signup / logout**.

## Measured payloads (this build, uncompressed)

| Screen / request | Bytes |
|---|---|
| Invoice list, 25 rows | **5.9 KB** (old system: 12.2 MB for 10 rows) |
| Dashboard (one request, all cards) | **2.9 KB** (old: 22.2 MB) |
| Material search (FTS5, 20 rows) | **2.7 KB** |
| Stock levels page, 25 rows | **4.0 KB** (old: 4.9 MB) |
| Batch panel, worst material (137 rows of history) | 30 KB |
| Movement report, worst material (525 movements) | 192 KB |

## Layout

```
server.js              HTTP API + SSE + static files + auth gate + demo data tools
lib/schema.sql         documents (tree), derived index tables, users/sessions
lib/tree.js            write/read helpers for the tree (the only writer of `documents`)
lib/indexer.js         record → index mapping; rebuildIndexes() recovery
lib/queries.js         all read paths (indexes only)
lib/writes.js          saveInvoice / postReceipt transactions + demo helpers
lib/auth.js            accounts + cookie sessions (scrypt, HttpOnly)
lib/import.js          dataset importer (shared by CLI transform and the UI action)
lib/fakedata.js        sample-data generator + wipe (real write paths)
lib/events.js          SSE hub (thin events, heartbeat)
scripts/transform.js   export JSON → documents → indexes (+ verification vs the brief)
scripts/reindex.js     rebuild indexes from the tree
public/                vanilla ES-module UI (no build step)
EXPLAINER.md           every concept, file, query and likely interview question
```

## The dataset

`cora-erp-masked.json` is confidential and **not committed**.
The transform expects it at `../dataset/cora-erp-masked.json` (or pass a path:
`node scripts/transform.js <path> [out.sqlite]`).
