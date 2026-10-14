# DIAGNOSIS — The ERP that freezes

**Shripad J** · repository: `github.com/shripad-jyothinath/techora` · demo video: `<link>` · 14 October 2026

This report follows the structure of the brief: **Section 1** diagnoses the freeze in the existing system, **Section 2** presents the redesign, **Section 3** describes the working prototype, and **Section 4** reports the measurements at 1× and 10× volume. **Section 0** maps every requirement of the brief to the part of this document — or the file in the repository — that answers it.

All measurements quoted in Section 1 are the brief's own; each one is explained and used in a cost model that predicts the system's behaviour. The dataset claims have been independently verified with the scripts in `scrape/`, and the redesign is demonstrated by a working system, a 38-test end-to-end suite, and an invariant audit.

---

## 0. Coverage of the brief

| Requirement of the brief | Addressed in | Repository evidence |
|---|---|---|
| Explain why the tab freezes | 1.1 | `scrape/verify.mjs` re-derives the dataset facts quoted in the diagnosis |
| Account for each odd measurement (no network, same time for any invoice, purchase order at two-thirds) | 1.2 | same, plus the arithmetic in 1.1–1.3 |
| Cost model as a formula in terms of the data, with 12-month and 10× predictions | 1.3, 4.3 | `scripts/measure.mjs`, `scripts/grow10x.mjs` |
| Separate the one cause of the hang from general slowness | 1.5 | — |
| What cannot be known without the original code, and how to confirm it | 1.4 | — |
| Data model and read paths: what is stored, derived, indexed; fetches and round trips | 2.2, 2.3 | `lib/schema.sql`, `lib/queries.js` |
| Where derived data lives, who keeps it correct, and partial-failure behaviour | 2.2 | `lib/writes.js` (single transaction), `scripts/reindex.js`, `scripts/audit.js` |
| Keep or replace the database; whether a server sits in the middle — justified | 2.1 | `server.js`, `lib/db.js` |
| Migration from the export as it is, loose ends included | 2.6 | `scripts/transform.js`, `lib/import.js` |
| Prototype on the full masked dataset: invoice list (page/sort/search), editor picker with stock and batches, saving an invoice, one aggregate view | 3, 4 | `demo/` screens; `tests/` end-to-end suite |
| The script that transforms the export | 2.6 | `npm run transform` (verifies eight record counts against the brief) |
| Measurement script: bytes, round trips, longest main-thread task, at 4× CPU | 4.1 | `scripts/measure.mjs` |
| The same numbers at 10× volume; how generated and whether realistic | 4.2 | `scripts/grow10x.mjs` |
| Numbers not achieved, reported plainly | 4.4 | — |
| Dynamic event: 12 units in two batches; colleague sells 10; 60-line receipt | 2.5, video scene 6 | demo tools; SSE test in `tests/ui.spec.js` |
| Targets: <200 ms task, editor under 1 s, bytes proportional to the screen, 10× no more than 2× worse, stock never negative, derived values never silently wrong | 4.3 | `scripts/audit.js`, the race test, E2E suite |
| Judging criteria 01–06 (domain, diagnosis, architecture, reasoning, failures, trade-offs) | whole document | `EXPLAINER.md` Section 13 prepares the discussion of each |
| Dataset not committed | — | `.gitignore` (`dataset/`, `*.zip`, `data/`) |

---

## 1. Diagnose

### 1.1 The cause of the freeze

One cause explains the observed behaviour: **the application executes thousands of unindexed queries on the browser's main thread, over a full local copy of the data.**

The application keeps an in-memory copy of every list a screen uses, never releases a subscription, and performs all filtering, sorting, joining and aggregation itself — the hosted realtime database offers no indexes and no server-side queries. Every question ("stock rows for material X", "invoices sorted by date", "sum of balances") therefore becomes a linear scan or sort of the local copy, executed synchronously.

Clicking **Edit** issues approximately **2,700** such queries: the editor prefetches stock for the full catalogue of **1,346** materials, roughly two queries per material. Each query scans and sorts all **2,656** stock rows, because no index exists for it. The result is about **7.2 million row operations inside one uninterrupted main-thread task** — the measured 55-second freeze. The CPU profile attributes **93%** of that time to exactly this work inside the client library.

### 1.2 Each measurement, accounted for

