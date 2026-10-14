# EXPLAINER — the whole project, for a junior backend dev

Everything in this repo, in plain language: **why** each piece exists, **what**
each file does, **which line does what**, and the **questions you will be
asked** — with crisp answers. Read it top to bottom once; after that you can
defend every decision in the interview.

---

## 0. The story in 60 seconds

The old ERP is a browser app wired **directly** to a hosted realtime JSON
database. Every screen subscribes to *whole lists* and keeps them in memory
forever. There are no server-side indexes, joins or aggregates, so every
question — “stock rows for material X”, “invoices sorted by date”, “sum of
balances” — is answered **in the browser, on the main thread, by scanning and
re-sorting the in-memory copy**. One click on **Edit invoice** runs ~2,700 of
those queries; each scans/sorts all **2,656** stock rows → ~55 s of one
uninterrupted main-thread task → the tab freezes. It is slow even when the
screen shows almost nothing, because whole lists are downloaded per screen
(dashboard: 22.2 MB for a few cards).

Our fix keeps **the same JSON tree** as the system of record but moves the
query engine next to the data:

- the tree is loaded into a `documents` table (same paths, same records);
- **derived index tables** answer every screen query with B-tree lookups
  (`O(log n + k)` instead of `O(n)` per query);
- **one HTTP server** is the only writer; every stock change is a single
  SQLite transaction (`BEGIN IMMEDIATE` + `WHERE quantity >= ?` guard →
  negative stock is impossible, retries are idempotent);
- **SSE** pushes thin events so open screens stay live, and clients refetch
  only the slice that changed;
- a **reindex script** rebuilds every derived table from the tree at any time.

Measured on the full masked dataset: invoice list = **5.9 KB** per 25 rows
(old: 12.2 MB for 10 rows), dashboard = **2.9 KB** in one request (old: 22.2
MB), no main-thread task above a few milliseconds on any screen.

A fresh install starts empty: **sign up** (first account = admin), then load
the masked dataset or generate sample data from **Demo tools**. Accounts use
scrypt-hashed passwords and HttpOnly cookie sessions; every write is
attributed to the signed-in account.

---

## 1. The diagnosis — the part you must be able to explain cold

### 1.1 The one cause of the freeze

`T_freeze ≈ Q × c × S`

- `Q` = queries issued by one action, all of the form “stock rows where material = X”
- `S` = rows in the local stock copy the query must scan/sort (**2,656**) — no index exists
- `c` = cost per row per query ≈ 28 ms ÷ 2,656 ≈ **10.5 µs**

Fitting the evidence:

| Observation | Explanation |
|---|---|
| ~2,700 queries on Edit | the editor enumerates the **whole catalogue**: 2 × 1,346 materials ≈ 2,692 |
| 55 s, one long task | 2,692 × ~20–28 ms, all synchronous on the main thread |
| 0 MB network during freeze | lists were downloaded earlier; this is **local compute** |
| 5-line ≈ 35-line invoice | cost ∝ catalogue × stock, **not** invoice; lines only add ≤35 queries among 2,700 |
| read-only invoice fast (0.2–0.9 s) | no picker → ≈1 query per line × 28 ms = 0.14–0.98 s |
| New PO ≈ 2/3 of Edit | same mechanism, ~0.69× the query count (~1,860 vs ~2,700) |
| 93% in the client library | scans/sorts happen inside the vendor's local query engine |

### 1.2 General slowness (a different problem, different fix)

Every screen downloads ≥ the whole database (dashboard literally re-pulls the
invoice list 4×, once per card), keeps subscriptions forever, renders 19,600
DOM nodes on one screen. Fixing the freeze does **not** fix this — it needs
bounded payloads (pagination, projections, one-request aggregates) and
subscription lifecycles. Say this explicitly in the interview: **same root
cause (compute in the wrong place), different mechanics.**

### 1.3 What we cannot know without the original code (and how to confirm)

The numbers are behaviours; the hypotheses are falsifiable:
instrument the library's query function (count calls per screen — expect
≈2,700 all “stock where material”), patch the comparator to count compares
(~30k per query for 2,656 rows), profile the 4 card components of the
dashboard. State these as a measurement plan, not guesses.

### 1.4 Data defects we found (verified against the real file)

1. **1,558 of 2,656** stock rows carry quantity 0 (dead batches never deleted);
   one material has **137** batch rows.
