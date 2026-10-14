# “The ERP that freezes” — Full diagnosis, solution design & student guide

**Source prompt (scraped in full):** `https://eww.techcora.in/api/pages/public/kYoxq2ri5N4Y-w1hpWdLZbh0qjtTkwxKQ95Txia9IZk`
**Raw scrape:** `scrape/page.html`, clean text `scrape/page.txt`
**Dataset verified against:** `dataset/cora-erp-masked.json` (11,696,988 bytes)
**Verification scripts & results:** `scrape/verify.mjs`, `scrape/check2–4.mjs`, `scrape/verification.json`
**Deadline:** Wednesday, 14 October 2026, 11:59 PM IST — submit to `info@techcoracorp.com` (repo + demo video, `DIAGNOSIS.md` inside the repo)

---

## Table of contents

1. [What the challenge actually asks (prompt digested line-by-line)](#1-what-the-challenge-actually-asks)
2. [How you will be judged — and how this plan answers each criterion](#2-how-you-will-be-judged)
3. [Current problems — the complete, verified summary](#3-current-problems)
4. [The cost model (formula in terms of the data) + growth predictions](#4-the-cost-model)
5. [Why this solution (rationale, rejected alternatives)](#5-why-this-solution)
6. [The proposed solution — architecture, data model, read/write paths](#6-the-proposed-solution)
7. [Consistency, derived data, failures and the dynamic event](#7-consistency-derived-data-failures--the-dynamic-event)
8. [Migration from the export, loose ends included](#8-migration)
9. [How to proceed — 36-hour execution plan, repo layout, measurements, demo](#9-how-to-proceed)
10. [Student guide — every concept explained simply](#10-student-guide)
11. [Conflict/edge-case → design answer matrix](#11-edge-cases--design-answers)
12. [Trade-offs and limitations (say these out loud)](#12-trade-offs-and-limitations)
13. [Appendix A — Verified dataset facts](#appendix-a--verified-dataset-facts)
14. [Appendix B — Submission checklist mapping](#appendix-b--submission-checklist)

---

## 1. What the challenge actually asks

Every line of the site, turned into requirements:

### Scenario (facts you are given)

- A trading company runs stock, purchasing and sales on a web ERP; **the browser tab hangs while people work in it**.
- The hang is **reproducible**, happens with **no network activity**, and lasts **the same time for a 5-line invoice as for a 35-line invoice**.
- Architecture as-is:
  - **SPA running entirely in the browser** — no application server between browser and database.
  - **Hosted realtime JSON-tree database**, read/written directly by the browser through the vendor’s client library, which keeps a **local in-memory copy** of whatever it is subscribed to and **pushes changes to every open tab**.
  - **No joins, no aggregates, no server-side search** — only filter-one-field + limit. Everything else (sort, search, totals, joins) happens **in the browser**.
  - **Each screen subscribes to whole lists, forever**. “Page 2, sorted by date” = download everything, slice in memory.
  - **Records copy data from each other**: invoice embeds customer + line items; stock = one row per goods receipt per material (a **batch**).
  - **Five user accounts**, several tabs open at once.

### Measured evidence (the “awkward facts” you must explain)

| # | Measurement | Value |
|---|---|---|
| 1 | Tab frozen after clicking **Edit** on an invoice | **55 s**, one uninterrupted task on the main thread |
| 2 | Network traffic during that freeze | **0 MB** (≈10 KB) |
| 3 | **New purchase order**, 4× slower CPU | **2 min 44 s** (38 s on fast laptop) |
| 4 | Dashboard cold open | **22.2 MB** received; whole DB is **11.7 MB** |
| 5 | Freeze by invoice size | 5 lines: **54.6 s** · 10: **56.1** · 20: **55.4** · 35: **56.6** |
| 6 | Same invoices opened **read-only** | **0.2–0.9 s** blocked |
| 7 | CPU profile | **93%** inside the client library answering **local** queries; **re-sorts the stock list per query** |
| 8 | Query count on Edit | **≈2,700** queries × **≈28 ms**, all of the form “stock rows where material = X” |
| 9 | Screen downloads (cold) | Dashboard 22.2 · Invoice list **12.2** · Reports 11.1 · Goods receipts 7.5 · POs 6.2 · Materials 4.9 · Stock levels 4.9 · Customers 0.05 MB |
| 10 | Invoice list shows **10 rows**, received **12.2 MB** | |
| 11 | Dashboard | asks the **full invoice list 4×**, blocks **2.0 s** (9.0 s at 4×) computing 4 cards |
| 12 | Stock levels screen | renders **1,213 rows at once = 19,600 DOM nodes** |
| 13 | Subscriptions | **never released**; every write re-processed in every open tab |

### Dataset facts (verified by me — see Appendix A)

18 claims in the “Things you will find in it” section; **all 18 check out** on the actual file, and my verification surfaced **six additional data defects** the page doesn’t mention. Highlights: 7,761 movements / 2,869 invoices (5,211 lines) / 2,656 stock rows of which **1,558 have qty 0** / 1,346 materials of which **1,002 keyed by 13-digit timestamps** / **88.5%** of sales movements don’t point at their invoice (4,637 of 5,240; invoice number only inside a note) / qty is a **string** in 3,241 movements and 3,220 invoice lines / one material has **137 stock rows** and another **525 movements**.

### Your task (4 numbered deliverables)

1. **Diagnose** — explain why the tab freezes, account for *every* odd fact; write the cost as a **formula in terms of the data**; predict at 12 months and 10×; **separate the one cause of the hang from general slowness**; state what you **cannot know without the code** and how you’d confirm it.
2. **Design** — data model + read paths for all 8 screens (dashboard … profit report); where **derived data** lives and who keeps it correct, including partial failure; whether to **keep or replace** the database and whether a server sits in the middle (either answer OK, unjustified is not); a **migration** the business can survive.
3. **Build** — working prototype on the **full masked dataset**: invoice list (page/sort/search), editor material picker with available stock + batches, **saving an invoice**, and **one aggregate view**. Any stack; plain UI fine; include the **transform script**.
4. **Measure** — per screen: **bytes, round trips, longest main-thread task** on **4× throttled CPU**, at **1× and 10× data**; say how the 10× data was generated and whether growth is realistic; report misses plainly.

### The dynamic event (must be demoed live)

A salesperson has an invoice open; a material has **12 units across two batches**. While they type:
- a colleague sells **10 of the 12**;
- the storekeeper posts a receipt of **60 lines** → **60 new batches + 60 movements** in one go.

Requirements: keep the open screen **responsive and correct without reloading everything**; **never let the salesperson sell stock that is gone**; afterwards **stock, movements and derived totals agree**.

### Targets (“What good looks like”)

- No main-thread task > **200 ms** at 4× on any screen you built.
- Editor + usable material search **< 1 s**.
- A list screen transfers data **in proportion to what is on screen**, not list size.
- At **10× data**, numbers get **no more than 2× worse**.
- **Stock never negative. Derived values never silently wrong.**
- (You may argue a target is wrong — with reasoning.)

---

## 2. How you will be judged

Verbatim from the site, with the concrete thing to have ready.

### 2.1 “What we are looking for” (the meta-rules)

| Site says | What it means for you |
|---|---|
| “Not a coding contest. Writing more code is not the goal.” | A small, well-understood prototype beats a large half-understood one. Keep the UI plain. |
| “AI tools can generate a lot… the goal is to learn deeply… You will be asked to explain every part.” | Use AI to build, but only ship what you can defend line-by-line. In interviews you will be taken through the project. |
| The 5 lens: domain understanding · clarity of explanation · architecture reasoning · *why* every decision · limits of your solution | Your `DIAGNOSIS.md` and demo must hit all five explicitly. |

### 2.2 The six judging criteria → where this plan answers them

| # | Criterion (site) | Must contain | Where in this report |
|---|---|---|---|
| 01 | **Problem & domain understanding** — why batches; what breaks if flattened; who is hurt by the freeze; real constraints vs habits | Batch/lot costing explanation; daily-use constraints; identify who waits 55 s | Section 3.1, Section 10.10 (batches), Section 12 |
| 02 | **Diagnosis** — accounts for **every** measurement; cost model stated in data terms and *predicts*; claims checked against dataset | The “awkward fact → explanation” table; the `T ≈ Q × c × S` formula; Appendix A verification | Section 3.2–3.5, Section 4, Appendix A |
| 03 | **Architecture** — entities, stored vs derived; read/write path per screen; component responsibilities and why this split | Tables + endpoint per screen; what is stored vs computed; SQLite vs RTDB justification | Section 6, Section 7 |
| 04 | **Technical reasoning** — why this model/indexes/DB; what may be briefly stale and what never is; how pagination/sort/search work and their cost | Index list with cost; consistency budget table; keyset pagination math | Section 6.2–6.5, Section 7.1, Section 10.4–10.8 |
| 05 | **Failure & edge cases** — last-unit race; save ok but derived total fails; drop mid-save + retry; record that doesn’t fit; wrong derived value detection/rebuild | Edge-case matrix with designed answers | Section 7, Section 11 |
| 06 | **Trade-offs & demo** — what you optimized/gave up; what gets *harder*; working system + dynamic event + numbers on screen | Honest limitations; SSE complexity; offline loss; demo storyboard | Section 12, Section 9.4 |

### 2.3 The “Before you hit send” checklist (0 of 8 done)

1. Diagnosis explains the freeze **and each odd measurement** → Section 3, Section 4.
2. Cost written as **a formula** and used to **predict growth** → Section 4.
3. Prototype runs on the **full masked dataset** → Section 9 plan (build next).
4. **Dynamic event** handled while system runs → Section 7.4, Section 9.4.
5. Measured **bytes, round trips, longest task** at **1× and 10×** → Section 9.3.
6. `README` + `DIAGNOSIS.md` in repo; **dataset not committed** → Section 9.2.
7. Can explain **failures, trade-offs, limitations** → Section 11, Section 12.
8. Emailed before **Wed 14 Oct, 11:59 PM IST**.

---

## 3. Current problems

### 3.1 How it is built and why it behaves badly (mechanism in one paragraph)

The app is a **thin client doing database work**. The realtime client library keeps **a full local replica** of every list the session ever subscribed to. The vendor API can only filter on one field and limit; there are **no indexes** and **no server-side compute**. So any question like “sort invoices by date”, “search material by name”, “stock rows for material X”, “sum of outstanding balances” is executed **by scanning/re-sorting the local copy on the main thread**, once per call, and the result is thrown away after the call. The main thread is where the event loop, rendering and all JS live; while it is busy, **the tab is frozen** — no clicks, no paint, no scroll. Subscriptions are never released, so the tab gets fatter all day, and every write by any user is pushed into every tab and re-processed there.

Three distinct problem families follow. Keep them separate in your diagnosis — the challenge explicitly asks you to.

- **The one cause of the hang** = *unbounded work in one task*: a click triggers thousands of queries, each internally costing O(all stock rows); the work is proportional to **catalogue × stock size**, not to what the user sees.
- **General slowness** = *data gravity*: screens download whole lists (often ≥ the whole DB), hold them forever, render thousands of DOM nodes.
- **Correctness debt** = *data quality + races*: mixed types, broken links, no batch traceability on movements, no atomic multi-record writes, no reconciliation of derived values.

### 3.2 Diagnosing the freeze — each awkward fact, explained

**Fact 1 — 55 s frozen, one uninterrupted task.**
A JS task must finish before the browser can paint or handle input. A single click queues one long task that runs ~55 s of synchronous library work. Everything waiting behind it (clicks, hover, paint) is stuck → “frozen”, not “slow”. On a 4× throttled CPU the same task takes ≈4× (consistent with “New purchase order” going 38 s → 2 min 44 s ≈ 4.3×; the edit screen’s numbers would similarly balloon if profiled throttled).

**Fact 2 — 0 MB network during the freeze.**
The lists were already downloaded earlier (cold-load phase). The freeze is **pure local compute**: the library re-reads its in-memory copy and re-sorts it per query. Confirms the cost is in the client library, matching Fact 7 (93%).

**Fact 3 — same time for 5-line and 35-line invoices.**
If the cost were about the invoice, it would scale with lines (×7 from 5 to 35). It doesn’t (54.6→56.6 s, +3.7%). So the triggering work is **independent of the invoice contents**: something enumerates the **entire catalogue**, not the invoice. The catalogue is 1,346 materials; **2 × 1,346 = 2,692 ≈ the “≈2,700 queries”** measured. Mechanism: the editor builds the material picker and, per material, asks “stock rows where material = X” — one query to compute available stock, one to list batches (both plausible) — before any line exists. Invoice lines merely add a rounding error on top (5–35 more queries among 2,700 → invisible). **Read-only open has no picker**, so it runs ≈1 query per line: 5–35 × 28 ms ≈ **0.14–0.98 s**, matching the measured **0.2–0.9 s**. This is the single strongest quantitative confirmation of the whole diagnosis.

**Fact 4 — New purchase order takes two-thirds as long (38 s vs 55 s).**
Same mechanism, cheaper variant: the PO screen’s picker does ~0.69× the editor’s query-work. (E.g. ≈1 query/material instead of 2 — 38/55 ≈ 0.69 ≈ 1,860/2,700 queries.) Note 2 min 44 s vs 55 s at 4×: both scale with CPU. Nothing here downloads; same local sort storm.

**Fact 5 — 93% of time inside the client library, and it re-sorts the stock list per query.**
The library has no index for “stock where material = X”, so it scans/sorts all **2,656** stock rows per query. Cost per query ≈ 28 ms → **≈10.5 µs per stock row per query**. Total work on Edit ≈ 2,700 × 2,656 ≈ **7.2 million row-touches**, ≈55–75 s of CPU. That is the hang, arithmetically.

**Fact 6 — Dashboard 22.2 MB and 2 s (9 s at 4×).**
Decomposition (my checks): 4 × invoices (4×3.97 = 15.9 MB) + transactions 3.5 + POs 1.4 + receipts 1.3 ≈ **22.1 MB** ✓. Each of the four cards asks for the full invoice list independently (no shared snapshot). Then four aggregates are computed client-side over 2,869 invoices + 5,211 embedded lines + linked movements: 2 s fast / 9 s throttled, most of it sorting/filtering the same data four times.

**Fact 7 — Invoice list: 10 rows shown, 12.2 MB received.**
12.2 MB ≈ the **entire database** (11.7 MB) + overhead: the screen subscribes to invoices (3.97) + transactions (3.49) + POs (1.38) + receipts (1.27) + stock (1.15) + materials (0.36) + customers (0.05) ≈ 11.7 MB, then slices 10 rows in memory. (Other screens decompose similarly: Materials 4.9 ≈ materials+stock+transactions; Stock 4.9 ≈ stock+transactions+materials; Reports 11.1 ≈ everything. Customers 0.05 shows what “download one small list” looks like when done right.)

**Fact 8 — Stock levels: 1,213 rows → 19,600 DOM nodes.**
The screen materializes the stock table without virtualization: ~16 DOM nodes per row (my count of distinct material×location pairs today: **1,211** — i.e., it groups 2,656 batch rows into ≈1,213 display rows). 16×1,213 ≈ 19.4k nodes ✓. DOM creation + layout for 19.6k nodes is a multi-hundred-ms to seconds task by itself — a second, independent freeze source.

**Fact 9 — Subscriptions never released; writes echo into every tab.**
Memory grows all session; every remote write triggers push processing per tab. With 5 users typing, everyone pays everyone else’s traffic — the “realtime” became a fan-out of whole lists.

### 3.3 General slowness — the second, different problem

Even if you **fix the freeze** (make each query O(1) via indexes), the app would still be slow to open: it downloads megabytes to show 10 rows, holds ~the DB in memory, renders thousands of nodes, and recomputes aggregates 4×. The fix for *this* family is **architecture** — bounded payloads, projections, server aggregates, virtualization, subscription lifecycle — not micro-optimization. You must say this explicitly: **same root (compute in the wrong place), different fixes**.

### 3.4 Correctness debt — what I found in the data (all verified)

| # | Defect | Verified numbers | Why it matters |
|---|---|---|---|
| 1 | Used-up batches never deleted | **1,558 / 2,656** stock rows qty 0; worst material **137 rows** | Every scan/sort pays for dead rows; pickers list noise |
| 2 | Sales movements don’t point at their invoice | **4,637 / 5,240** have `relatedDocumentId:"new"`; all 4,637 carry the invoice number in a note; **4,584 resolve**, **53 don’t** | Can’t join movement→invoice reliably → no trustworthy profit/movement reports today |
| 3 | No batch on the movement | **1,670 / 5,240** sales notes literally say “Batch: No Batch ID”; remainder inconsistently formatted | Movements can’t be costed. The invoice line does hold a batch hint — `selectedBatchId` — but it is **composite** (`materialId_batchId`); stripping the material prefix resolves **4,684 of 4,717** refs (only 33 truly dangle). Line `id`s are **empty on all 5,211 lines** |
| 4 | Mixed types | qty string in **3,241** movements + **3,220** invoice lines; `unitPrice` string in **493** lines; `costPerUnit` string **514** | Compare/sort/sum bugs; “2” vs “10” string-sorts wrong; CSV-style artifacts |
| 5 | Three id styles | 1,002 materials keyed by **13-digit timestamp**, 344 by push-id; invoices/POs/receipts by UUID | Joins need type-safe keys; ordering assumptions break |
| 6 | Dangling references | **22** movements → deleted materials; **8/22** stock adjustments’ `transactionId` doesn’t resolve; **317** movements labelled `purchase_order` whose ids actually match **receipts (313)**; adjustment **direction** must be read from the linked adjustment (14/22 resolve) | Silent null-joins in reports; unsigned adjustments |
| 7 | Vendor `id` ≠ key | **39 / 59** vendors | Whichever you trust, pick and record the other as legacy alias |
| 8 | Storage locations in two paths | `inventory/storageLocations` (2) + `inventory/storage_locations` (1); locations also referenced as free text (`DEFAULT-LOCATION`, ids) | Location reporting inconsistent |
| 9 | UI state persisted inside business records | **4,693 / 5,211** invoice lines carry `selectedBatchId`; **4,207** carry `availableStock`+`isValid`; `_originalStorageLocation`/`_originalUnit` on all, empty | Records contain client-side scratch data → bigger payloads, confusing audits |
| 10 | Snapshot drift | only **3** invoices’ embedded customer ≠ master record (page says “a few” ✓) | Rare but proves copying is unsafe long-term |
| 10b | **Movement cost fields hold the sale price** | `sum(movement.total_cost) == invoice.total` for **2,789 of 2,853** resolvable documents | Legacy margin computed from movements looks like ~100%; true margin must be derived from **batch costs** (this month: 17.6%, 100% cost coverage) |
| 11 | Skew | 64.9% of invoices have 1 line (max **100**); material movement counts: median **2**, max **525** (963 materials with movements) | Averages lie; design and tests must use the tail |
| 12 | Users | ids **1,3,4,6,7** + `system` (= “five user accounts” ✓) | Simple multi-user scale; assume a handful, keep audit columns |
| 13 | Invoice numbering formats | **341** plain (e.g. `40027`), **2,521** `INV-` prefixed, 7 other | Number search must accept both forms |

### 3.5 What you cannot know without the code (and how to confirm)

The measurements describe *behaviour*. State these hypotheses as **falsifiable claims** and list the instrumentation:

1. **“The editor prefetches stock for the whole catalogue (≈2×1,346 queries).”** Confirm: wrap the library’s query function with a counter, log call sites; re-run Edit; expect ≈2,700, all `stock where material=`. Altnative if count differs: log per-material query triggers in the picker code path.
2. **“Each query scans/sorts all 2,656 rows in the library.”** Confirm: CPU profile call tree — look for sort/compare frames under query calls; patch the comparator to count invocations (~2,656·log₂2,656 ≈ 30k compares/query).
3. **“The freeze is a single long task, no awaits.”** Confirm: Performance profile → one long yellow block; `PerformanceObserver` longtask entries report ≈55 s duration.
4. **“Dashboard pulls the invoice list 4× (once per card).”** Confirm: Network waterfall on cold dashboard — 4 large invoice payloads (or 1 payload + 4 client recomputations — distinguishable by bytes); code-reading of the 4 card components.
5. **“Subscriptions are never released.”** Confirm: instrument `on()`/`off()` calls per screen transition; watch memory/heap snapshots grow monotonically.
6. **“PO picker does ≈1 query/material.”** Confirm: same counter on New PO; expect ≈1,850–1,900.
7. **“Bottleneck is local compute, not paint.”** Confirm: during freeze the network panel is idle (given), and disabling the picker prefetch removes ~all freeze time while leaving the UI functional.

### 3.6 Who is hurt (rubric 01 asks this)

- **Sales staff** — every new invoice/PO blocks their whole browser for ~1 min; on office hardware (≈4× slower) ≈4 min. Multiple times an hour → minutes-to-hours lost per person per day; workarounds likely: keep fewer tabs, wait, batch edits, or bypass the ERP verbally.
- **Storekeeper** — cannot check stock during a customer call; posts receipts on a frozen tab.
- **Owner/accountant** — month-end profit/movement reports are slow and *unreliable* (broken movement→invoice links, no batch traceability) → decisions on stale/incorrect margin.
- **The business** — data accuracy risk (rusty joins, drift) and scaling wall: the freeze grows with the dataset (see Section 4), so the system gets worse every month by construction.

---

## 4. The cost model

### 4.1 The one-line model

```
T_freeze(screen)  ≈  Q(screen)  ×  c  ×  S
```

- `Q(screen)` — number of library queries the screen issues per user action (each of the form “stock rows where material = X”)
- `S` — rows in the local stock copy the library must scan/sort per query (**2,656** today — it scans *all* of them because there is no index)
- `c` — per-row cost of the library’s scan/sort ≈ 28 ms / 2,656 ≈ **10.5 µs/row**

### 4.2 Fitting to today’s numbers

| Screen/action | Q (derived) | Predicted T | Measured | 
|---|---|---|---|
| Edit invoice | 2×1,346 ≈ **2,692** | 2,692×28 ms ≈ **75 s** | **55 s** (effective ≈20 ms/query — same order; cache/early-exits) |
| Read-only invoice | ≈ number of lines (5–35) | 0.14–1.0 s | **0.2–0.9 s** ✓ |
| New PO | ≈0.69× editor ≈ **1,850** | ≈52 s | **38 s** ✓ ratio |
| Effect of invoice size | Q constant in lines | flat | **flat** ✓ |

The model **reproduces all four freeze observations** and treats the “awkward” facts as predictions, not exceptions. That is exactly what the rubric (“does it predict?”) asks for.

### 4.3 Predicting growth

Growth measured from the file: movements **≈510/mo**, invoices **≈160/mo**, POs **≈71/mo**, receipts **≈73/mo**; each receipt line creates a new batch row → stock grows **≈150 rows/mo** and is never cleaned (zero rows stay). Materials grow slower.

**12 months** (assume ≈450 new invoice lines/mo… rather: stock +~1,800 rows, catalogue +~10%):

```
S₁₂ ≈ 2,656 + 1,800 ≈ 4,450      Q₁₂ ≈ 2 × (~1,450 materials) ≈ 2,900
T₁₂ ≈ 2,900 × 0.0105 ms × 4,450 ≈ 135 s   (fast laptop; ≈9 min on a 4× office PC)
```

**10× data** (S=26,560; catalogue ×10 → Q≈27,000 — or, conservatively, Q unchanged):

```
T₁₀ₓ ≈ 27,000 × 0.0105 ms × 26,560 ≈ 7.5M ms ≈ 2.1 h   (if Q scales)
T₁₀ₓ ≈ 2,692  × 0.0105 ms × 26,560 ≈ 750 s ≈ 12.5 min (if Q doesn’t)
```

Read the bracket: **the freeze grows linearly in `S` at minimum — the system has no ceiling; it degrades with success.** At 100× it is hours per click. On the office PC multiply by ≈4.

**Downloads** scale the same way: bytes-per-screen ≈ size of every subscribed list ≈ 11.7 MB today; 10× data → **~117 MB per cold screen**, forever repeating per tab. Under the current design there is no fix that keeps the screen responsive *and* correct *and* bounded — hence a redesign, not a patch.

### 4.4 Why the tempting fixes don’t remove the cost

| Quick fix | Why it fails |
|---|---|
| Spinner / loading state | Hides the symptom; the tab still freezes; cost unchanged |
| Web worker | Moves the 55 s to a worker: UI stays alive, but you still burn minutes of CPU per click; memory doubles; 10× data still 10× cost |
| Cache the picker results | Helps repeats only; first open still pays; cache of unindexed scans gets stale fast (stock changes constantly) |
| Paginate the *client* list | You still downloaded the list; slicing 2,869 rows client-side is the least of the costs — and the picker still queries per material |
| Buy a faster laptop | 4× CPU throttle is the office reality; you’d need 55 s → <0.2 s = 275× |

The only fix that changes the exponent: **move queries to an indexed store where cost is O(log n + rows returned), and send the browser only what it shows.** A cache in front of the same reads, loading spinners, or worker offloading “hide the freeze without removing the cost” — the site says this outright; make sure your diagnosis says it too.

---

## 5. Why this solution

### 5.1 Root cause in one sentence

**The system computes in the wrong place (browser main thread) over the wrong shape (whole unindexed lists) for every question it asks.** Everything measured — freeze, megabyte loads, dashboard recompute, DOM explosion, races — is a consequence.

So the solution is not “make the code faster”; it is **relocate the compute and bound the payloads**:

1. **Indexed relational store** for point lookups, sorting, filtering, joins, aggregates — O(log n + k) instead of O(n) per question, per user, repeatedly.
2. **A server in the middle** so the browser never holds more than the screen it shows, and so multi-record writes (invoice save) are atomic where the data lives.
3. **Push thin change events** (not whole trees) so open screens stay live during the dynamic event.
4. **Derived data** kept deliberately: stored where it must be immediately consistent (batch quantities), computed on demand where it can be (dashboard sums over small indexed sets), with a **reconciliation** path because “never silently wrong” is a requirement.

### 5.2 Stack decision (defend this in the interview)

**Recommended: SQLite (WAL) + small Node.js API (Express/Fastify) + minimal browser UI (vanilla or preact) + Server-Sent Events for updates.** Optional: Playwright for measurements.

Why SQLite is *not* a cop-out:

- Data is tiny: 11.7 MB now, ≈120 MB at 10×, 5 users, ≈73 receipts + 200 invoices/month → a single-writer WAL database is 10–100× over-provisioned anyway.
- **ACID transactions** are the crux of “stock never below zero”: `BEGIN IMMEDIATE` + `UPDATE … WHERE qty >= ?` gives **serializable writes with a row-level guarantee** and no distributed-systems tax.
- Real indexing (B-tree), FTS5 for material search, window functions for running balances — all the query power the current store lacks.
- Zero-ops: one file, trivially copyable, easy for reviewers to run (`npm i && node server.js`). Postgres would also be correct, but adds install/friction for the reviewer — *justify the choice either way; that’s the point of the exercise.*
- 10×/100× headroom: point queries stay microseconds; the two things that *do* grow (dashboard aggregates, movement reports) are indexed range scans and window functions — milliseconds at 10× (2.6M movement rows would still be fine; that’s ~300 years of this business).

Alternatives considered (mention in `DIAGNOSIS.md`):

| Option | Verdict |
|---|---|
| Keep the realtime JSON DB, add indexes — impossible; the vendor offers no index/aggregate API |
| Keep DB + add server **mirror** (dual write, server reads from mirror) | Two sources of truth; every feature pays sync complexity; realtime screens still client-query the old DB → freeze remains |
| Keep DB, move everything to Firebase Cloud Functions | Functions + JSON tree can do some server compute, but no real joins/aggregates at this shape without denormalizing; vendor lock-in for the same effort as SQL |
| Supabase/Postgres hosted | Fine and equivalent in design; SQLite preferred for reviewer-runnable zero-ops; Postgres if the business wants managed backups/multi-writer scale |
| “Just move to a web worker” | Rejected — Section 4.4 (cost unchanged) |

---

## 6. The proposed solution

### 6.1 Component responsibilities (rubric 03: “why this split”)

```
┌────────────┐   HTTPS/JSON + SSE    ┌──────────────┐    SQL (better-sqlite3)   ┌──────────────┐
│ Browser UI │ ───────────────────►  │ Node API     │ ────────────────────────► │ erp.sqlite   │
│ (thin)     │ ◄───────────────────  │ (stateless)  │ ◄──────────────────────── │ WAL mode     │
└────────────┘   page slices,        └──────────────┘   indexed queries,        └──────────────┘
                 search results,                      transactions,
                 stock deltas,                        reconciliation job
                 SSE notifications
```

- **Browser**: renders one screen’s worth of data; keeps only visible slices; posts writes; reacts to SSE pings by refetching *only the affected slice*. No business rules that matter for correctness (UI validation is UX, server validation is truth).
- **Server**: the only writer to the database; all queries indexed; every stock-changing operation is one SQL transaction; emits SSE events after commit.
- **Database**: normalized facts + a handful of purpose-built indexes + FTS5 index for material search.

### 6.2 Data model (stored vs derived called out)

```sql
-- Master data
CREATE TABLE materials (
  id TEXT PRIMARY KEY,                -- keep ORIGINAL keys (mix of push-id & 13-digit) as TEXT
  name TEXT NOT NULL, model_number TEXT, default_unit TEXT,
  reorder_point REAL DEFAULT 0, is_active INTEGER DEFAULT 1,
  legacy_id TEXT,                     -- provenance for the timestamp-keyed rows if remapped
  created_at TEXT, updated_at TEXT
);
CREATE VIRTUAL TABLE materials_fts USING fts5(name, model_number, content='materials', content_rowid='rowid');

CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, address_json TEXT);
CREATE TABLE vendors   (id TEXT PRIMARY KEY, name TEXT, legacy_id TEXT, ...);
CREATE TABLE locations (id TEXT PRIMARY KEY, name TEXT);   -- merged from both storage paths

-- Documents
CREATE TABLE invoices (
  id TEXT PRIMARY KEY,                 -- UUID from source
  invoice_number TEXT NOT NULL UNIQUE, -- handles both 40027 and INV-42124 formats
  customer_id TEXT REFERENCES customers(id),
  customer_name_snapshot TEXT,         -- display of history, NOT a join source
  status TEXT, date TEXT, due_date TEXT,
  subtotal REAL, discount_total REAL, tax_total REAL, total REAL, paid_amount REAL, balance REAL,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE invoice_lines (
  id TEXT PRIMARY KEY,                 -- NEW surrogate ids (source lines had empty ids)
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  material_id TEXT REFERENCES materials(id),   -- nullable when source was broken
  description TEXT, quantity REAL NOT NULL, unit TEXT, unit_price REAL,
  discount REAL, total_price REAL,
  legacy_batch_ref TEXT                -- the old selectedBatchId, kept for audit only
);
CREATE TABLE purchase_orders (...);    -- same shape family
CREATE TABLE purchase_receipts (...);

-- Stock: one row per goods receipt per material = a BATCH. This IS the stock ledger of truth.
CREATE TABLE stock_batches (
  id TEXT PRIMARY KEY,                 -- receipt line id (new surrogate where needed)
  material_id TEXT NOT NULL REFERENCES materials(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  receipt_id TEXT REFERENCES purchase_receipts(id),
  received_at TEXT NOT NULL,
  quantity_received REAL NOT NULL,
  quantity_remaining REAL NOT NULL CHECK (quantity_remaining >= 0),   -- the invariant, enforced by the DB
  unit_cost REAL NOT NULL
);
CREATE INDEX idx_batches_material ON stock_batches(material_id, received_at);   -- picker + FIFO
CREATE INDEX idx_batches_nonzero  ON stock_batches(material_id) WHERE quantity_remaining > 0;

-- Movements: append-only ledger. One row per line sold/received/adjusted.
CREATE TABLE movements (
  id TEXT PRIMARY KEY,
  material_id TEXT REFERENCES materials(id),  -- nullable for the 22 orphans
  legacy_item_id TEXT,                        -- preserved when material was deleted
  batch_id TEXT REFERENCES stock_batches(id), -- THE missing link today
  type TEXT CHECK (type IN ('sale','purchase','adjustment')),
  quantity REAL NOT NULL, unit_cost REAL, total_cost REAL, unit TEXT,
  document_type TEXT, document_id TEXT,       -- real FK to invoice/receipt now
  document_no TEXT,                           -- number as printed on papers (legacy-safe search)
  movement_date TEXT NOT NULL, performed_by TEXT, notes TEXT,
  request_id TEXT UNIQUE                      -- idempotency for retries
);
CREATE INDEX idx_mov_material_date ON movements(material_id, movement_date);

-- Derived (materialized) table — only one, because it is the hot one:
CREATE TABLE material_stock (                 -- material × location summary cache
  material_id TEXT NOT NULL, location_id TEXT NOT NULL,
  qty REAL NOT NULL, value REAL NOT NULL, updated_at TEXT,
  PRIMARY KEY (material_id, location_id)
);
-- Everything else is computed on demand: dashboard sums, balances, running reports.
```

**Stored vs derived policy (rubric 03/04):**

| Value | Where | Why |
|---|---|---|
| Batch `quantity_remaining` | **Stored**, invariant `>= 0` in DB | The one value that must never be wrong at write time |
| Material×location totals | **Derived cache**, updated in the same transaction as batch changes | Every screen shows it; rebuildable from batches any time |
| Invoice `total/balance` | **Stored on write** (recomputed from lines inside the transaction) | Cheap, versionable, audit-friendly |
| Dashboard cards | **Computed per request** (indexed SQL aggregates) | 2,869→28k invoices is nothing for SQL; no staleness to manage. *Materialize only if measured needed* — say this |
| Running balance in movement report | **Computed** with `SUM() OVER (PARTITION BY material_id ORDER BY date)` | Window functions; no storage |
| Material search | **FTS5 index** | Sub-ms prefix/typo-ish search over 1,346→13,460 rows |

### 6.3 Read paths per screen (round trips × bytes)

| Screen | Endpoint(s) | SQL behind it | Round trips | Bytes at 1× |
|---|---|---|---|---|
| Invoice list | `GET /api/invoices?status=&q=&sort=&page=&limit=25` | indexed `WHERE`+`ORDER BY`+`LIMIT` (keyset cursor) + `COUNT(*)` | 1 | ≈15–30 KB |
| Invoice editor open | `GET /api/invoices/:id` + `GET /api/materials?q=&limit=20` (as you type, debounced) | PK lookup + FTS5 | 2 (1 + 1/search) | <5 KB + 2–5 KB/search |
| Editor: stock + batches per material | `GET /api/materials/:id/stock` | 2 indexed queries (`SUM qty WHERE >0`, `SELECT batches WHERE >0`) | 1 per chosen material | <2 KB |
| Save invoice | `POST /api/invoices` (all-or-nothing) | transaction: validate → decrement batches → insert movements → update caches → commit → SSE | 1 | <1 KB |
| Dashboard | `GET /api/dashboard?month=` | 5 indexed aggregate queries in one handler | 1 | <5 KB |
| Stock levels | `GET /api/stock?q=&cursor=` | `material_stock` indexed scan + join material names | 1 | ≈10–25 KB/page |
| Movement report | `GET /api/movements/:materialId?from=&to=` | index + window function | 1 | ≤50 KB (13 years of the hottest material ≈ 525 rows ≈ 60 KB; paginate if asked) |
| Profit report | `GET /api/profit?from=&to=` | join lines→invoices→movements (indexed) | 1 | small |

Compare with today: **Downloads of ≥12 MB become tens of kilobytes** — bytes proportional to the screen, exactly the target.

### 6.4 How pagination, sorting, search cost (rubric 04)

- **Keyset pagination**: `WHERE (date, id) < (:cursor_date, :cursor_id) ORDER BY date DESC, id DESC LIMIT 25` — index range scan, cost O(25), page N costs the same as page 1. (OFFSET degrades linearly with depth — explain why in `DIAGNOSIS.md`: the server still walks skipped rows; at 10× data page 500 gets slow.)
- **Sort/search**: `ORDER BY` uses matching index or sorts a bounded set; search uses FTS5 (inverted index) for name/model, `LIKE` only as fallback on tiny fields. Material picker: query on typeahead (debounced 150 ms, `limit 20`, prefix).
- **Dashboard**: `SUM(balance) WHERE status IN (...)`, `SUM(total) WHERE date BETWEEN ...` — full index scans of a *few thousand* narrow rows, sub-ms; at 10× still single-digit ms. Show the plan (`EXPLAIN QUERY PLAN`) in `DIAGNOSIS.md` to prove no table scan.

### 6.5 Write path: saving an invoice (the crux)

```
POST /api/invoices {request_id, customer_id, lines:[{material_id, batch_id, quantity, unit_price}…]}
1  BEGIN IMMEDIATE                          -- single writer, no interleaving
2  IF request_id seen → return the stored result          (retry-safe)
3  FOR each line:
     a SELECT quantity_remaining, unit_cost FROM stock_batches WHERE id=? AND material_id=?
     b IF remaining < qty → ROLLBACK; 409 {line, available, batches[]}   (explicit, tells UI what changed)
     c UPDATE stock_batches SET quantity_remaining = quantity_remaining - ?
         WHERE id=? AND quantity_remaining >= ?             (belt & braces: DB-level guard)
     d INSERT movement(batch_id, document_id=invoice.id, quantity, unit_cost)  ← the fix for today’s broken link
     e UPDATE material_stock cache (upsert totals)
4  INSERT invoice + lines; total/balance computed from lines
5  COMMIT
6  AFTER COMMIT: emit SSE {type:'stock_changed', material_ids:[…], document:'invoice:ID'}
```

One transaction = atomic: all-or-nothing (fixes “save succeeds for invoice but fails for a derived total”), the `CHECK (quantity_remaining >= 0)` plus conditional UPDATE makes negative stock **impossible at the storage layer**, and `request_id` makes browser retries idempotent (fixes “connection drops mid-save, user retries”). Because writes are serialized (`BEGIN IMMEDIATE`), two salespeople selling the last units cannot both succeed — the second gets a clean 409 with the fresh batch state. At 5 users × ~500 movements/month, a serialized writer is not a bottleneck; it is a feature. (At 100× you’d batch/queue writes or move to Postgres — say this.)

### 6.6 The dynamic event, designed

- Colleague sells 10 of 12 → server commits, emits `stock_changed {material_id}`.
- Salesperson’s open editor holds an SSE subscription; on the event it **refetches that one material’s stock** (`GET /materials/:id/stock`, <2 KB) and:
  - if the user’s selected batch lost units → warning banner: “Batch B2 now has 0; 2 units left in B1”; reselect allowed; totals stay live;
  - if the user’s picked quantity now exceeds availability → line flagged red, save button blocked client-side (but *server still re-checks* — client state is never trusted).
- Storekeeper’s 60-line receipt → one transaction, 60 batches + 60 movements → one `stock_changed` event with many material ids (or a `receipt_posted` event) → open pickers update their “available” numbers lazily (only for materials currently visible/searching).
- After both, stock, movements, invoice totals and dashboard agree **because everything derives from the same committed rows** — and a nightly (or on-demand) **reconciliation job** re-derives `material_stock` from batches+movements and reports any drift to a `data_issues` table.

---

## 7. Consistency, derived data, failures & the dynamic event

### 7.1 The consistency budget (rubric 04 — “what may be briefly stale, what never”)

| Data | Freshness rule |
|---|---|
| Batch `quantity_remaining` | **Never stale** — single writer, transaction, DB constraint |
| Stock totals shown in editor | May lag by one SSE round trip; on *save* the server re-validates → correctness never depends on the UI’s freshness |
| Dashboard cards | May lag seconds; “refresh on SSE + on focus” is fine |
| Search results | May lag seconds; it’s a UX index |
| Movement ledger | Append-only; **never edited**; corrections are compensating adjustments |

### 7.2 Partial failure policy

- Invoice save is **one transaction** → no partial invoices, no orphan movements.
- `material_stock` cache is updated **inside the same transaction**; if that statement fails, the transaction rolls back entirely.
- If a cache is ever found wrong → it is **derived**: rebuild from `stock_batches` (and `movements`) in a `REBUILD` routine; the source of truth is the ledger. This is the answer to “derived value found wrong — detect & rebuild”: **cross-check query** (cache vs `SELECT SUM(quantity_remaining)…`) run at startup/nightly, mismatch → rebuild + log.

### 7.3 Failure & edge case matrix

| Case (from rubric 05) | Designed answer |
|---|---|
| Two people sell the last units at once | `BEGIN IMMEDIATE` serializes; second transaction re-reads batch → 409 with available qty; UI shows fresh batches |
| Save succeeds for invoice, fails for derived total | Impossible by construction: derived cache update is in the same transaction; alternatively recompute-on-read |
| Connection drops mid-save, user retries | `request_id` (client-generated) + unique constraint → second POST returns the first result, no double sale |
| A record doesn’t fit the model | Transform script writes it with null FKs + `legacy_*` columns + a row in `data_issues`; reports show “unknown item” rows instead of dropping them |
| Derived value wrong | Reconciliation query + rebuild; alert in `data_issues` |
| Negative stock attempted | DB `CHECK` + conditional `UPDATE` refuse; API returns 409 |
| Receipt of 60 lines while editors open | One transaction; fan-out of thin events; editors update lazily |
| Duplicate invoice from double-click | Same idempotency key; second submission returns existing invoice |

---

## 8. Migration

**Principle: preserve facts, normalize shape, never drop an unmapped value silently.**

The transform script (`scripts/transform.js`) does, in order:

1. **Read** `cora-erp-masked.json` from a path argument (dataset **not** committed — the site requires this).
2. **Load dictionaries**: materials, customers, vendors, locations — merge both location paths; vendor `id` mismatch → key wins, old `id` stored as `legacy_id`.
3. **Normalize scalars**: quantity/price/cost strings → `REAL` via a tolerant parser; failures → original in `raw_json` + `data_issues` row. (`"3,241 + 3,220"` string quantities are the bulk; parser handles numeric strings, commas, blanks.)
4. **Invoices**: copy header + embedded customer (as `customer_name_snapshot`), *not* as a live FK; rebind `customer_id` to master (3 drifted names verified — snapshot kept for display); create surrogate line ids; move `selectedBatchId` into `legacy_batch_ref` (audit), drop UI scratch fields (`availableStock`, `isValid`, `_original…`) from the business schema but keep the raw JSON of each source record in a `raw_records` table for traceability.
5. **Movements**: for the 4,637 `"new"` links, parse the invoice number from `notes` (`Sold via Invoice #…`) → `document_type='invoice'`, `document_id` = resolved invoice where found (**4,584 of 4,637 resolve**), else keep `document_no` and link later; 603 direct links pass through; the 317 mislabelled `purchase_order` rows are relabelled `purchase_receipt` (verified: 313 ids match receipts) with the mismatch logged; the 22 orphan material ids → `material_id NULL`, `legacy_item_id` kept, surfaced in the issues report.
6. **Stock batches** from `stockLevels` (one row per material per receipt), `quantity_remaining` = current qty (0 allowed, never negative); batch id = source key; derive `received_at` from the earliest receipt movement that matches, else from lastUpdated (log the choice).
7. **Batch link backfill (best effort)**: where a movement note names a batch and the invoice line’s `legacy_batch_ref` survives, link; otherwise leave batch_id NULL **and mark it** — the new system writes it reliably going forward. State this honestly in `DIAGNOSIS.md`: history cannot be fully reconstructed; new data will be complete.
8. **Checks** at the end: row-count invariants (7,761 movements in, 7,761 out), sum(qty) per material vs sum of movements where derivable, no negative quantities, FK orphans only where listed in `data_issues`, byte-size and row-count report printed.
9. **Business survival**: because the source system keeps running, do a **freeze-window cutover**: run transform → import into a fresh DB → sanity queries → then and only then switch; keep the old export and a double-entry of daily exports until all daily screens are verified (the store is editable and audit-friendly). Write this as a checklist; “the business is in use every working day” means *you never mutate the source; you import forward.*

---

## 9. How to proceed

### 9.1 The 36-hour plan (today Tue 13 Oct → deadline Wed 14 Oct, 11:59 PM IST)

| Block | Work | Output |
|---|---|---|
| H0–1 | Repo scaffold; `better-sqlite3` install; schema DDL in one file; Maven-like “run everything” scripts | `schema.sql`, `package.json` |
| H1–3 | `scripts/transform.js` from Section 8 with invariant checks + issues report | DB built from full dataset |
| H3–4 | API: list (keyset/status/search/sort), material FTS search, stock+batches, dashboard | curl-verifiable endpoints |
| H4–6 | API: `POST /invoices` transaction (Section 6.5) + SSE broadcaster | save works; 409 paths tested |
| H6–9 | UI (ugly is fine): invoice list, editor (picker + batches + live totals), dashboard | 4 required screens |
| H9–11 | **Dynamic event wiring**: SSE client, editor live refresh, stale-batch UX; scripted two-tab demo | demo works headlessly |
| H11–13 | Measurement harness (Playwright + CDP): 4× throttle; capture bytes (`Network`), round trips (request count), longest task (`longtask` + tracing); script per screen | `measure.js` prints a table |
| H13–15 | 10× dataset generator (Section 9.3) + rerun measurements | before/after @1× and @10× tables |
| H15–17 | `DIAGNOSIS.md` (rubric-mapped), `README.md` (run steps), limitation section | docs |
| H17–19 | Demo video (script: problem→domain→diagnosis→architecture→live demo of dynamic event→numbers→limits) | mp4 + link |
| H19–20 | Buffer: fix the one thing that broke; **email** repo + video | submitted |

Rule: build less, understand more — keep the UI trivial and put every hour saved into measurements and the diagnosis (that’s what’s judged).

### 9.2 Repo layout

```
techora/
  README.md            # run: node scripts/transform.js <dataset.json> && node server.js
  DIAGNOSIS.md         # 2–4 pages, rubric-mapped, written by you
  schema.sql
  scripts/transform.js # never commits the dataset
  scripts/grow10x.js   # generates the 10× dataset, states realism
  scripts/measure.js   # Playwright/CDP harness, prints bytes/round-trips/longest-task
  server.js            # API + SSE
  public/              # minimal UI
  data/                # gitignored: erp.sqlite, datasets
```

### 9.3 Measurement & the 10× dataset

- **Method**: Playwright, Chromium, `page.emulateCPUThrottling(4)` (DevTools protocol), `PerformanceObserver('longtask')`, CDP `Network` for bytes, count `request` events for round trips. Measure per screen: cold open + one interaction (edit open, search keystroke×10, save).
- **10× growth**: replicate the last 12 months of movements/invoices/receipts forward 10× in **creation-order-consistent** fashion; keep distributions (64.9% single-line invoices, qty mix of string/number formats — the raw parser must survive), preserve id uniqueness by prefixing, keep 1,558-like zero-row ratios; **state** that stock-batch growth (≈150/mo) is the realistic part and that pessimistically duplicating the whole table overstates the future — then report both.
- **Honesty**: report any target you missed plainly (the site explicitly rewards this).

### 9.4 Demo video storyboard (4–6 min)

1. 20 s — problem: click Edit on prod-parity old app (or describe from site numbers), freeze timer on screen.
2. 60 s — domain: batch stock, why per-batch cost, who waits.
3. 90 s — diagnosis: main-thread long task; the `2,700 × sort(2,656)` model; 0-MB network fact.
4. 90 s — architecture walk: schema, indexes, transaction algorithm, SSE.
5. 120 s — **live dynamic event**: two tabs + storekeeper receipt (can be scripted API calls shown side-by-side); show the 409 “stock gone” path.
6. 60 s — numbers: 1× vs 10× table (bytes, round trips, longest task).
7. 30 s — limits: what’s not handled (offline use, history not fully reconstructable, etc.).

---

## 10. Student guide

Each concept, in the order you need it.

### 10.1 Why the tab *freezes* rather than just being slow

The browser has one **main thread** that runs JS, processes clicks, and paints. It handles one task at a time (the **event loop**). A click handler that runs 55 s of JavaScript without `await`/yield is one **long task**: during it, no paint, no input. This is why “frozen” and “slow” are different diagnoses: slowness = too much total work; freeze = one task longer than a frame. The site’s target (“no main-thread task >200 ms”) is a *long-task* budget, not a load-time budget. Fix long tasks by removing work from the task (server-side queries, smaller data, yielded chunking) — not by adding spinners.

### 10.2 Why there is no network and it still freezes (local replica)

The realtime DB library keeps an in-memory JSON tree of every subscribed list and serves queries **locally**. So after cold load, the tab never needs the network to hit this bug — it re-queries its own memory. Consequence: “no network during freeze” doesn’t mean “no work”; it means the work is `O(local data) × O(queries)`. Rule of thumb: **realtime sync moves data *closer*; it doesn’t make it *cheaper*.**

### 10.3 Why 5-line and 35-line invoices freeze identically (proportionality)

When a cost doesn’t change with an input you thought mattered, ask **what else it could be proportional to**. Here the work is proportional to the **catalogue** (1,346 materials × ~2 queries ≈ 2,700), not the invoice. Ark: read-only opens do scale with lines (0.2–0.9 s ≈ lines × 28 ms), which pins 28 ms as the per-query price and proves the query population is the variable, not the invoice. **Lesson: model the cost; don’t guess the bottleneck.**

### 10.4 Why indexes are the whole ballgame

Imagine finding a name in a phone book by reading every page (scan) vs jumping via alphabetical order (index). The current store scans/sorts all 2,656 stock rows **per query, per screen, per user, per click**. An index (B-tree) turns “where material = X” into “walk a few pages to X, read only its rows” — **O(log n + k)** instead of O(n). At 10× data, scan cost ×10; index cost +1 hop. This single change removes ~93% of the freeze’s cost model.

### 10.5 Keyset pagination (why OFFSET is a trap at 10×)

`LIMIT 25 OFFSET 10000` makes the server read and discard 10,000 rows — page 500 is slower than page 1, and at 10× it’s 10× slower again. **Keyset** (“everything after the last row I saw, in date order”) lets the index jump straight to the cursor: page 500 costs like page 1. This is how “bytes ∝ screen” and “10× ≤ 2× worse” are achieved together.

### 10.6 Transactions, `BEGIN IMMEDIATE`, and why stock can’t go negative

An invoice save is several writes: decrement 3 batches, insert 3 movements, insert header+lines, update totals. If they aren’t **atomic**, a crash leaves half a sale. A **transaction** makes them all-or-nothing. `BEGIN IMMEDIATE` takes the write lock up front so two salespeople’s saves **serialize** — the second sees the first’s committed numbers. Then `UPDATE … WHERE quantity_remaining >= ?` (plus a `CHECK >= 0`) is the last line of defence: even a bug can’t write negative stock. This is the **check-then-act race**: between “check 12 available” and “write 10”, someone else may sell; doing both inside one serialized transaction closes the window.

### 10.7 Derived data: what to store, what to compute, how to trust it

Some answers are *facts* (a batch has 5 units left — store it), some are *summaries* (total stock of material X across batches — derive it). Storing summaries is a **cache**: fast but can lie. The discipline: (1) name the source of truth (the batches/movements ledger); (2) decide the staleness budget per value (batch qty: zero seconds; dashboard: seconds); (3) update caches in the same transaction as the facts where correctness matters; (4) have a **reconciliation** that recomputes caches from facts and reports drift. “Never silently wrong” = detection + rebuild, not “it never happens”.

### 10.8 Realtime without re-downloading the world

Old model: push whole trees to every tab (fat, constant re-processing). New model: after a commit, push a **thin event** (“material X changed”, “document Y saved”) and let each screen refetch only what it shows. Same UX (“live”), a tiny fraction of bandwidth, and correctness doesn’t depend on the message — the refetch hits the authoritative store. SSE is enough for one-way notifications, works over plain HTTP, and survives proxies better than WebSockets for this scale.

### 10.9 Batch/lot stock and costing (the domain, rubric 01)

A trading company buys the **same item** at different purchase prices over time. If you keep “one stock number per item”, you cannot say **which purchase** a sale consumed, so you cannot compute true gross margin, and when prices move your reports lie. Per-batch rows (one per goods receipt) let you: pick which batch to sell (FIFO, or the user picks — the app lets users choose!), know each consumed unit’s **actual cost**, and value remaining stock at real cost. Flatten it and you lose: per-batch availability display, landed-cost per batch, and any trustworthy margin — which is exactly why “stock requirements matter for your design” is in the dataset section. Cost of the batch approach: rows multiply (2,656 for 1,346 materials; worst 137), so **zero rows must be filtered/archived** and queries must be batch-indexed — the current system does neither.

### 10.10 How to measure like the challenge does

- **Longest task**: `PerformanceObserver` `longtask` entries (or DevTools Performance recording) — report the max, on a **4× throttled CPU** (`Emulation.setCPUThrottlingRate`) because office PCs are slower than dev laptops.
- **Bytes**: CDP Network `encodedDataLength` totals for the scenario, cold cache.
- **Round trips**: count of HTTP requests per scenario.
- **Fairness**: same dataset, same scenarios, cold cache, same throttle; put the numbers in a table in the README/DIAGNOSIS. Report 1× and 10× in one table so the 2×-worse target is checkable.

### 10.11 Why the “just cache it / worker it / spinner it” answers are traps

They treat symptoms: the *cost* (`queries × data`) stays and grows with the business; the site says they “hide the freeze without removing the cost” and will be probed at 10×/100×. Interview-ready sentence: “We removed the per-query scan by indexing, and bounded what the client receives; the same change fixes 10× because both terms stop scaling with total data.”

---

## 11. Edge cases → design answers

See matrix in Section 7.3. Additions worth memorizing for the interview:

- **Client clock/ordering**: all timestamps server-set, UTC, ISO; document numbers server-generated; never trust client order.
- **Deleting/inactivating materials**: soft-delete (`is_active`), reports keep resolving history; movements keep `legacy_item_id` for orphans.
- **Rounding**: money as `REAL` is acceptable here (2 dp, small scale); if you want paranoia, integer cents — say the trade-off.
- **Backups/restore**: SQLite file copy + WAL checkpoint; document a restore drill; the export/transform can always rebuild.
- **Audit**: movements append-only; invoices get `updated_at`; optional `audit_log` table of before/after is a cheap addition — mention as future work.

---

## 12. Trade-offs and limitations

Say these out loud (rubric 06; honesty is scored):

1. **One server, one writer**: superb for 5 users; at very high write concurrency you’d queue/batch or move to Postgres. We optimized for *correctness + reviewer-runnable simplicity*, gave up horizontal scale we don’t need.
2. **SQLite file ops**: ops story is “copy the file”; weaker than managed Postgres for geo-redundancy/role separation — accepted, with migration path documented.
3. **History not fully reconstructable**: 53 sales movements still won’t resolve to invoices; some batch links stay NULL. New data is complete; old rows are flagged. (Honest limitation, explicitly reported.)
4. **Realtime is now eventually-consistent for *display*** (SSE lateness): accepted because writes are always re-validated server-side; correctness never rides on the push.
5. **What gets harder than today**: today’s “everything is live everywhere for free” illusion is gone — you now own invalidation logic and SSE plumbing; and you must run a server (deploy/monitor) where before the vendor ran everything. Justify: the illusion was the bug.
6. **Derived caches**: one more thing to reconcile; we chose exactly one hot cache (material_stock) to keep the invariant surface small — dashboard aggregates are computed, not cached, until measurements say otherwise.
7. **Offline**: not handled (current system had a local replica that sort-of worked offline). We trade silence-for-offline for correctness; an offline PWA queue is future work.

---

## Appendix A — Verified dataset facts

Run `node scrape/verify.mjs` etc. to reproduce. **Every** claim in the site’s dataset section verified:

| Site claim | Verified | Notes |
|---|---|---|
| 11.7 MB, one JSON file | ✅ 11,696,988 B | |
| transactions 7,761 / 3.5 MB | ✅ 7,761 / 3.49 MB | |
| invoices 2,869 / 3.8 MB / 5,211 lines | ✅ (3.97 MB decimal; 3.78 MiB — matches either rounding) | |
| POs 1,053 / 3,050 lines | ✅ | |
| receipts 1,068 / 2,680 lines | ✅ | |
| stockLevels 2,656 | ✅ | |
| materials 1,346 | ✅ | |
| customers 203, vendors 59 | ✅ | |
| other 47 | ✅ 22+2+2+1+20 | adjustments, direct deliveries, 2 location paths, units |
| 1,558 zero-qty rows; max 137/material | ✅ | 691 materials with any positive stock |
| 4,637 of 5,240 “new” links (88%) | ✅ 88.5% | **all 4,637 carry invoice number in notes; 4,584 resolve; 53 don’t** |
| qty string in 3,241 movements + 3,220 lines | ✅ | + 493 string unitPrices, 514 string costPerUnit |
| 1,002 timestamp-keyed materials | ✅ | 344 push-id keys |
| copies drift | ✅ 3 invoices’ customer name diverged | |
| 2/3 invoices one line; max 100 | ✅ 64.9%; max 100; avg 1.82 | |
| one material 525 movements; typical 2 | ✅ (median 2, 963 materials used) | |
| 22 orphan movements | ✅ | + 8/22 adjustment transactionId dangling; 317 PO-labelled movements actually point at receipts (313) |
| 39 vendors id≠key | ✅ | |
| five user accounts | ✅ ids 1,3,4,6,7 (+ `system` agent) | |
| ~550 movements/month | ✅ ≈510/mo measured | invoices ≈161/mo, POs ≈71/mo, receipts ≈73/mo |
| “1,213 rows” on stock screen | ✅ distinct material×location = 1,211 today | screen groups batches into rows |

**Additional defects I found:** all **5,211 invoice lines have empty `id`**; 4,693 lines persist `selectedBatchId`, 4,207 persist `availableStock`/`isValid` (UI state inside business records); **1,670/5,240** sale movements say “Batch: No Batch ID”; invoice numbers in **three formats** (plain, 2,521 `INV-`-prefixed, 7 other, plus `DOC-*` direct-delivery numbers in the same collection); invoice statuses: 2,844 sent / 21 paid / 3 draft / 1 partial; adjustment movements carry **no direction** — it must come from the linked adjustment record, which resolves for only 14 of 22. **Plus two findings made while building the demo:** (a) sales movements’ `costPerUnit`/`totalCost` actually carry the **sale price**, not the stock cost (2,789 of 2,853 resolvable documents match the invoice total exactly) — legacy margin must come from batch costs; (b) the invoice line’s batch reference is **composite** `materialId_batchId` and resolves for **4,684 of 4,717** lines once stripped — the batch link existed all along, it was just unusable without knowing the encoding.

**Demo:** a working prototype (`demo/`) implements this redesigned system — same JSON tree, indexed server, atomic saves, SSE — with these findings handled in the migration (Section 8, and see `demo/EXPLAINER.md`).

---

## Appendix B — Submission checklist

- [ ] Repo with source + `scripts/transform.js` + `scripts/measure.js`; **dataset not committed**; README run steps
- [ ] `DIAGNOSIS.md` 2–4 pages: freeze explanation (every measurement), cost formula + 12-mo/10× predictions, design + trade-offs, measured results
- [ ] Prototype on the **full masked dataset**: invoice list (page/sort/search), editor picker (stock+batches), save, one aggregate view
- [ ] Dynamic event demo (two-tab race + 60-line receipt) recorded live
- [ ] Measurements: bytes/round-trips/longest task @1× and @10× on 4× CPU; misses reported
- [ ] Can explain failures, trade-offs, limitations (this report Section 7, Section 11, Section 12)
- [ ] Email **info@techcoracorp.com** before **Wed 14 Oct, 11:59 PM IST** (repo link + video)

### The one-paragraph summary to memorize

> The tab freezes because one click makes the browser run ~2,700 locally-executed “stock where material = X” queries in a single main-thread task, and the realtime library answers each by scanning/sorting all 2,656 cached stock rows — cost ∝ catalogue × stock, independent of the invoice, which is why 5-line and 35-line invoices die identically and nothing moves on the network. Separately, every screen is slow because it downloads entire lists (≥ the 11.7 MB DB) and keeps them forever, recomputing aggregates 4× and rendering 19,600 DOM nodes. The fix is to move queries to an indexed server-side store (SQLite), fetch only visible pages, make invoice saves atomic with row-level stock guards, keep exactly one hot derived cache with reconciliation, and push thin change events so open screens stay live and correct during concurrent writes.

---

*Report prepared 13 Oct 2026. All dataset claims independently verified against `dataset/cora-erp-masked.json`; scrape artifacts in `scrape/`. The dataset is confidential — not included in any submission, used only for this exercise.*