| Measurement from the brief | Explanation |
|---|---|
| 55 s frozen, one uninterrupted task | ≈2,700 queries at ≈20–28 ms each, all synchronous |
| **Zero network traffic** during the freeze | The lists were downloaded earlier; the freeze is local computation |
| **Same time for 5- and 35-line invoices** (54.6 / 56.1 / 55.4 / 56.6 s) | The triggered work scales with the catalogue, not the invoice; the lines add at most 35 queries among 2,700 |
| Read-only invoice opens quickly (0.2–0.9 s) | Without the picker, opening runs ≈1 query per line: 5–35 queries × 28 ms = 0.14–0.98 s, matching the measurement |
| New purchase order at two-thirds of Edit (38 s) | Same mechanism with roughly 0.69× the query count: ≈1,860 versus ≈2,700 |
| 93% of the profile inside the client library, which re-sorts the stock list per query | There is no index; each "stock where material = X" re-sorts the whole list |
| Dashboard: 22.2 MB, 2.0 s blocked (9.0 s at 4×) | Four card components each pull the full invoice list (4 × 3.97 MB), plus transactions (3.5), purchase orders (1.4) and receipts (1.3) ≈ 22.1 MB; the four cards then aggregate client-side |
| Invoice list shows 10 rows but receives 12.2 MB | The screen subscribes to invoices, transactions, purchase orders, receipts, stock and materials — effectively the whole 11.7 MB database — and slices 10 rows in memory |
| Stock screen renders 1,213 rows and 19,600 DOM nodes | The screen materialises ≈1,211 material×location rows at ≈16 DOM nodes each |
| Subscriptions are never released | Every tab retains every list; every write is re-processed in every open tab |

### 1.3 Cost model and growth prediction

The freeze can be expressed in terms of the data:

```
T_freeze ≈ Q × c × S

Q  queries issued by one action          (Edit ≈ 2 × 1,346 ≈ 2,700)
S  rows in the local stock copy          (2,656, including used-up batches)
c  cost per row per query                (28 ms ÷ 2,656 ≈ 10.5 µs)
```

The model reproduces every observation: Edit ≈ 2,700 × 20–28 ms ≈ 55–75 s (measured 55 s); read-only opens ≈ lines × 28 ms (measured 0.2–0.9 s); purchase orders ≈ 0.69 × Edit (measured 38 s); and the freeze is flat across invoice sizes because the invoice does not appear in the formula.

**Growth.** Stock rows are never deleted and grow by ≈150 per month (goods-receipt lines). At the current pace, 12 months from now `S` ≈ 4,450, which predicts **≈1.7× the freeze (about 90 s on a fast laptop, minutes on an office PC)**. At 10× data, `S` = 26,560 and `Q` grows with the catalogue: **at least 10× — 9 minutes, up to about 2 hours** if the catalogue scales with volume. The current design has no ceiling; Section 4 shows that the redesign removes the dependence on total volume.

### 1.4 Limits of the evidence

The measurements describe behaviour, not source code. The per-screen query counts and the location of the sort are inferred; they can be confirmed as follows: (1) wrap the client library's query function with a counter — expect ≈2,700 calls on Edit, all of the form "stock where material = …"; (2) count comparator invocations to confirm a full sort of 2,656 rows per query; (3) read the four dashboard card components to confirm that each independently pulls the invoice list; (4) instrument subscription and unsubscription calls to confirm that nothing is ever released.

### 1.5 Two problems, not one

The freeze and the general slowness are different defects. The freeze is **one unbounded task**: 2,700 queries over an unindexed local copy. The general slowness is **data gravity**: screens download whole lists, retain them for the session, render thousands of DOM nodes, and recompute aggregates client-side — the dashboard is the clearest example at 22.2 MB for four cards. The first problem is fixed by moving queries to an indexed store; the second by bounding what each screen fetches. A spinner, a cache in front of the same reads, or moving the work to a Web Worker addresses neither: the cost remains and continues to grow with the data.

---

## 2. Design

### 2.1 Decision: keep the data model, add a server-side query engine

The design keeps the current database shape — the same JSON tree, with the same paths and record fields — and places a small application server in front of it with derived indexes. This choice is deliberate:

- **Migration is a copy, not a rewrite.** The export is imported byte-faithfully, so no value can be lost or reinterpreted during the transition.
- **The tree remains the system of record.** Every index is derived and can be rebuilt from the tree in about two seconds (`npm run reindex`), which is also the recovery path if any derived value is ever found wrong.
- **Queries stop scanning.** That alone removes the freeze, because the cost model's `S` term disappears from query time.

A fully normalised relational rewrite would also work; this design is smaller to build, preserves the vendor's record shapes for audits, and keeps the migration reversible.

The server is a single Node.js process with **SQLite in WAL mode** on the same machine: 11.7 MB today, five users, roughly 500 stock movements per month. A single-writer database with real transactions, FTS5 search and window functions covers the workload with no operational overhead, and the reviewer starts it with one command. The brief permits either architecture — with or without a server — and this one is justified by the two requirements that cannot be met client-side: **multi-record atomic writes** (stock must never go below zero when two users sell at once) and **payloads bounded by what a screen shows**.