2. **4,637 of 5,240** sales movements have `relatedDocumentId: "new"`; the
   invoice number lives only in a free-text note (**4,584** resolve; 53 don't).
3. Movement **cost fields actually hold the sale price** — verified:
   `sum(movement.total_cost) == invoice.total` for **2,789 of 2,853**
   resolvable documents. Legacy margin must come from **batch costs**.
4. The invoice line's batch reference is composite
   `materialId_batchId` — **4,684 of 4,717 resolve** once you strip the
   material prefix; 33 stay unresolved.
5. Every one of the **5,211 invoice line ids is an empty string**.
6. Mixed types: quantity is a string in **3,241** movements and **3,220**
   lines; `unitPrice`/`costPerUnit` strings appear too.
7. Three id styles (13-digit timestamps, Firebase push ids, UUIDs).
8. 22 movements reference deleted materials; 8/22 stock adjustments' links
   dangle; 317 movements labelled `purchase_order` actually point at receipts.
9. 39/59 vendors' `id` field differs from their key.
10. Storage locations live under two different paths; UI scratch fields
    (`availableStock`, `isValid`, `selectedBatchId`) are persisted inside
    business records.
11. Invoice numbers come in three shapes (`40027`, `INV-43130`, `INV-202510-21519`)
    plus `DOC-…` direct-delivery numbers mixed into the same collection.
12. Openers: only **5 user accounts** + a `system` actor appear.
13. Adjustment movements carry **no direction** of their own — the sign must be read from the linked `stockAdjustment` (`adjustmentType`), and that link resolves for only 14 of the 22 adjustments.

### 1.5 Stock logic — reviewed as a domain problem (what was wrong, what is right now)

The freeze was an engineering bug; stock is a **domain** system and deserves the
same scrutiny. What the review changed in the demo:

- **Batch reference, not batch guess.** A sale must say *which goods receipt*
  it sold from. Legacy lines stored it as `materialId_batchId` (resolved for
  4,684 of 4,717); new writes always store a plain `batchId`, so cost and
  traceability are exact going forward.
- **Adjustments need a direction.** `increase` adds a batch (with a cost),
  `decrease` removes from a chosen batch; the movement records the direction,
  and the movement report signs the running balance accordingly. Legacy rows
  resolve direction from the linked adjustment where possible (14/22) and are
  shown unsigned otherwise — surfaced, not guessed.
- **Out of stock is not the same as low stock.** A material with zero available
  units (including materials with no batches at all) is counted separately from
  materials below their reorder point. The dashboard shows both.
- **The price suggestion is a price, not a cost.** The editor defaults the unit
  price to the material's **last invoiced price** (falling back to batch cost);
  batch choice no longer overwrites it. Selling at cost by accident was
  possible before this fix.
- **Zero dead weight in the picker.** Batches with 0 remaining are disabled but
  kept (history), usable batches are listed oldest-first. The “sell from the
  oldest receipt” default matches the brief's sample scenario.
- **The invariants are enforced where the data lives:** availability check,
  conditional `UPDATE … WHERE quantity >= ?`, and a single-writer transaction.
  A stock adjustment decrease uses the same guard as a sale.
- **A fresh install starts at zero.** No data, no accounts — sign up, then load
  the masked dataset or generate sample data. “Zero” is a state you can return
  to (wipe) without deleting accounts.

These are design constraints, not footnotes — the migration handles each one
(Section 10).

---

## 2. The design — keep the tree, add the engine

```
┌──────────────┐   JSON + SSE    ┌─────────────────────────────┐      ┌───────────────────────────┐
│ Browser UI   │ ──────────────► │ Node server (express)       │      │ SQLite (WAL)              │
│ vanilla ES   │ ◄────────────── │ reads → lib/queries.js      │ ───► │ documents  (the JSON tree)│
│ modules      │  page slices,   │ writes→ lib/writes.js       │      │ idx_*      (derived)      │
└──────────────┘  thin events    │ SSE   → lib/events.js       │      │ request_log, meta         │
                                 └─────────────────────────────┘      └───────────────────────────┘
```

**Why keep the JSON tree instead of fully normalising?** The brief offers
“keep or replace — just justify it”. Keeping the tree:

- makes migration a **copy**, not a rewrite: same paths, same keys, same
  values — nothing can be “lost in translation”;
- keeps the tree as the **system of record**; everything else is derived and
  rebuildable (`npm run reindex`), which is exactly the answer to “a derived
  value is found to be wrong — detect and rebuild”;
- still fixes the freeze, because indexes — not shape — are what make queries
  cheap. A relational schema would also work; this one is smaller to build and
  argue.

**Why a server (the brief explicitly allows it)?** Correct multi-record
writes and bounded reads need a place where the data lives. A browser cannot
guarantee “stock never negative” across two tabs; a single-writer transaction
can. And the browser should never hold more than the screen it shows.

**Why SQLite?** 11.7 MB now, ~120 MB at 10×, 5 users, ~500 movements/month:
one file, WAL, ACID, FTS5, window functions, zero ops, `npm install && npm
start` for the reviewer. Postgres would be equally correct; it adds install
friction and buys nothing at this scale. State this trade-off openly.

---

## 3. File-by-file walkthrough

### `demo/server.js` — the HTTP surface
- Creates the express app, JSON body parsing (`limit: '5mb'`), a request log
  line per `/api/` call (your demo evidence), and static file serving from
  `public/`.
- One route per screen (`/api/invoices`, `/api/dashboard`, `/api/stock-levels`,
  `/api/materials/search`, `/api/materials/:id/stock`, `/api/movements`),
  one write route per document (`POST /api/invoices`, `POST /api/receipts`),
  three demo helpers, `/api/events` (SSE), and `/api/tree` (inspect the raw
  tree — proof it is the system of record).
- After a successful write it calls `broadcast(...)` **outside the
  transaction** — you never push events for something that didn't commit.
- Auth: `POST /api/auth/signup|login|logout`, `GET /api/auth/status`; every
  other `/api` route passes through a session gate and writes are attributed
  to the signed-in account.
- Demo data tools: `POST /api/demo/load-dataset` (imports the export),
  `POST /api/demo/generate-fake` (sample data), `POST /api/demo/wipe` — all
  broadcast a `data_changed` event so open tabs re-render.
- Error middleware turns `HttpError(409, …)` into a JSON 409 with `details`
  the UI can act on (which batch fell short, how many are left).

### `lib/schema.sql` — the whole data model, readable at a glance
Two layers, documented in the header: `documents` (the tree) + `idx_*`
(derived), plus `users`/`sessions` for accounts and `request_log`/`meta` for
idempotency and build info. Notable choices: guarded decrements (Section 7), FTS5
mirror with triggers for materials, indexes on every column a screen sorts or
filters by.

### `lib/db.js` — opening the database properly
`journal_mode = WAL` (readers never block the writer), `synchronous = NORMAL`
(durable across crashes, fast), `busy_timeout = 5000` (wait for the lock
instead of throwing), plus `meta` get/set helpers.

### `lib/tree.js` — the only writer of `documents`
`upsertDocument(db, collection, id, value)` writes the record JSON at
`collection/id`; `readDocument(db, path)` reads it back. A code rule: no other
file touches `documents`.

### `lib/indexer.js` — record → index mapping (the heart)
- `indexDocument()` switches on the collection and upserts the right index
  rows (invoices + lines, materials, stock, movements, customers, vendors,
  POs + lines, receipts + lines).
- `indexMovement()` parses the legacy note (`Invoice #…`, `PO: …`,
  `Batch: …`), marks `document_id` NULL when the link literally says `"new"`,
  and preserves the raw item id as `legacy_item` when the material is gone.
- `resolveBatchRef()` handles the composite legacy reference
  (`materialId_batchId`) and plain new-style ids.
- `rebuildIndexes()` drops every derived table, rebuilds from `documents`
  inside one transaction, enriches stock rows with receipt dates, rebuilds
  the FTS mirror, and reports how many batch references resolved.
  **This is your “detect and rebuild” answer.**

### `lib/queries.js` — every read path
- `listInvoices()`: server-side filter/sort + **keyset** pagination. The
  cursor is base64 of `{last sort value, id}`; the `WHERE` clause becomes
  `(col > @v) OR (col = @v AND id > @id)` — page 500 costs the same as page 1.
- `searchMaterials()`: FTS5 MATCH with prefix terms (`"gauge"*`), fallback to
  `LIKE`; joins the available quantity for the visible rows only.
- `getMaterialStock()`: one material's batches, usable first, oldest first
  (FIFO suggestion).
- `getDashboard()`: five indexed aggregates in one request; COGS is computed
  from **batch costs** via the line's resolved batch id, and reports
  `cogsCoverage` honestly.
- `getMovements()`: window function `SUM(...) OVER (ORDER BY date, id)` for a
  running balance; opening balance = last cumulative value before the range.
- `listStockLevels()`: grouped per material, paginated, searchable.

### `lib/writes.js` — the transactions
`saveInvoice()` and `postReceipt()` in detail in Section 7. Both:
validate everything first, aggregate demand **per batch**, check availability,
write tree documents + index rows + idempotency log in **one** transaction,
and return ids for the SSE broadcast.

### `lib/auth.js` — accounts and sessions
- `signup()` validates shape (3–32 char username, ≥6 char password), hashes with
  **scrypt** + per-user salt, and makes the **first account the admin**.
- `createSession()` stores a SHA-256 of a 256-bit random token in `sessions`;
  the raw token goes into an **HttpOnly, SameSite=Lax cookie**. `sessionUser()`
  resolves the cookie on every request and lazily deletes expired sessions.
- Passwords are compared with `timingSafeEqual` — no plaintext, no shared
  session secret to leak.

### `lib/import.js` — the dataset importer
The tree-walking logic shared by `scripts/transform.js` and the
"Load masked dataset" button: copy every record collection into `documents`
inside a transaction, seed the invoice/receipt number sequences (ignoring
`DOC-*` outliers), stamp build metadata. One implementation, two callers —
the CLI and the UI import produce identical state.

### `lib/fakedata.js` — sample data + wipe
- `wipeBusinessData()` empties every business table (documents + indexes + the
  idempotency log) and resets number sequences. Accounts survive.
- `generateFakeData()` creates materials, customers, vendors, locations, POs,
  receipts (→ real batches + movements), invoices (→ real sales from real
  batches, with `sent`/`paid`/`partial` statuses), and a few stock adjustments
  (increase/decrease). **Everything goes through `postReceipt()` and
  `saveInvoice()`** — the generator cannot create data the API itself would
  reject, and the users table stays untouched.

### `lib/events.js` — the realtime hub
A `Set` of open SSE responses; `broadcast()` writes one `data:` frame to each;
a 15 s heartbeat keeps proxies from closing idle connections; clients that
disconnect are simply dropped (they refetch on reconnect — correctness never
depends on the event).

### `scripts/transform.js` — the migration
Walks the export, copies every record collection into `documents` inside a
transaction, rebuilds indexes, seeds the invoice/receipt number sequences
(deliberately ignoring `DOC-*` outliers), and **verifies record counts against
the numbers published in the brief** (7,761 / 2,869 / 1,053 / 1,068 / 2,656 /
1,346 / 203 / 59). Prints a pass/fail table. ~6 s cold.

### `scripts/reindex.js` — recovery
Rebuilds all derived tables from the tree. Run it after any suspected index
drift; it also re-resolves legacy batch references.

### `scripts/audit.js` — the invariant audit (`npm run audit`)
Runs 15 checks against whatever data is loaded: stock never negative, the
index agrees with the tree (quantities and totals), invoices tie to their
lines, balances tie to total − paid, **batches reconcile with signed
movements per material**, document links resolve, **receipt movements carry
their batch**, batch-reference coverage, both FTS mirrors (materials and
invoices), duplicate numbers, orphans, `PRAGMA quick_check` — then prints
`EXPLAIN QUERY PLAN` for the four hottest queries. On freshly written data
(sample-data mode) it reports **15/15 passed, 0 warnings**; on the legacy
export it reports the historical gaps as WARN — never hidden, never fatal.
Rebuilds are also mirror-safe: `rebuildIndexes()` drops the external-content
FTS mirrors and their triggers, rebuilds the content, then recreates both and
runs FTS5 `rebuild` (deleting content under live triggers would emit delete
marks for never-indexed rows and corrupt the mirror — found the hard way).

### `tests/` + `playwright.config.js` — the E2E suite (`npm test`)
37 Playwright tests against an isolated database (`data/test.sqlite` on port
3100, started by the config; your dev data stays untouched): auth/session
contract, invoice list keyset paging/sort/search, saving invoices (atomic
stock decrement, movement links, idempotent replay, oversell 409), receipts
(creates batch + linked movement), stock-panel ordering, movement date
filters, the unified search, the masked-dataset import (record counts and
legacy batch resolution), mark-as-paid, palette flows, the dynamic event over
SSE, demo-tool confirmation, and a click-through asserting **zero console
errors**. The first run caught a real bug: the indexer only parsed batch ids
from legacy note text and ignored the structured `batchId` field, so purchase
movements indexed without their batch link — fixed, covered by a test, and
backfilled by `npm run reindex`.

### `DIAGNOSIS.md`, `DIAGNOSIS.docx`, `VIDEO_SCRIPT.md` — submission artifacts
The diagnosis is written **against the brief, line by line**, with a compliance
map (Section 0) that points every requirement at where it is answered and which repo
file proves it. `npm run doc` renders the markdown into a styled Word document
for the submission email (the markdown stays the single source of truth). The
video script is word-for-word and maps its scenes to the four things the brief
requires the video to cover: problem + domain + diagnosis, architecture and
decisions, the working system with the dynamic event and before/after numbers,
and what the solution does not handle.

### `public/index.html` / `styles.css` / `app.js` — the UI
No build step, ES modules. Light theme in the site's own palette (orange
`#F85419`, near-black ink, warm paper), Funnel Sans for text, Orbitron for
numerals. Router on `location.hash`. Screens: dashboard, invoice list, invoice
view (read-only), invoice editor, stock levels with batch drill-down,
movement report. The header chip shows **live measurements in the tab**:
longest main-thread task (via `PerformanceObserver('longtask')`), API round
trips, and transfer bytes (via `PerformanceResourceTiming`) — so the demo
video can show numbers instead of claiming them. The “Demo tools” drawer runs
the dynamic-event scenario through the real API.

