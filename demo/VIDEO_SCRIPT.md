# VIDEO SCRIPT — “The ERP that freezes” (≈8 minutes)

The brief requires the video to: **(a)** explain the problem, the domain and the
diagnosis; **(b)** walk through the architecture and the decisions; **(c)** show the
working system on the full dataset, the **dynamic event**, and before-and-after
numbers; **(d)** say what it does not handle. This script does exactly those, in
order. Narration is written to be read aloud; bold lines are the ones an evaluator
should remember.

---

## Before recording (checklist)

1. **Data state:** Demo tools → *Load masked dataset* (17,062 records). Hard-refresh
   the tab (Ctrl+F5) so animations/counters start clean.
2. **Accounts:** logged in as the admin. Second tab (or second window) signed in as
   the second account for the “colleague” sale.
3. **Windows ready:** tab 1 = app; tab 2 = repo README (for the end); tab 3 = a
   terminal in `demo/`.
4. Zoom 100%, 1080p, notifications off, quiet room. Say the scene number before
   each take if you record in pieces.
5. One dry run of the dynamic event (Demo tools steps 1–2) so the timing is known —
   then **wipe/reload the dataset** to reset stock before the real take.

---

## Scene 1 — Intro (0:00–0:25)

*On screen: you, then the app with the frozen-looking editor.*

> “This is an ERP whose browser tab locks for **fifty-five seconds** every time
> someone opens an invoice. No network activity while it happens — and the same
> fifty-five seconds whether the invoice has five lines or thirty-five. I diagnosed
> why, redesigned how the system stores and reads its data, built a working system
> on the full production dataset, and measured it. **Here is the whole story.**”

## Scene 2 — The domain, quickly (0:25–1:05)

*On screen: the dataset table from the brief (or the stock screen).*

> “It’s a trading company: stock, purchasing, sales, about five users. Stock is kept
> **per batch** — one row per goods receipt per material — because the same item is
> bought at different prices over time. Selling from a batch is what makes real
> costs and real margin possible; flatten that and your reports lie. The people hurt
> by the freeze are the sales staff, who lose about a minute on every click, and the
> storekeeper, who can’t check stock while a customer waits.”

## Scene 3 — Diagnosis (1:05–2:30)

*On screen: the evidence numbers from the brief; then a simple sketch: browser →
local copy → “2,700 queries” → one long task.*

> “The freeze is **one long task on the browser’s main thread**. The app keeps a
> local copy of whole lists and answers every question itself — there are no
> indexes, no server queries. Opening the invoice editor runs about **2,700
> queries**, because it prefetches stock for the entire catalogue of 1,346
> materials. Each query scans and re-sorts all **2,656 stock rows**, because
> nothing is indexed. That’s over seven million row-touches in one synchronous
> task — the measured fifty-five seconds, and 93% of the profile inside the
> database client library.”
>
> “The cost model is `T ≈ Q × c × S`: queries, times a fixed per-row cost, times the
> size of the stock list. It explains every awkward fact: **zero network** because
> it’s all local compute; **same time for any invoice** because the work scales with
> the catalogue, not the invoice; **purchase order at two-thirds** because its
> picker does about two-thirds of the queries. And it predicts: at today’s growth
> the freeze is **1.7× worse in a year**, and at 10× data it’s at least ten times
> worse — the design has no ceiling.”
>
> “Two things are separate here: the **freeze** is one unbounded task; the **general
> slowness** is data gravity — every screen downloads whole lists, like 22
> megabytes to draw a dashboard. Different problems, different fixes. And a
> spinner, a cache, or a web worker would only hide the cost — it would still grow
> with the data.”

## Scene 4 — Architecture (2:30–4:00)

*On screen: repo tree in the terminal → `demo/lib/schema.sql` → briefly
`lib/indexer.js` → browser at `/api/tree?path=sales/invoices/<id>`.*

> “The design is: **keep the JSON tree, add the query engine next to it.** The
> export is copied byte-faithfully — same paths, same fields — so migration is a
> copy, not a rewrite, and nothing can be lost in translation. On top of the tree I
> built **derived indexes** — invoices, lines, batches, movements, customers,
> receipts — plus FTS5 for search. Every index is disposable: one command rebuilds
> all of them from the tree, which is my answer to ‘a derived value is wrong — how
> do you detect and rebuild it’.”
>
> “The hard part isn’t making one screen fast; it’s deciding **what the system knows
> in advance** and what it works out on demand. Batch quantities are facts — they
> live in the stock table and are updated inside the same transaction as every
> sale. Dashboard totals, running balances, per-material stock are summaries —
> computed on demand from narrow indexed ranges, so they can never silently drift.
> And the tree and the indexes are written by the same code path inside the same
> **SQLite transaction**, so they can’t disagree.”
>
> “Saving an invoice is one transaction: resolve every line, check availability,
> decrement each batch with a `quantity >= ?` guard, append one movement per line
> with the invoice and batch ids, and write an idempotency record so a retry can’t
> double-post. Two people selling the last unit serialize — the second one gets a
> clean 409 with fresh numbers. Realtime is just thin events over SSE after commit:
> open screens refresh only what changed. The ‘current database’ stays; the query
> engine moves to the server. That’s the keep-or-replace answer, and it’s justified
> by the measurements you’ll see in a minute.”