### 2.2 Stored data, derived data, and responsibility for correctness

| Data | Where it lives | Kept correct by |
|---|---|---|
| Records (the JSON tree) | `documents` table | Every write passes through one helper (`lib/tree.js`) |
| Batch quantity remaining | `stock` index (stored) | Updated inside the save transaction, guarded by `WHERE quantity >= ?` |
| Invoices, lines, movements, batches, customers, vendors, POs, receipts | index tables (derived) | A single indexer function, invoked in the same transaction as the write |
| Material and invoice search | FTS5 mirrors (derived) | Database triggers, and a full `rebuild` on reindex |
| Dashboard totals, running balances, per-material stock | computed on demand | SQL aggregates over narrow indexed ranges (microseconds at this scale) |
| Number sequences, idempotency records | `meta`, `request_log` | Transactional |

The consequence is that a partially applied state is impossible: the tree and the indexes are written by the same code path inside the same SQLite transaction, so either everything commits or nothing does. "The invoice saved but the totals did not" cannot occur. If an index is ever suspected of being wrong, `npm run audit` compares indexes against the tree, and `npm run reindex` rebuilds all of them from the tree.

### 2.3 Read paths and round trips

| Screen | Returned by one request | Round trips |
|---|---|---|
| Dashboard | Five aggregates in a single response (outstanding, month sales/purchases/margin, low stock, awaiting delivery, six-month trend) | 1 |
| Invoice list | 25 rows via keyset cursor, plus a total count; sorting, filtering and search run server-side | 1 |
| Editor: material search | Up to 20 FTS5 matches with on-hand quantity | 1 per keystroke (debounced) |
| Editor: batches for a material | The material, its usable batches, and the last invoiced price | 1 |
| Save invoice | Document ids, totals, stock deltas | 1 |
| Stock levels | 25 material rows with quantity, value and batch count | 1 |
| Movement report | One material's movements with a running balance (SQL window function) | 1 |
| Command palette | Invoices and materials matching a term | 1 |

The costs of the primitives are explicit: **keyset pagination** (`(sort_value, id) < cursor`) makes page 500 cost the same as page 1; sorting and filtering use B-tree indexes; search is FTS5 with a bounded LIKE top-up only when the index returns fewer rows than the page needs; the running balance is computed with `SUM() OVER (ORDER BY date, id)` and never stored.

### 2.4 Write path: saving an invoice

Every stock-affecting operation is a single transaction, opened with `BEGIN IMMEDIATE` so writers serialise:

1. If the request carries a `request_id` that has been seen before, return the stored response (retry safety).
2. Resolve the customer and every line; verify that each batch belongs to its material and that quantities are positive; aggregate demand per batch.
3. Check availability per batch and fail with a 409 that carries the fresh numbers.
4. Insert the invoice document and its index rows.
5. For each line: decrement the batch with `UPDATE … SET quantity = quantity - ? WHERE batch_id = ? AND quantity >= ?`, require exactly one row to change, update the tree document, and append a movement carrying the invoice id and the batch id.
6. Store the idempotency record, commit, and only then broadcast the change.

Two salespeople selling the last units therefore serialise on the writer: the second transaction sees the committed quantity and receives a clean 409 with the current availability (verified live in Section 4.3). The browser is never trusted — the screen's state is only a display of server state.

### 2.5 Realtime updates and the dynamic event

After every commit the server broadcasts a thin Server-Sent Event (`stock_changed`, `invoice_saved`, `receipt_posted`, `data_changed`). Screens refetch only the slice the event concerns. The dynamic event required by the brief works as follows: a material holds 12 units across two batches; a colleague, signed in as a second account, sells 10; the open editor receives the event, refreshes those batches and shows 2 available without reloading; an attempt to sell stock that no longer exists is rejected by the server with a 409 and the fresh availability; the storekeeper then posts a 60-line receipt — 60 batches and 60 movements in one transaction — and the movement report shows the new running balance. No screen state is trusted: every save is re-validated server-side, and reconnecting clients refetch.

### 2.6 Migration from the export

The transform copies the export verbatim into the tree — no value is "cleaned" at the source of truth — and then builds the indexes. Every loose end in the data is handled explicitly and nothing is dropped:

- 4,637 sales movements whose document link reads `"new"` are re-linked by parsing the invoice number from their notes (4,584 resolve; the rest are flagged).
- The 5,211 invoice lines with empty ids receive surrogate ids (`invoice_id`, `line_no`).
- 22 movements that reference deleted materials are kept with a `legacy_item` field and reported.
- 39 vendors whose `id` field differs from their key keep the key as canonical, with the old id preserved as an alias.
- Quantities and prices stored as strings are coerced in the indexes only; the tree keeps its original values.
- Two storage-location paths are merged for lookups; `DOC-*` direct-delivery numbers are excluded from the invoice-number sequence.

Two further findings emerged while building and are handled in the same way:

- **Invoice lines' batch references are composite** (`materialId_batchId`). Stripping the material prefix resolves **4,684 of 4,717** references — the batch link existed all along.
- **Sales movements' cost fields actually contain the sale price**, not the stock cost. Margin is therefore computed from batch costs, which yields a real figure for the current month (17.6%) instead of the near-zero value the movement "costs" would imply.

Cutover is: import, run the audit, switch. The source system remains untouched, and a daily export can be re-imported if needed.

---

## 3. Build

`demo/` is the working prototype on the **full masked dataset** (17,062 records; all eight record counts from the brief verified: 7,761 movements, 2,869 invoices, 2,656 stock rows, 1,346 materials, and so on). It implements the four required surfaces — invoice list with paging, sorting and search; the editor's material picker with available stock and batch selection; saving invoices (atomic, idempotent, race-safe); and one aggregate view — and adds a stock-levels screen, a movement report, a command palette that searches invoices and stock, login and sign-up, and demo tools that load the dataset or generate coherent sample data.

```
npm install && npm run transform && npm start     # http://localhost:3000
npm test            # 38 end-to-end tests (isolated database, ~40 s)
npm run audit       # 15 invariant checks plus query plans
```

The transform script and the measurement script are part of the repository, as the brief requires. The dataset itself is not committed.

---

## 4. Measure

### 4.1 Method

`scripts/measure.mjs` drives real Chromium through Playwright, throttles the CPU to **4×** (the condition used in the brief), signs in, and records per screen: bytes and request counts from resource timing, the longest `longtask` entry, and wall time to usable. The figures below come from one run against the masked dataset (1×) and one against the grown database (10×), on the same machine. The harness runs headless with software rendering, which is a harsher environment than a GPU browser; Section 4.4 discusses the two targets that this affects.

### 4.2 The 10× dataset

`scripts/grow10x.mjs` builds `data/erp10x.sqlite` through the **same write paths** the application uses — receipts create batches and movements, invoices sell from real batches — preserving the observed distributions (lines per document, the share of exhausted batches, FIFO ordering) at approximately ten times the volume:

| | masked dataset (1×) | grown database (10×) | factor |
|---|---|---|---|
| Invoices | 2,869 | 24,000 | ×8.4 |
| Invoice lines | 5,211 | 47,878 | ×9.2 |
| Movements | 7,761 | 77,998 | **×10.0** |
| Stock batches | 2,656 | 30,055 | **×11.3** |
| Materials | 1,346 | 3,000 | ×2.2 |
| Documents / file size | 17,062 / 11.7 MB | 149,154 / 254 MB | ×8.7 |

Generation took 469 seconds, and the invariant audit passes **15/15 with no warnings** on the grown database: stock is never negative, batches reconcile with movements for every material, and both search indexes are intact.

**How realistic is this?** The volumes are synthetic but the tempo is real: the business generates roughly 500 movements and 150 stock rows per month, so 10× today's rows corresponds to some four to five years of growth. The generator deliberately omits legacy noise (text quantities, unlinked movements) because new writes are typed and linked by design — a favourable assumption, stated here rather than hidden.

### 4.3 Results

Payloads and server latency were identical across repeat runs; task figures vary by roughly ±30% in the throttled headless environment, so representative runs are shown.

**Transfers — bytes stay proportional to the screen at 10×:**

| Screen | Round trips | 1× bytes | 10× bytes | ratio |
|---|---|---|---|---|
| Dashboard (all cards, one request) | 1 | 5.2 KB | 4.8 KB | 0.9 |
| Invoice list (25 rows) | 1 | 6.0 KB | 5.9 KB | 1.0 |
| Editor open (customer list and form) | 1 | 16.6 KB | 30.7 KB | 1.9 |
| Material search (typed) | 1 | 3.1 KB | 0.5 KB | 0.2 |
| Save invoice (write plus invoice view) | 6 | 20.8 KB | 41.7 KB | 2.0 |
| Stock levels (25 rows) | 1 | 4.3 KB | 4.9 KB | 1.1 |
| Palette search (invoices and stock) | 1 | 4.0 KB | 3.8 KB | 0.9 |