Extra UX in this build: **Ctrl/Cmd+K command palette** — one FTS-backed box
that finds any invoice (number or customer) or stock item (name or model),
with “show all” actions that open the invoice list / stock levels pre-filtered
— plus count-up KPI values, growing chart bars, per-route entrance animations,
themed confirm dialogs, **mark-as-paid** on an invoice, **print-ready invoice
layout**, **date-range filtering** on the movement report, click-through from
low-stock rows to a material's movements, skeleton loaders — and a
`prefers-reduced-motion` mode that turns animation off. Sessions: sign up /
log in / log out with an HttpOnly cookie; the header shows the signed-in
account.

---

## 4. Packages, plainly (you said you don't know the packages)

| Package / feature | What it is | Why here |
|---|---|---|
| **better-sqlite3** | Node binding for SQLite. Synchronous API, prepared statements, `db.transaction(fn)`. | The whole server is one SQLite writer; sync calls are simpler and faster than async pooling for this scale. Its `.immediate()` gives `BEGIN IMMEDIATE` (write lock up front). |
| **express** | Minimal HTTP framework: routing, `express.json()`, static files, error middleware. | The most readable way to expose ~15 endpoints with zero ceremony. |
| **SQLite WAL** | Write-Ahead Logging: changes go to a log file first; readers read consistent snapshots without blocking the writer. | 5 users, one writer, many readers — WAL fits exactly. |
| **FTS5** | SQLite's full-text search index (inverted index). | Material search by name/model in µs–ms; `MATCH 'gauge*'`, ranked. |
| **Window functions** | SQL that computes aggregates *over rows* (`SUM(...) OVER (ORDER BY …)`). | Running balance in the movement report without storing it. |
| **SSE** | Server-Sent Events: one-way push over plain HTTP (`text/event-stream`). | Thin realtime notifications; simpler than WebSockets (no upgrade, auto-reconnect in `EventSource`). |
| **`node:crypto` randomUUID** | Generates UUIDs. | Document ids for new invoices, receipts, batches, movements. |
| **`node:fs` / `node:path` / `node:url`** | Filesystem and path helpers. | Read the dataset, locate files. |
| **Schema/DB concepts** | PKs, indexes, transactions, upserts (`ON CONFLICT DO UPDATE`), CHECKs, prepared statements | Standard relational tooling, applied server-side. |

