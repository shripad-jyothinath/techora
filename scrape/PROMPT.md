# Techcora � "The ERP that freezes" � full site text (scraped)

Source: https://eww.techcora.in/api/pages/public/kYoxq2ri5N4Y-w1hpWdLZbh0qjtTkwxKQ95Txia9IZk
Scraped: 13 Oct 2026 � raw HTML in scrape/page.html

---

The ERP That Freezes
[STYLE]
Scenario
Evidence
Data
Your task
Evaluation
Submit
Techcora · Problem statement · Live system
The ERP that freezes
An inventory and invoicing system locks the browser tab for close to a minute when someone opens an invoice. Work out why from the evidence and the data, design the fix, and build enough to prove it.
Deadline
Wed 14 Oct · 11:59 PM Wednesday, 14 October 2026, 11:59 PM IST
Submit to
info@techcoracorp.com Copy
You send
Repo + demo video With a written diagnosis inside the repo.
Scenario
What is happening
A trading company runs its stock, purchasing and sales on a web ERP. The browser tab hangs while people are working in it.
The hang is reproducible. It happens with no network activity , and it lasts the same time for a 5-line invoice as for a 35-line one. The measurements are below, followed by a masked copy of the production data.
How the system is built
Single-page web app , running entirely in the browser. There is no application server between the browser and the database.
A hosted realtime JSON-tree database. The browser reads and writes it directly through the vendor's client library, which keeps a local in-memory copy of whatever it is subscribed to and pushes changes to every open tab.
No joins, no aggregates, no server-side search. The database can filter a list on one field and can limit a result. Everything else (sorting, searching, totals, joining one list to another) is done by the browser.
Each screen subscribes to whole lists and keeps them for the rest of the session. “Page 2 of invoices, sorted by date” is produced by downloading every invoice and slicing in memory.
Records copy data from each other. An invoice carries its own copy of the customer and all of its line items; stock is kept as one row per goods receipt per material.
A handful of people use it (five user accounts appear in the data), several at the same time, with the tab left open while they work.
Evidence
What we measured
Chrome on a fast laptop, cold load, against a copy of production. “4× slower CPU” is Chrome's CPU throttle, a rough stand-in for a modest office PC.
55 s tab frozen after clicking Edit on an invoice. One uninterrupted task on the main thread.
0 MB network traffic during that freeze (about 10 KB). Nothing is being downloaded.
2 min 44 s frozen after clicking New purchase order on a 4× slower CPU (38 s on the fast laptop).
22 MB received to draw the dashboard. The entire database is 11.7 MB.
The freeze does not depend on the invoice
Seconds the tab stays unresponsive after clicking Edit, by number of line items on the invoice.
5 lines 54.6 s
10 lines 56.1 s
20 lines 55.4 s
35 lines 56.6 s
Opening the same invoices read-only is quick: 0.2 to 0.9 s of blocked time.
New purchase order freezes for 38 s, about two thirds as long as Edit invoice.
A CPU profile of the freeze: 93% of the time is inside the database client library, answering queries from its local copy . It re-sorts the stock list for every query.
About 2,700 such queries are issued by one click on Edit, roughly 28 ms each. Each is of the form “stock rows where material = X”.
Every screen downloads far more than it shows
MB received on a cold open. The marker is the size of the whole database (11.7 MB).
Dashboard 22.2
Invoice list 12.2
Reports 11.1
Goods receipts 7.5
Purchase orders 6.2
Materials 4.9
Stock levels 4.9
Customers 0.05
The invoice list shows 10 rows . It received 12.2 MB to do so.
The dashboard asks for the full invoice list four times , then blocks the main thread for 2.0 s (9.0 s on a 4× slower CPU) computing four summary cards.
The stock-levels screen renders 1,213 table rows at once : 19,600 DOM nodes.
Subscriptions are never released. After visiting a few screens a tab holds every list, and every write by any user is re-processed in every open tab.
These measurements describe behaviour, not code. Part of your job is to explain what must be going on for these numbers to come out the way they do, and to say what you would measure next to confirm it.
Access patterns
What the screens need
The data a screen needs is much smaller than the data it currently pulls. These are the reads and writes your design has to serve.
Screen What the user must see or do How often
Dashboard Outstanding invoices (count and amount), this month's sales, purchases and margin, low-stock alerts, purchase orders still awaiting delivery. Every login, left open
Invoice list 10 to 50 rows per page. Sort by number, customer, date, due date, total, balance. Filter by status. Search by invoice number or customer name. Constantly
Invoice editor Pick a customer. Add line items by searching 1,300+ materials by name or model number. For each line, see available stock and choose which batch (goods receipt) to sell from, with its unit cost. Totals update as you type. ~200 invoices a month
Saving an invoice Stock goes down in the chosen batches and one stock movement is recorded per line. Stock must never go below zero, including when two people sell the same item at once. On every save
Purchase order and goods receipt Same material picker. Receiving goods creates new stock batches with a landed cost and records one movement per line. ~70 a month each
Stock levels Current quantity and value per material and location, searchable. Drill into the batches of one material. Daily
Material movement report For one material and a date range: every movement in order, with running balance and the invoice or receipt behind each one. Weekly
Profit report For a date range: revenue, cost of goods sold from the batches actually consumed, margin per invoice and in total. Monthly
Dataset
The data you get
One JSON file, 11.7 MB unpacked: a full export of the production database tree after masking.
Download dataset cora-erp-masked.zip · 1.8 MB · opens Google Drive
Path Records Size What it is
inventory/transactions 7,761 3.5 MB Stock movements: one per line sold, received or adjusted. Grows by about 550 a month.
sales/invoices 2,869 3.8 MB Invoices, each with an embedded copy of the customer and an embedded array of line items (5,211 lines in total).
purchasing/purchaseOrders 1,053 1.4 MB Orders to vendors, line items embedded (3,050 lines).
purchasing/purchaseReceipts 1,068 1.3 MB Goods received against an order, line items embedded (2,680 lines).
inventory/stockLevels 2,656 1.2 MB Stock on hand: one row per material per goods receipt (a “batch”), with quantity and unit cost.
inventory/materials 1,346 0.4 MB The catalogue.
sales/customers , purchasing/vendors 203, 59 < 0.1 MB Master data.
Other 47 < 0.1 MB Stock adjustments, storage locations, units, direct deliveries.
Things you will find in it
None of this was cleaned up. It is how the data really is, and several of these matter for your design.
1,558 of the 2,656 stock rows have quantity 0. Used-up batches are never removed. One material has 137 stock rows.
88% of sales movements do not point at their invoice. 4,637 of 5,240 have relatedDocumentId: "new" ; the only link is the invoice number inside a free-text note.
Mixed types. Quantity is a string in 3,241 movements and 3,220 invoice lines; prices are sometimes strings too.
Three kinds of record id in one list: 1,002 materials are keyed by a 13-digit timestamp, the rest by the database's own generated ids. Other lists use UUIDs.
Copies that drift. Each invoice embeds the customer; a few no longer match the customer record.
Skew. Two thirds of invoices have one line; the largest has 100. One material has 525 movements; the typical one has two.
Loose ends. 22 movements reference materials that no longer exist; 39 vendors have an id field that differs from their key; storage locations live under two different paths.
What masking changed
So you know what you can and cannot rely on.
Kept exactly: the tree structure, every record count, every reference between records, field types, dates, quantities, statuses and the size of every text field.
Replaced: all names of people, companies and products, model numbers, emails, phones, addresses and free-text notes. Text is filler of the same length.
Re-issued: every record id. References still resolve, and the database-generated ids still sort in creation order.
Scaled: every money amount, by one constant factor. Ratios, margins and totals-versus-lines relationships hold.
Renumbered: invoice and order numbers, consistently, so a number quoted inside a movement note still finds its document.
Removed: uploaded-file links and internal training content.
Problem
Your task
Explain the hang, redesign how this system stores and reads its data so it cannot happen again, and prove the redesign on the dataset.
1
Diagnose
Explain why the tab freezes, using the measurements and the data. Account for each odd fact: no network, same time for any invoice, purchase order at two thirds.
Write the cost as a formula in terms of the data (how many of what, multiplied by what). Use it to predict the freeze in 12 months and at 10× volume.
Separate the one cause of the hang from the general slowness . They are different problems with different fixes.
Say what you cannot know without the code and how you would confirm it.
2
Design
A data model and read paths that serve the screens above. What is stored, what is derived, what is indexed, what each screen fetches and in how many round trips.
Where derived data (stock per material, dashboard totals, running balances) lives, who keeps it correct, and what happens when an update to it fails halfway.
Whether you keep the current database or replace it , and whether a server now sits in the middle. Either answer is acceptable. An unjustified one is not.
A migration from the export as it is, loose ends included, that the business can survive: the system is in use every working day.
3
Build
A working prototype loaded with the full masked dataset , serving at least: the invoice list (page, sort, search), the invoice editor's material picker with available stock and batches, saving an invoice , and one aggregate view (dashboard or movement report).
Any language, framework and database. A plain UI is fine. This is not a design exercise.
The script that transforms the export into your model.
4
Measure
For each screen you built: bytes transferred, round trips, and longest main-thread task , on a 4× throttled CPU.
The same numbers on a dataset you have grown to 10× . Say how you generated it and whether the growth is realistic.
Numbers you did not hit, reported as plainly as the ones you did.
Dynamic event
The data changes while the screen is open
A salesperson has an invoice open with a line for a material that has 12 units left across two batches. While they are typing:
a colleague saves another invoice that sells 10 of those 12 units ;
the storekeeper posts a goods receipt with 60 lines , creating 60 new batches and 60 movements in one go.
Your system must keep the open screen responsive and correct without reloading everything, must not let the first salesperson sell stock that is gone, and must leave stock, movements and any derived totals agreeing with each other afterwards. Show this happening in your demo.
Targets
What good looks like
No main-thread task longer than 200 ms on a 4× throttled CPU, on any screen you built.
Opening the invoice editor and getting a usable material search in under 1 s .
A list screen transfers data in proportion to what is on screen , not to the size of the list.
At 10× the data , the numbers above get no more than 2× worse .
Stock never negative. Derived values never silently wrong.
If you think a target is wrong for this business, argue for a different one. That is a valid answer.
Core challenge
Making one slow screen fast is the easy part. The hard part is deciding what the system should know in advance and what it should work out on demand, and keeping the two in agreement when several people write at once.
A cache in front of the same reads, a loading spinner, or “move it to a web worker” hides the freeze without removing the cost. We will ask what your design costs at 10× and at 100×.
What we are looking for
This is not a coding contest. Writing more code is not the goal.
AI tools can generate a lot of code very quickly. The goal is to learn deeply, understand the problem, and build something that demonstrates that understanding. Use any tool you like. You will be asked to explain every part of what you submit.
01 How well you understand the problem and its domain : stock, batches, costing, invoices.
02 How clearly you can explain the system you designed .
03 How you reason about architecture, constraints, failures and trade-offs .
04 Whether you understand why you made each technical decision.
05 Whether you can explain your solution's limitations and what you would improve.
Evaluation
How you'll be judged
Primarily on understanding, reasoning and learning , not on the amount of code you produce.
01 Problem & domain understanding
Why does a trading business keep stock per batch, and what breaks if you flatten it?
Who is hurt by the freeze, and what do they do about it today?
Which constraints are real (stock accuracy, cost per batch, daily use) and which are habits of the current build?
02 Diagnosis
Does your explanation account for every measurement, including the awkward ones?
Is the cost model stated in terms of the data, and does it predict?
Did you check your claims against the dataset?
03 Architecture
Entities, what is stored and what is derived.
The read path and the write path for each screen.
Responsibilities of each component, and why this split.
04 Technical reasoning
Why this data model, these indexes, this database.
Your consistency approach: what is allowed to be briefly stale, and what never is.
How pagination, sorting and search work, and their cost.
05 Failure & edge cases
Two people sell the last units at the same moment.
A save succeeds for the invoice but fails for a derived total.
The connection drops mid-save, and the user retries.
A record in the export does not fit your model.
A derived value is found to be wrong. How do you detect it and rebuild it?
06 Trade-offs & demo
What you optimised for and what you gave up.
What your design makes harder than it is today.
A working system on the full dataset, with the dynamic event shown live and the measurements on screen.
Submission
What to send
Email both items to info@techcoracorp.com by Wednesday, 14 October 2026, 11:59 PM IST .
1. GitHub repository link
The complete project source code, including the data transformation script and the measurement script .
A README explaining how to run it.
A DIAGNOSIS.md : your explanation of the hang, the cost model, your design and its trade-offs, and your measured results. Two to four pages. Written by you.
Do not commit the dataset. Have your script read it from a path.
2. Demo video
Explain the problem , the domain and your diagnosis .
Walk through your architecture and the decisions behind it.
Show the working system on the full dataset, the dynamic event , and your before-and-after numbers.
Say what it does not handle.
What happens after you submit
Wed 14 Oct · 11:59 PM IST Submissions close Your repo link and demo video must reach us by then.
Within 48 hours of your submission Shortlist result We evaluate what you sent and email you whether you are shortlisted .
If shortlisted Two interview rounds A technical round on the project you built, and an HR round .
Before you hit send
0 of 8 done
My diagnosis explains the freeze and each odd measurement
I wrote the cost as a formula and used it to predict growth
The prototype runs on the full masked dataset
The dynamic event is handled while the system keeps running
I measured bytes, round trips and longest task, at 1× and 10× data
README and DIAGNOSIS.md are in the repo; the dataset is not
I can explain failures, trade-offs and limitations
Emailed to info@techcoracorp.com before Wed 14 Oct, 11:59 PM
Your ticks are saved in this browser only.
Build less if necessary. Learn more. Understand deeply. Be able to defend what you built.
info@techcoracorp.com Copy email
The ERP that freezes · Deadline Wed 14 Oct 2026, 11:59 PM IST · The dataset is confidential. Use it for this exercise only and do not publish it.
[SCRIPT]