For scale: the previous system transferred **12.2 MB** to display a ten-row invoice list and **22.2 MB** for the dashboard. Server-side latency is **2–5 ms at both 1× and 10×**.

**Longest main-thread task (ms) and time to usable (ms), at 4× CPU:**

| Screen | task 1× | task 10× | wall 1× | wall 10× |
|---|---|---|---|---|
| Dashboard, cold | 381 | 317 | 2,234 | 3,535 |
| Invoice list | 0 | 0 | 406 | 324 |
| Editor open | 249 | 321 | 406 | 446 |
| Material search | 0 | 0 | 421 | 651 |
| Save invoice | 109 | 130 | 1,097 | 1,305 |
| Stock levels | 0 | 0 | 275 | 437 |
| Palette search | 244 | 239 | 655 | 1,866 |

**Against the targets in the brief:**

| Target | Result |
|---|---|
| No main-thread task longer than 200 ms at 4× | Every data interaction finishes in 0–130 ms. First paints exceed the target in this environment (239–381 ms); Section 4.4 reports the details and the reason |
| Editor and usable material search in under 1 s | Editor usable in 406 ms at 4× (446 ms at 10×); search answers in about 450 ms including the debounce |
| A list screen transfers data in proportion to what is on screen | 6.0 KB per 25 rows, independent of list size; the 10× ratio is 1.0 |
| At 10× data, no more than 2× worse | Bytes ≤2.0×, tasks ≤1.3×, server latency unchanged, payloads fixed-size — cost no longer scales with total data |
| Stock never negative | Checked by the audit; a live race of two simultaneous 10-unit sales against 12 units ends with one 201, one 409 carrying the fresh availability, and stock at exactly 2 |
| Derived values never silently wrong | 15/15 audit checks pass on sample data and on the 10× database (index versus tree, totals versus lines, balances, per-material reconciliation, FTS integrity); reindex rebuilds from the tree in about two seconds |

**Correctness evidence beyond the numbers:** 38 Playwright end-to-end tests (authentication, paging, saving with idempotency and oversell rejection, receipts, date filters, palette, live SSE updates, a navigation-versus-refresh race regression, and a full click-through with zero console errors); the two-tab dynamic-event demonstration; and the audit runs above.

### 4.4 Targets not met, reported plainly

**The 200 ms target is not met on cold first paint in the measurement environment.** The harness runs headless Chromium with software rendering at 4× CPU; full-viewport first paints measure 239–381 ms there. These tasks contain no data work: the server answers in 2–5 ms and payloads are at most 42 KB. The mechanism was isolated by measurement rather than assumed — with `prefers-reduced-motion`, which the application honours, the dashboard's first-paint task falls from about 880 ms to 286 ms; preloading the local fonts, removing the topbar's backdrop filter and shortening the entrance animation reduced the cold dashboard task by roughly 45%. The remaining ~250 ms is the software rasteriser's cost for a full-page repaint at 4× throttle, not work proportional to data: the same figures stay flat at 10× (317 ms and 239 ms), and every data interaction is 0–130 ms. I have kept the brief's target for data interactions — the context in which the old system produced its 55-second task — and report the first-paint figures as measured.

**One further anomaly, reported as observed:** the palette's wall time at 10× varied between 0.7 s and 2.4 s across runs while its longest task remained 239 ms and the server answered in 3 ms. This is scheduling noise in the throttled headless environment, not data-dependent work.

---

## 5. Trade-offs and limitations

**What this design optimises for, and what it gives up.** The priorities are correctness under concurrency, payloads bounded by the screen, and a system a reviewer can run with one command. The costs of that choice are stated openly: SQLite is single-writer, which is right for five users and roughly 500 movements a month but is a ceiling at much higher write concurrency (the same schema moves to PostgreSQL); and the vendor's zero-maintenance realtime layer is replaced by a server that must be operated. The failure modes are also narrower than before: subscriptions that were never released are gone, but invalidation and SSE plumbing are now mine, deliberately kept advisory so that correctness never depends on a delivered event.

**What is not handled.**

- Sign-up is open; a production deployment would use invitations and role-based restrictions per route.
- The profit report is not implemented. The brief's minimum is four screens and they are all present; the data model already supports the report, since margin is computed from batch costs on the dashboard.
- Legacy history is best-effort and labelled as such: 53 note-based invoice links and 33 batch references remain unresolved, and 22 movements reference deleted materials. They are visible as gaps rather than guessed.
- The realtime hub is a single process; multiple instances would need a shared pub/sub channel.
- The measurement environment (headless, software rendering) is harsher than a normal browser; the two affected figures are reported above rather than adjusted away.