---

## 5. The endpoints (inputs → outputs → cost)

| Endpoint | Query/body | Returns | Cost |
|---|---|---|---|
| `GET /api/invoices` | `status,q,sort,dir,cursor,limit` | rows + `next_cursor` + total | 1 index scan of 25 rows + 1 count |
| `GET /api/invoices/:id` | — | invoice doc + lines (joined material names) | 2 PK lookups + ~35 line reads |
| `POST /api/invoices` | customer, date, lines[{material,batch,qty,price}], request_id | ids, totals, stock changes | 1 transaction (see Section 7) |
| `GET /api/materials/search` | `q,limit` | 20 rows with `available` | FTS5 lookup |
| `GET /api/search` | `q,limit` | invoices + materials for the palette | 2 FTS5 lookups (one request) |
| `GET /api/materials/:id/stock` | — | material + batches | 2 indexed reads |
| `GET /api/dashboard` | — | all cards | 5 small aggregates |
| `GET /api/stock-levels` | `q,page,limit` | grouped rows | 1 grouped scan (bounded, paginated) |
| `GET /api/movements` | `material_id,from,to` | rows + running balance | index range + window function |
| `POST /api/receipts` | lines[{material,qty,cost}] | batch ids | 1 transaction |
| `GET /api/events` | — | SSE stream | one connection per tab |
| `GET /api/tree?path=…` | — | raw tree record | 1 PK lookup (proves the tree is real) |