## Scene 5 — The working system (4:00–5:20)

*On screen: Demo tools → Load masked dataset → dashboard → invoice list → editor
→ save. Point at the metrics chip in the header.*

> “This is the prototype on the **full masked dataset** — 17,000 records, all eight
> record counts verified against the brief. The dashboard is **one request** and a
> few kilobytes. The invoice list pages, sorts and searches in SQL; the payload is
> only the rows on screen — about six kilobytes for twenty-five rows, where the old
> system pulled twelve megabytes for ten.”
>
> *(Type in the editor)* “The material picker searches by name or model with
> indexed full-text search, and each line shows the **batches** with their real
> unit costs — sell from the oldest receipt, or any batch you choose. The totals
> update as you type, and the save is that one transaction I described.”
>
> *(Point at the header chip)* “These are live, in this tab: **longest main-thread
> task, round trips, and bytes** — measured in the browser, not claimed.”

## Scene 6 — The dynamic event (5:20–6:40)

*On screen: two windows. Window A has an invoice open in the editor.*

> “The scenario from the brief: a material with **twelve units across two
> batches**. Setup… and I open the editor, which shows twelve available.”
>
> *(In window B, as the colleague)* “While I’m typing, my colleague sells **ten
> of them**… and watch window A: **without a reload**, the editor reports the
> stock change, refreshes the affected batches, and drops to two available — the
> emptied batch is disabled.”
>
> *(Try to sell twelve in window A)* “If I try to sell stock that’s gone, the
> server rejects it with a **409** and the fresh availability. The screen is never
> trusted — every save re-checks in the transaction.”
>
> *(Demo tools → step 3)* “The storekeeper now posts a **receipt with sixty
> lines** — sixty new batches and sixty movements in one transaction — and the
> movement report shows every movement in order with its running balance.”

## Scene 7 — Numbers and proof (6:40–7:30)

*On screen: the measurements table from `DIAGNOSIS.md` Section 4; then the terminal:
`npm test` summary, `npm run audit`.*

> “Before and after, at the brief’s own condition — **four-times CPU throttle**:
> **every interaction** completes with a longest main-thread task of **zero to a
> hundred and thirty milliseconds**, and the server answers in **two to five
> milliseconds** at both sizes. The invoice list moves about **six kilobytes** in
> **one** round trip, where the old app moved **twelve megabytes** for ten rows;
> the whole dashboard is one request of about **five kilobytes**. Cold first
> paints in my harness’s software renderer measure 240 to 380 milliseconds — I
> report that plainly in the document, with the mechanism: it’s animation and
> paint, not data work.”
>
> “The brief also asks for the **same numbers at ten-times volume**. I generated
> that by running the same write paths — real receipts creating real batches, real
> invoices selling from them — so the invariants still hold; the document says how,
> and what about the growth is and isn’t realistic. **At ten times the data, the
> task numbers and payloads do not grow** — that is the point of the redesign.”
>
> *(Terminal)* “And the correctness side: **thirty-eight end-to-end tests**, an
> **invariant audit** — fifteen checks, passing on the sample data *and* on the
> ten-times database — where stock can never be negative, batches reconcile with
> movements, and the index agrees with the tree; plus a race test where two
> simultaneous sales of the last units end with one 201, one 409, and stock never
> below zero.”

## Scene 8 — What it does not handle, and close (7:30–8:00)

*On screen: the repo README.*

> “What it does **not** handle: signup is open — a real deployment would invite
> users and enforce roles; the profit-report screen isn’t built, though the
> batch-cost data is there; fifty-three legacy note-links and thirty-three batch
> references stay unresolved — flagged, not guessed; the realtime hub is one
> process, so multi-instance needs pub/sub; and SQLite is a single writer, which
> is perfect for five users and the wrong choice at a thousand.”
>
> “The fix, in one line: **move the computing to where the data lives, and only
> send the browser what it shows.** Everything else in this repo follows from
> that.”

---

## 3-minute compressed version (if asked for a short cut)

1. **0:00–0:30 Problem + diagnosis:** 55 s freeze, zero network, flat across
   invoice sizes; one long task; ~2,700 unindexed queries × 2,656 rows; `T ≈ Q×c×S`.
2. **0:30–1:10 Design:** keep the tree; server + SQLite; derived indexes; one
   transaction for saves with a stock guard; thin SSE.
3. **1:10–2:30 Demo:** dataset loaded; list/editor/save; dynamic event (colleague
   sells 10, editor reacts, 409 on oversell, 60-line receipt).
4. **2:30–3:00 Numbers + limits:** 1× vs 10× table; audit + 37 tests; what it does
   not handle.

## After recording

- Upload as **unlisted**; paste the link into `DIAGNOSIS.md` (header) and the
  submission email.
- Email to **info@techcoracorp.com** before Wed 14 Oct, 11:59 PM IST, containing:
  repo link (make the repo **public** or invite them) + video link.
- Sanity-check the video: no notification popups, dataset path not shown, no
  personal data on screen.
