# Techcora — "The ERP that freezes" — analysis & solution workspace

Working repo for the Techcora problem statement (inventory/invoicing ERP whose tab freezes ~55 s on every invoice edit).

## What is here

- **`REPORT.md`** — the full analysis: verified diagnosis of the freeze, cost model with growth predictions, proposed architecture (SQLite + Node API + SSE), migration plan, 36-hour execution plan, student explanations, and failure/trade-off matrices.
- **`scrape/`** — the complete scraped problem statement and the data-verification tooling:
  - `PROMPT.md` / `page.txt` / `page.html` — full text of the assignment page.
  - `verify.mjs`, `check2–4.mjs` — Node scripts that check every dataset claim (counts, sizes, broken links, type mixtures, skew, loose ends).
  - `verification.json` — machine-readable results.

## Dataset

`cora-erp-masked.json` (confidential) is **not committed**. To reproduce the verification, place the export at `dataset/cora-erp-masked.json` and run:

```bash
node scrape/verify.mjs
node scrape/check2.mjs
node scrape/check3.mjs
node scrape/check4.mjs
```

## Status

- [x] Site scraped in full; judging criteria extracted
- [x] Dataset fully verified (all 18 site claims + additional defects found)
- [x] Diagnosis, cost model, architecture, migration, and plan written (`REPORT.md`)
- [x] Prototype built (`demo/`) — same JSON tree, indexed SQLite server, atomic invoice saves, SSE realtime, UI with dashboard/list/editor/stock/movements, dynamic-event demo tools
- [x] Measurement harness (`npm run measure`, 4× CPU throttle) + 10× growth generator (`npm run grow10x`) + E2E suite (37 tests) + invariant audit (15 checks)
- [x] Submission documents: `demo/DIAGNOSIS.md` (+ generated `DIAGNOSIS.docx`) and `demo/VIDEO_SCRIPT.md`
- [ ] Record the demo video, paste its link, and send the submission email