---

## 6. The schema, table by table

- **`documents`** — `path` PK (`sales/invoices/<uuid>`), `collection`, `doc_id`,
  `value` (JSON), `updated_at`. The system of record.
- **`idx_invoice`** — one row per invoice, indexed for every sort/filter the
  list screen offers (number, date, due, total, balance, customer, status).
- **`idx_invoice_line`** — one row per line; `batch_ref` = raw legacy value,
  `batch_id` = resolved stock batch (see Section 1.4 item 4). `batch_id` is what COGS
  and the demo’s traceability use.
- **`idx_material` + `fts_material`** — the catalogue and its FTS mirror
  (kept in sync by triggers).
- **`idx_stock`** — one row per batch: remaining quantity, unit cost, receipt
  link, location, received date. Quantity is the invariant column.
- **`idx_movement`** — append-only ledger, one row per line sold/received;
  carries `document_type`/`document_id`/`batch_id` for every **new** write.
- **`idx_customer` / `idx_vendor`** — master data; `alias_id` keeps the legacy
  `id` when it differs from the key.
- **`idx_po` + `idx_po_line`**, **`idx_receipt` + `idx_receipt_line`** —
  purchasing, needed for the dashboard’s “awaiting delivery” card.
- **`request_log`** — idempotency: each write stores its `request_id` and
  response; a retry returns the stored response without side effects.
- **`meta`** — build info and number sequences (`next_invoice_no`, …).

---

## 7. The write path, step by step (`POST /api/invoices`)

Inside `db.transaction(...).immediate()`:

1. **Idempotency** — if `request_id` was seen, return the stored response
   (marked `idempotent: true`). Retries can never double-sell.
