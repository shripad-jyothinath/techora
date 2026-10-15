# Techcora ERP — "the ERP that freezes", rebuilt

A working demo of a small trading company's ERP: **stock, purchasing and invoicing**. It was built for the Techcora assignment *"The ERP that freezes"* — the original company system froze for about **55 seconds** every time someone opened an invoice to edit it.

This rebuild keeps the same data and the same screens, and makes everything instant:

| | Old system | This build |
|---|---|---|
| Opening an invoice to edit | **~55 s — tab frozen** | instant |
| Dashboard load | 22.2 MB | ~3 KB |
| Invoice list, 25 rows | 12.2 MB (for 10 rows) | ~6 KB |
| Slowest screen interaction, measured at 4× slower CPU | seconds of waiting | **0.13 s** |

The full explanation — what caused the freeze, how the cost was modelled, the design and its trade-offs, and all the measurements — is in **[demo/DIAGNOSIS.md](demo/DIAGNOSIS.md)**.

In one sentence: the old app copied whole lists into every browser and did all the searching, sorting and maths there; this one keeps the data in an indexed database next to a small server and sends the browser only what is actually on screen.

---

## Run it on your machine

You need **Node.js 20 or newer**.

```bash
cd demo
npm install
npm start
```

Then open **http://localhost:3000**.

A fresh install starts empty. **The first account you create becomes the admin.** With no data loaded yet, open the **Demo tools** button (bottom right) and pick one:

- **Generate sample data** — Small / Medium / Large. Creates deliveries, stock batches, invoices and adjustments for you.
- **Load masked dataset** — loads the real (masked) export, if you have the file. Put it at `dataset/cora-erp-masked.json` in the repository root — the dataset is confidential and is **not** committed to the repository.

You can also build the database straight from the file on the command line:

```bash
npm run transform    # builds demo/data/erp.sqlite from the export file
```

---

## What you can do in the app

### Sign in
- Create an account, log in, log out. Passwords are stored hashed; sessions use a secure cookie.
- The first account becomes the **admin**; later accounts are **staff**.

### Dashboard — everything at a glance
- Four cards: **Outstanding** (money customers still owe), **Sales this month**, **Purchases this month**, and **Gross margin**.
- **Hover any card** to see the exact figures behind it — for example, hovering Sales shows the month's total to the cent, how many invoices made it up, and the average invoice.
- **Sales — last 6 months** chart: hover any bar to see that month's exact total and invoice count.
- **Low stock**: materials at or below their reorder point (and the ones completely out of stock).
- **Awaiting delivery**: purchase orders that have not fully arrived yet.
- **Activity**: a live list of what everyone in the system is doing. It updates by itself as things happen — see "Work together" below.

### Stock — what do we have, and where did it go?
- **Stock levels**: every material with the quantity on hand. Search, page through the list.
- Click a material to expand its **batches**: each delivery it came from, how much of it is left, and what it cost.
- Open a material's **movement report**: every sale, receipt and adjustment that touched it — with a running balance and a date filter. This is the answer to "where did this stock go?"

### Invoices
- **Invoice list**: search by number or customer, filter by status, sort by clicking a column, page through. All of this happens on the server, so it stays instant even on the full dataset.
- **Open an invoice**: see everything about it, **mark it as paid** with one click, or print it.
- **New invoice**: type a few letters to find a material, see how much is available, choose which batch it comes from (oldest first, with the real cost), set a quantity and add it as a line. Totals update as you type. When you **Save**, everything happens together in one step: stock goes down, the movement history is written, and the invoice appears everywhere.

### Work together — the live parts
- Open the app in two browsers as two different users. When one of them sells or receives something, the other one's open screens **update by themselves** — no refresh needed.
- If you are editing an invoice and someone else takes the stock first, a banner appears **immediately** with the new numbers; if you still try to save, the save is refused and tells you how many are actually left. Stock can never go below zero, and the same stock can never be sold twice.

### Find anything fast
- **Ctrl/Cmd + K** opens a command palette: jump to any screen, or find invoices and materials by typing.

### Demo tools (bottom-right button)
- **Live scenario** — the exact scene from the assignment: step 1 puts 12 units of one material into stock across two deliveries; step 2 has a colleague (a second account) sell 10 of them while you watch an open invoice update live and an oversell get refused; step 3 posts a 60-line goods receipt in one go.
- **Data** — load the masked dataset, generate sample data, or wipe everything and start over. (Wiping keeps your accounts.)

---

## A typical user's flow

1. **Sign up** — the first account becomes the admin.
2. **Look at the dashboard** — how much money is owed to you, how this month is going, what is low on stock, what is still on order.
3. **Check stock before promising anything** — Stock levels → search the material → look at its batches and their real costs.
4. **Create an invoice** — New invoice → search the material → pick the batch → set the quantity → Save. Stock moves at that moment.
5. **Follow the invoice** — open it from the list, print it, mark it paid when the money arrives.
6. **Check history when something looks off** — the material's movement report shows every change with a running balance.
7. **Work alongside a colleague** — sign in as a second user in another browser; changes show up on both sides without refreshing.
8. **Reset whenever you want** — Demo tools can replay the scenario or load the full dataset again.

---

## What it does not handle (honest list)

- **Anyone can sign up.** There is an admin/staff label, but no per-screen permissions yet.
- **One server, one database file.** Comfortable for a small team; not for many branches at once. (DIAGNOSIS.md explains the move to Postgres when needed.)
- **No PDF export and no emailing of invoices.** Printing uses the browser.
- **Some records in the legacy export are broken** (free-text notes instead of real references). Those gaps stay visible in the app — it never silently guesses them.

---

## Tests and checks

```bash
npm test             # 39 browser + API tests, ~30 s (runs on its own copy of the database)
npm run audit        # 15 invariant checks — stock is never negative, batches add up, and more
npm run measure      # the before/after numbers, measured in a real browser
```

---

## The rest of this repository

| Where | What |
|---|---|
| [`demo/`](demo/) | The app itself: server, web UI, scripts, tests. |
| [`demo/DIAGNOSIS.md`](demo/DIAGNOSIS.md) | The required write-up: the cause, the cost model, the design, the numbers. |
| [`demo/EXPLAINER.md`](demo/EXPLAINER.md) | Every concept explained in depth — a deeper companion to DIAGNOSIS.md. |
| [`demo/VIDEO_SCRIPT.md`](demo/VIDEO_SCRIPT.md) | The script for the demo video. |
| [`REPORT.md`](REPORT.md) | The full analysis: diagnosis, architecture, migration plan. |
| [`scrape/`](scrape/) | The original assignment page and the scripts that verified every number in it. |