2. **Resolve customer** — by id or alias.
3. **Resolve every line** — material exists, batch exists **and belongs to
   that material**, quantity > 0; default the unit price to the batch's cost.
4. **Aggregate demand per batch** — two lines may pick the same batch.
5. **Availability check** — demand vs remaining, with a 409 that includes
   the available number and material id (the UI turns this into a toast and a
   refreshed stock panel).
6. **Insert the invoice** — tree document in the vendor's field style
   (`customer` snapshot, `items[].unitPrice/totalPrice`, plus the new
   `batchId`) + matching index rows.
7. **Per line** — decrement the batch with
   `UPDATE idx_stock SET quantity = quantity - ? WHERE batch_id = ? AND quantity >= ?`
   and require `changes === 1` (belt-and-braces: even a bug can't write
   negative stock), update the tree document, append a movement with
   `relatedDocumentType: 'invoice'`, the real invoice id, and the batch id.
8. **Store the idempotency record** and commit.
9. **After commit** — broadcast `invoice_saved` + `stock_changed`
   with the affected material ids.

`postReceipt()` is the mirror image: one receipt document, N batch documents,
N purchase movements, all in one transaction. A 60-line receipt commits in
milliseconds — the brief’s “storekeeper posts 60 lines” case.

**Why this ordering?** Fail before writing whenever possible, write everything
or nothing, and keep the ledger (`idx_movement`) append-only — corrections
become compensating movements, never edits.

---

## 8. Realtime, step by step

1. The UI opens one `EventSource('/api/events')` per tab.
2. The server keeps the response objects, writes a `hello`, and heartbeats
   every 15 s.
3. After any committed write, `broadcast()` sends `{seq, at, type,
   invoice/receipt ids, material_ids, by}` to every tab.
4. The editor keeps a listener: if any of its draft materials is in
   `material_ids`, it refetches **only that material's stock panel**, marks
   lines whose batch no longer covers their quantity, and shows the banner
   you saw live in the E2E: *“Stock moved under you (invoice INV-223469) —
   affected batches refreshed; the server will re-check on save.”*
5. Nobody trusts the event: on reconnect (or on load) screens refetch; on save
   the server re-validates everything. Events are UX, not correctness.

**Why SSE over WebSocket?** One-way notifications, auto-reconnect, no upgrade
handshake, trivially debuggable with `curl -N`. WebSockets would be right for
bidirectional collaboration; we don’t need that.

**Known limitation**: the hub is in-process — running two server instances
would split subscribers. A production version puts a tiny pub/sub (Redis)
behind it. Say this before they ask.

---

## 9. Migration decisions (every loose end → answer)

| Loose end | What the transform does |
|---|---|
| String quantities/prices | tree keeps them verbatim; indexes coerce with a tolerant `num()`; new writes are always typed numbers |
| 4,637 “new” document links | note parsed → `document_no`; `document_id` stays NULL so coverage is reported, not faked |
| 33 unresolvable batch refs | `batch_id` NULL, `batch_ref` kept; coverage surfaced |
| 5,211 empty line ids | new surrogate ids only on **new** lines; legacy lines identified by `(invoice_id, line_no)` |
| 22 orphan movements | `material_id` NULL + `legacy_item` kept; still visible in reports with “unknown item” |
| 39 vendor id mismatches | key is canonical; old id kept as `alias_id`; lookups match either |
| Two storage-location paths | both collections stay in the tree; indexes use the record fields that actually reference them |
| Mixed id styles | everything is TEXT; no assumptions about sortability |
| DOC- numbers in invoices | kept as records; excluded from the invoice-number sequence |
| UI scratch fields in records | kept in the raw tree (fidelity), **never** used by indexes or writes |
| Client-side drift (embedded customer) | snapshot kept for display; live joins use `customer_id`; new writes snapshot + join consistently |

The transform never rewrites tree values. Fidelity is the feature:
reviewers can diff `documents` against the export.

---

## 10. Measurements — how to take them (and what we already took)

- **Bytes / round trips**: browser devtools Network tab (or the in-app chip).
  Recorded for this build: invoice list 5.9 KB / 1 request; dashboard 2.9 KB /
  1; search 2.7 KB; stock page 4 KB; worst-case batch panel 30 KB; worst-case
  movement report 192 KB (525 rows — paginate if you like).
- **Longest main-thread task**: the header chip uses
  `PerformanceObserver({type:'longtask'})`; it shows the max since load.
  On these screens it stays in single-digit ms. The 4× CPU-throttle figures
  for the demo video: Chrome DevTools → Performance → CPU: 4× slowdown, then
  click through the screens — or script it with Playwright later.
- **Targets from the brief**: <200 ms longest task ✅; editor + search <1 s ✅;
  list bytes ∝ screen ✅; 10× ≤2× worse — expected ✅ because every query is
  `O(log n + k)` and pages are fixed-size; stock never negative ✅ (DB guard +
  transaction); derived values never silently wrong ✅ (reindex + coverage
  reporting).

**10× story**: the schema scales by construction — point queries add one tree
level; the only linear things are the grouped scans on the stock screen, which
are already paginated. The dashboard’s five aggregates read ~30k narrow rows
at 10× — still milliseconds. The first thing to outgrow SQLite is
concurrent writers, and at that point you move the same schema to Postgres.

---

## 11. How you will be judged → where each box is ticked

| Judging criterion | Evidence in this repo |
|---|---|
| **01 Domain understanding** | Batch/lot stock explained; FIFO suggestion; real margin from batch costs (17.6% this month, not the fake ~0% the movement costs suggested); costed from batches with coverage shown; who is hurt by the freeze (Section 1, EXPLAINER Section 0–1) |
| **02 Diagnosis** | Every measurement explained in Section 1.1; cost formula with units; 12-month and 10× predictions; every claim verified against the file (transform prints count checks; `scripts/peek-*.mjs` show the batch-ref and price-field findings) |
| **03 Architecture** | Tree + derived indexes + single-writer transactions + SSE; per-screen read paths with round trips (EXPLAINER Section 5); stored vs derived stated in `schema.sql` |
| **04 Technical reasoning** | Why SQLite/keyset/FTS5/window functions; consistency budget (EXPLAINER Section 7 + REPORT Section 7.1); pagination cost explained |
| **05 Failure & edge cases** | 409 oversell demo (ran live: available 2 vs requested 10); idempotent retry demo (INV-223467 returned twice, one write); orphan/vendor/format handling (Section 9); reindex recovery |
| **06 Trade-offs & demo** | Limitations section in README/REPORT; Demo tools drawer reproduces the dynamic event end-to-end |

---

## 12. Demo video script (5–7 minutes)

0. **0:00** Fresh install: sign up (first account becomes the admin) → Demo
   tools → **Load masked dataset**. (Or show “Generate sample data” first to
   underline that a new ERP starts at zero.)
1. **0:20** The brief in one sentence + the freeze numbers (55 s, 0 MB, flat across invoice sizes).
2. **0:40** Whiteboard the cost model `Q × c × S`; explain 2×1,346 ≈ 2,700 and 28 ms/query.
3. **1:40** Architecture: tree stays, indexes added, one writer, SSE. Show `schema.sql` + `documents` row via `/api/tree`.
4. **2:40** Invoice list: search, sort, flip pages — point at the header chip (bytes/req/task) staying tiny.
5. **3:40** Editor: search “M95458”, batches with costs, add lines, save. Show the toast (atomic write).
6. **4:40** **Dynamic event**: Demo tools → step 1 (12 units, 2 batches) → open editor via the link → step 2 (colleague sells 10) → editor shows the banner + “2 available” without reload → try to oversell → 409 toast with the fresh number → step 3 (60-line receipt) → movement report shows running balance.
7. **5:40** Numbers vs old system (table), then limitations (single instance, no auth/offline, history best-effort) and what 100× changes.
8. **6:30** Close: what we proved — “the fix is compute next to the data.”

---

## 13. Interview Q&A bank (answers in one or two sentences)

**Diagnosis**
1. *Why did it freeze with zero network?* The lists were already in memory; the freeze is the local query engine scanning/sorting 2,656 rows per query, 2,700 times, on the main thread.
2. *Why identical times for 5 vs 35 lines?* The triggered work is proportional to the catalogue (2×1,346 ≈ 2,700 queries), not the invoice; lines add ≤35 queries.
3. *Why is read-only open fast?* No picker prefetch: ~1 query per line × 28 ms = 0.2–0.9 s, exactly as measured.
4. *Why does New PO take two-thirds?* Same mechanism with ~0.69× the per-material query work (~1,860 vs 2,700).
5. *What's the single cause vs the general slowness?* Freeze = one unbounded task (queries × scan). Slowness = data gravity (whole-list downloads, retained subscriptions, 19.6k DOM nodes). Different fixes.
6. *What can't you know without the code?* Exact query counts, whether the sort is in the lib or app, whether the dashboard truly re-pulls the list 4×; how you'd instrument each.
7. *Predict in 12 months / at 10×.* T ∝ Q×S; stock +~150 rows/month → ~1.7× freeze; 10× data → ≥10× freeze (hours), because S scales and Q may too.

**Architecture**
8. *Why keep the tree?* Migration = copy, zero data loss; tree stays the source of truth; indexes — not schema — remove the scan cost; reindex = recovery.
9. *Why not Firebase/keep the vendor?* It cannot do joins/aggregates/server search; the freeze is inherent to client-side querying; we need the write transaction co-located with the data.
10. *Why SQLite over Postgres?* Scale (5 users, ~25 writes/day), zero-ops reviewer story, same SQL semantics; Postgres when you need multi-writer concurrency or managed backups.
11. *Why is a server allowed?* The brief says either answer is acceptable if justified; “no application server” describes today's build, not the constraints.
12. *What's stored vs derived?* Stored: tree records, batch quantities, invoice totals, number sequences, idempotency. Derived: index tables, material stock rollups, dashboard aggregates, running balances.
13. *Who keeps derived data correct?* The single indexer inside write transactions; `reindex.js` rebuilds from the tree if anything is suspected.
14. *What if a derived update fails halfway?* Impossible by construction: it's the same transaction — all or nothing. Detection: reindex/cross-check queries.
15. *How do pagination/sort/search work, and cost?* Keyset cursor → index range scans; FTS5 inverted index for materials; LIKE fallback. Page N costs ≈ page 1.
16. *Why not OFFSET?* Cost grows with depth (skip + discard), breaking the 10×-≤2× target.
17. *Round trips per screen?* 1 for list/dashboard/stock; 1 + 1 per search keystroke (debounced) in the editor; 1 per save.

**Consistency & failures**
18. *Two people sell the last units — walk through it.* Single writer; `BEGIN IMMEDIATE` serializes; second transaction re-reads remaining, gets 409 with fresh numbers; UI shows the banner; no negative stock.
19. *Save succeeds but derived totals fail?* Totals are computed server-side in the same transaction; there is no separate update to fail. If a cache existed, it would be same-transaction or rebuildable.
20. *Connection drops mid-save, user retries.* Client-generated `request_id`: the retry returns the stored response; the DB records the sale once.
21. *A record doesn't fit the model.* Index with NULLs + `legacy_*` fields + coverage reporting; never drop silently.
22. *Derived value found wrong.* Detection: cross-check query/nightly job. Recovery: `npm run reindex` (seconds) + compare counts.
23. *How is negative stock impossible?* Three layers: availability check, conditional UPDATE with change-count assertion, and a single-writer transaction. (Could add a CHECK constraint as a fourth.)
24. *Why client-generated request ids?* The client owns the retry; it must reuse an id the server can recognize, even if the first attempt's response never arrived.

**Realtime**
25. *Why SSE?* One-way, auto-reconnect, no upgrade handshake, easy to debug; WebSocket is for bidirectional needs we don't have.
26. *What if an event is lost?* Harmless: events only trigger refetches; correctness is re-validated on save; reconnect refetches.
27. *Two servers?* Out of scope for 5 users; the hub would move to Redis pub/sub.
28. *Why thin events rather than pushing records?* Smaller frames, fewer stale-write conflicts, and the client always reads authoritative state.

**Domain**
29. *Why batches?* Purchase prices differ over time; per-batch stock lets you sell from a chosen receipt at its actual cost, compute true margin, and show available quantity per receipt. Flattening loses costing and traceability.
30. *FIFO or user choice?* The old editor let users choose; we default to oldest-first and let the user override — matching the domain.
31. *What did fixing movement links change?* Prior data made sales look like 100% margin; using batch costs gives the real ~17.6% with 100% cost coverage this month.

**Trade-offs**
32. *What did you give up?* Zero-ops vendor realtime, offline tolerance, out-of-the-box multi-instance; we own invalidation and ops now.
33. *What got harder?* More moving parts: an index layer to keep in sync (solved by one code path), a server to run, SSE state to think about.
34. *What's not handled?* Auth/roles, file attachments, invoice PDF/email, multi-instance pub/sub, deep history for the 33 unresolved batch links.
35. *100×?* Same schema on Postgres; movement report partitions by material/date; SSE behind pub/sub; everything else already bounded.

**Auth & onboarding**
36. *How do logins work here?* scrypt-hashed passwords; random 256-bit session token stored as a SHA-256 in `sessions`, sent in an HttpOnly cookie; every API route resolves the session first, and writes are attributed to that account.
37. *Why does the first account become admin?* A fresh install has zero accounts; someone must create the workspace. Subsequent signups are staff. Real deployments would invite instead of open signup.
38. *What does “starts at zero” mean?* No business data and no accounts until you create them; you can wipe back to zero at any time without touching accounts, which makes the demo reproducible.
39. *How does sample data stay consistent?* It is generated through the same `saveInvoice`/`postReceipt` transactions as user actions — batches, movements, totals and the tree are updated together by construction.

---

## 14. Limitations, stated plainly (say these first in the interview)

- Single-process SSE hub (fine for one office; Redis if scaled).
- Signup is open: anyone who can reach the URL can create a **staff** account.
  A real deployment gates invites and adds role checks per route; the schema
  already carries `role`, and writes are attributed to the signed-in account.
- Legacy history is best-effort: 53 note-links unresolved, 33 batch refs unresolved, 22 orphan movements — all *visible* as gaps rather than silently wrong maths.
- The movement report returns up to the cap (5000 rows) in one response; a production version paginates it the same way as the invoice list.
- SQLite + WAL is single-writer: perfect here, a deliberate ceiling at high write concurrency.
