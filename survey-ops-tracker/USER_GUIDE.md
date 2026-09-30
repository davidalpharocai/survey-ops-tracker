# Survey Ops Command Center — User Guide

*Last updated: September 28, 2026. The team's tracker for survey projects from first inquiry through delivery.*

**Finding this guide later:** the top navigation bar's **More** menu links straight here, along with the Systems & Handover doc.

**App:** https://survey-ops-tracker.vercel.app
**Sign in:** passwordless. Enter your **@alpharoc.ai** username on the login page (the domain is fixed, so only company accounts can get in) and click **"Email me a sign-in link"** — you'll get a one-tap magic link. Open it **on the same device** you requested it from to finish signing in. No password to set or remember. Once you're in, **you stay signed in on that device** — you don't need a new link each visit. Opening the login page while you're already signed in takes you straight in, and **Sign out** only signs out the device you press it on.

---

## 1. The Board (home screen)

[screenshot: board in Operations view]

The board shows every active project as a card moving left-to-right through the pipeline:

**Submitted → Doc Programming → Survey Programming → EdWin QA → Fielding → Data QA → Delivery**

- **Drag a card** to a new column when a project advances — everything updates automatically (stage checkboxes included). Cards stay exactly where you drop them.
- **Click a card** to open the project.
- The board opens filtered to **your** projects (the Captain filter shows "XX (me)"). Pick "All Captains" to see everything — it remembers your choice.

### Views
- **Operations** (default): open, active projects only — the daily working view.
- **Full View**: adds the **Scoping** board (pre-sale deals) and on-hold context. Drag a scoping card down into the pipeline to approve it.
- The **Archived** section — historical work: finished and cancelled projects — sits collapsed at the bottom of **both** views, with its own "Delivered in the last …" window.
- If a project ever ends up in a state the board doesn't recognise (an unknown status, or a scoping deal parked on a stage that has no column), an **amber notice above the lanes lists it by name and links to it**, and it is written to the CSV. Nothing is ever dropped silently — open it and fix whatever the notice names.
- **⬇ Export CSV** on the board writes every project in the sections the view holds: Full View writes Scoping, the pipeline and Archived; Operations writes the pipeline. The pipeline filters (captain, search and the rest) and the Delivered window do not narrow the file; hover the button for the exact count. For a file that follows your filters, export from the **List** page.

### Card colors (the key at the top explains them in-app)
- **Red border** = due today or overdue · **Orange** = due tomorrow · **Amber** = due in 2 days
- **Grey, faded, ⏸ On hold corner badge** = on hold. A deal put on hold while still in Scoping stays in its scoping column, sorted to the bottom. The Scoping header counts them in their own ⏸ chip, not in the open-deal number. Hover the (i) for how to resume or cancel it.
- **Amber "Has field activity — move it out of Scoping?"** = a deal still marked Scoping that already has blasts, panel suppliers, send fees or responses on record. The (i) says what was found; if it is being fielded, drag it down into the pipeline.
- **Green border + NEW!** = a project someone just assigned to you (opens it to dismiss)
- **⚑ / ‼ chips** = high/urgent priority (those cards float to the top of their column)
- **💤 Stale?** = no dates and no updates in 30+ days — worth reviewing
- **PS / B2B / Rerun badges** = project type (PureSpectrum panel / expert panel / repeat wave)

### Filters & search
Captain (by full name), Salesperson, Client, Type, Due (today/tomorrow/2 days), Stage (including Closed), and a search box (project or client name). The Salesperson list is built from whoever actually sold the projects. Hover any filter label's (i) for what it does.

**Saved views**: set the filters how you like, hit ★ Save, name it ("My urgent", "Jenna's PS work") — then jump back to it from the Views dropdown anytime. After picking a view you can **⟳ Update** it to your current filters, **✎** rename it, or **🗑** delete it. Views are personal (saved in your browser). In Full View, the Scoping and Operations Pipeline sections collapse with the ▾ next to their titles — also remembered per person.

### Shortcuts
- **Ctrl+K** (or Cmd+K) — command palette: type a few letters of any project and jump straight to it; type `>` for actions
- **/** — jump to the search box
- **N** — new project (on the board)

## 2. Creating a project

You can create a project two ways — describe it in plain English and let AI fill the form, or fill it in yourself. Both open the same dialog.

**Step by step:**

1. On the board, click **+ New Project** at the top right (or press **N**). The New Project dialog opens:

![The New Project dialog](/guide-img/create-1-new-project-dialog.png)

2. **Fastest — describe it.** In the **✦ Describe it and I'll fill out the form** box, type it in plain English — e.g. *"New B2B for Meridian, Tom sold it, Priya captain, 200 responses, due July 15, budget 15k"* — and click **Fill form**. AI fills the fields below for you to review.
3. **Or fill it in manually:**
   - **Project name** (required).
   - **Client** (required) — start typing, then pick an existing client from the list, or choose **+ New Client "…"** to create one on the spot.
   - **Type** — PS, B2B, or Rerun.
   - **Captain** — the team member running it (leave **Unassigned** if you're not sure yet).
   - **Salesperson** — who sold it.
4. **Already approved?** Tick **"Already approved — skip scoping and add straight to the pipeline"** to drop it onto the operational board (Submitted). Leave it unticked and the project starts in **Scoping** as a New Inquiry.
5. Click **Create inquiry** (the button reads **Create project** if you ticked "Already approved"). The project is created and its page opens — dates, N targets, budget, and everything else are edited from there (see §3).

New projects normally start in **Scoping** (New Inquiry → Proposal Sent → Pricing Discussion → Awaiting Approval). Approve a deal by dragging its card into the pipeline, or with the green button on its project page. It works in reverse too — if a deal reopens, drag the card back onto a scoping column (Full View), or use "↩ Back to Scoping" on the project page; pipeline progress is kept in case it gets re-approved.

## 3. The project page

![The project page, Overview tab](/guide-img/project-overview.png)
*Everything about one project on a single page: the command bar and pipeline spine up top, the ✦ Summary, the field grid (Details · N & Audience · Money · Flags) down the main column, and the People / Next Steps / Documents rail on the right.*

### Header
The project name (click to rename), a permanent **Project ID**, and a **Type** badge (PS / B2B / Rerun — click to change it; the same field also edits in the Details grid below) sit up top next to the status pill. On the right: **⚑ Priority** (cycles none → high → urgent) · **⏸ Hold** / **▶ Resume** (pauses; card greys out and sinks to the bottom of its column; Resume brings it right back) · **✕ Archive** / **↺ Reopen** (leaves Operations view but stays in Full View's Archived section, reopenable anytime) · and an **Actions ▾** menu that collects the less-frequent record actions in one place: **⎘ Clone project**, **⧉ Merge with a duplicate…** (see *Merging duplicates* in §7), managing **Co-Captains** (sharing a project shows "+1" on its board card), **⛔ Cancel project** (records a reason, then folds the project off the active board into Full View's **Archived** section as *Cancelled* — **Reopen** brings it back), and **🗑 Delete project** (asks you to type "delete"; the project moves to Admin → Recently Deleted and can be restored — it's not gone for good unless deleted permanently from there).

![The Actions ▾ menu](/guide-img/actions-menu.png)
*The **Actions ▾** menu (top-right of the header) gathers the less-frequent record actions in one place.*

### ✦ Summary
At the top of the **Overview** tab: an AI-written status brief. Every figure in it — N, spend, pace vs. the due date, days in the current stage — is computed exactly in code first; Claude (Haiku) only writes the sentences around those numbers, so it can't invent or alter one. It surfaces **watch-outs** automatically as a short amber list — past-due, spend running ahead of collection, a dip in blast completions, or a segment behind its own target. It's collapsible (collapsed shows just the one-line takeaway), shows an **"as of"** stamp for how stale it is, and has a **↻** to force a regenerate; otherwise it loads once when you open the project and does not refresh itself in the background. Labeled **AI · Beta** — the figures are exact, but verify specifics before relying on the prose.

### Overview: the field grid
Below the Summary, the Overview body is a Salesforce-style **field grid** — aligned label → value rows spanning the main column. Click any value to edit it in place; save on Enter or click-away, Escape cancels (a quick "Saved ✓" confirms it stuck). At the very top of the main column, **Pipeline Progress** still lets you check off stages (this moves the card on the board) — or **Scoping Stage** progress for deals not yet approved. Below that, the grid runs:

- **Details** — Submitted / Launch / Due / Delivery dates, a **Rerun date** row (longitudinal projects only), **Type**, and **Survey IDs** (comma separated; auto-filled overnight from the Edwin sync — a mismatch surfaces an inline "Use Edwin ID / Keep current" banner above the grid rather than overwriting silently).
- **N & Audience** — see *N Segments* below.
- **Money** — by project type: **PS** shows **Suppliers**, grouped into **launches** (fielding waves) — each launch has its own **target** plus supplier rows with a **$/complete (CPI)** and a per-supplier **cap**; before completes it shows a cost **range** (target × cheapest…priciest CPI), and **＋ Add launch** starts a new wave pre-filled from the last one. **B2B** shows **Blast Configuration** — each blast's **$/bid**, **# of people** reached, **# of completes** (editable inline as they trickle in), a date/time, and a description; cost = $/bid × completes. **Blank is not zero.** A new blast starts with those three figures **unrecorded** (shown as “— set”), because completes can't be known at send time; while $/bid or # completes is blank the blast's **Cost** reads “— not recorded” rather than $0, and an amber line above the list tells you how many blasts the project's spend is therefore **excluding** — so the total is a floor, not the bill. Type **0** only when you mean it (a send that genuinely produced nothing, or an unpaid one); clearing a cell puts it back to unrecorded. A Rerun-tagged or not-yet-typed project shows both, since neither maps cleanly. A **Budget & spend** summary sits underneath: Total budget, computed actual spend, cost/complete, and a budget-used bar.
- **Flags** — small color-coded, click-to-toggle chips — Longitudinal, Row-Level Data, Occam — each with an (i) explaining it.

Alongside the grid, a slim right rail holds: **People** (Client — click to open their page; the **Requested by** contact; Captain; Salesperson; and, for **B2B** projects with a Slack channel set, a **Slack** row that opens the channel in the desktop app rather than the browser), **Rerun history** (every wave of a recurring survey in order, each linking to that wave's page with its dates and N; a stand-alone survey can **↻ Link this as a rerun of another survey**, and a linked wave can be unlinked — the picker opens on the nearest surveys for the same client, and you can **search every survey by keyword or PR number** to link one from anywhere), **Related surveys** (for two surveys that belong together *without* one being a repeat wave of the other — a soft launch and its full launch, the B2B and consumer halves of one study, a survey that replaced a cancelled one. Search the same way, add an optional note saying how they are related, and the link appears on both surveys. It is deliberately not a rerun link: it adds no wave number, no series and no auto-spawn), **Compliance** (only when the client requires a review — see §7b), and **Latest / Next Steps** (add a to-do with Ctrl+Enter; check one off and it moves to the "Latest" log with date + who; old imported notes live under "History"). **Linked Documents** now sits at the bottom of the main column, below the field grid — paste any URL (its title fills in automatically), rename via ✎ or unlink via ✕ (the file stays in Drive).

**Requested by** is the client contact who asked for the survey. Click it to pick from that client's people or add a new one inline (first + last name required; email/title/phone optional), and click a chosen name to view or edit their details. Manage the full roster — and archive/delete contacts — on the client page.

(Changes in plain English are still handled by the connector — ask your Claude to make edits instead of a per-page box.)

### N Segments
Split "N & Audience" into per-segment tracking — e.g. Buyers / Sellers — with **＋ Split into segments**; add as many as you need. Each segment gets its own **N Target, N Internal Target, N Collected, N Actual, Audience, Total Available Audience Size,** and **Audience Size Used**, editable the same way as any field-grid cell. Once segmented, the top-level N fields become **read-only sums** ("Σ across N segments") — edit the segments instead; an un-segmented project keeps its top-level N fields directly editable. **✕** removes a segment, with a one-click **↩ Undo** for the rest of the session. For **Jenna's general-population studies**, the same soft **gen-pop N floor** check as before still runs against the (summed) N — national ≈ **1,350**, state-level ≈ **500**, read from the free-text Audience — advisory, type **`override`** with an optional reason to dismiss it, Undo to bring it back.

### Editing numbers and dates
- **Number fields** — N Target / Internal Target / Collected / Actual (whole-project or per segment), Total Available Audience Size and Audience Size Used — take plain numbers, comma-grouped numbers (`4,200`), or a leading **`=`** to auto-sum: type `=4200+800` and it commits as `5,000`.
- **Date fields** — Submitted, Launch, Due, Delivery, Rerun — take typed entry (`7/23/2026` or `Jul 23, 2026`) or the **📅** calendar picker. A date that isn't real (`2/30/2026`, a garbled year) is rejected inline rather than silently saved.

### Tabs
- **Overview** — the field grid + rail above, topped by the ✦ Summary strip
- **Insights (Beta)** — performance stats. A top **KPI row**: **N progress** (collected vs target), **Budget** (spend vs budget + a projected final cost), **Cost / complete**, and **Pace** — completes/day since fielding began, a projected finish date, and how much **buffer** you have before the due date (or how far past). Below it:
  - **Segment pace** (multi-segment projects only) — each segment tracked against **its own** target with an on-track / behind read; because over-collecting one segment doesn't cover a shortfall in another, a caveat calls it out when the total looks complete but a segment is lagging.
  - **Time in each stage** — a day-count bar per pipeline stage. The clock starts at **Doc Programming** (the Submitted → Doc Programming gap isn't tracked) and the current stage is marked "· now".
  - Per-type **blast** (completion rate, cost/complete, best/worst send) or **launch & supplier** performance (fill rate per launch, supplier mix, best value). A blast with no completes recorded shows **“—”**, not 0%, and is left out of the rates instead of counted as a failed send.

![The Insights (Beta) tab](/guide-img/insights-segment-pace.png)
*The Insights tab: the KPI row (N progress, budget, cost/complete, pace) up top, then **Segment pace** — here Buyers are on track while Sellers are behind, and the amber note flags that a healthy total N can still hide a lagging segment.*

- **Activity** — logged emails and events for the project (click one to expand and read; the search box finds a specific email by subject, body, or person). See §9b.
- **Deliverables** — the final client deliverables filed for this project. See §9.
- **Links** — Slack channel link and notification info. (Survey IDs live in the Details grid now, not here.)
- **Logs** — two histories in one place: the **Data Change Log**, where engineers log manual data edits ("removed 4 speeders from SV-2201"; date + author stamped, edit/delete with confirmation), and the automatic **Audit Log** — every field change on the project (who changed what, when, and the old → new value; "system" means an automated update like the nightly Edwin sync). You don't write to the Audit Log — the system records it for you.

## 4. The List view

A sortable table of all projects — click any column header to sort, including **N collected**, **N Actual**, **Captain**, and **Type** (the N columns sort by number, so you can rank who's furthest behind). The header stays frozen as you scroll and the **Project column stays pinned** when you scroll sideways; a line above the table shows the count and current sort, and a **Comfortable / Compact** toggle sets row density. It has the **same filters as the board** (Captain, Salesperson, Client, Type, Due, Stage, search). **⚙ Columns** lets you hide columns you don't use — your choice is personal (saved in your browser) and doesn't affect teammates. **Saved views** here remember the whole table setup — Operations/Full, filters, which columns are showing, and the sort — under a name you pick; ⟳ Update, ✎ rename, and 🗑 delete them just like board views. Rows carry the same colored due-date edge as board cards (red overdue, orange tomorrow, amber in 2 days; dropped once a project is closed). **⬇ Export CSV** downloads whatever is currently shown, with every field regardless of hidden columns.

## 4b. The Calendar

Open the **Calendar** tab in the top nav to see everything dated on one **month grid** (‹ / › to change month, **Today** to jump back). Each day shows its events as color-coded chips; a busy day shows the first few plus **＋N more** (click the day to see them all), and clicking an event opens that project.

**What's on it** (each colour is a type, and the legend toggles each on/off): **Due** (internal) · **Deliver** (client) · **Launch** · **Rerun** (next wave of a longitudinal study) · **Reminder** (your own). Due and Deliver keep the overdue/soon colour.

**Filters** (remembered per person): **Captain**, **Type** (PS / B2B / Rerun — so Sree can isolate reruns), **Just mine**, **Client**, **Priority**, and **Status** — by default it shows **only open, active projects**; tick to also include On-Hold, Closed, or Scoping. On a phone it switches to a chronological agenda list.

## 4c. Finance (finance team only)

**Who can open it.** **Finance** is a tab in the top navigation ribbon, straight after Calendar, and only the finance team — David, Shanu and Vineet — sees it. It is no longer in the **More** menu for anyone. If someone else opens the address directly they get a plain page: *"Finance is limited to the finance team: David, Shanu and Vineet"*, with links back to the board and to Insights. The decision is made on the server, so none of the page's figures are even read. If the permission check itself can't run, the page says *"We could not check your access just now"* and offers **Reload** — it never dresses a failed check up as a refusal.

### The four tabs, and the question each one answers

- **Results** — what we charged, what it cost and what we kept on **delivered** work. Four cards: *What clients pay vs what we spent*, *Where the delivered spend went* (a waterfall, with recovered rewards as their own line rather than folded into "Other"), *By delivery month*, and *Where it was made and lost* — which you can **Group by** Account, Route, Month, Contact, Type as filed, Survey, or Panel supplier (the panel grouping opens the PureSpectrum supplier view, and a supplier opens its own wave-by-wave drilldown).
- **This week** — live work only. *Decisions this week* groups every open survey under the one thing to do about it — **FREEZE THE BID · CONFIRM FINAL N · STOP BUYING · CAP THE WAVE · SET A BUDGET · PRICE IT · TOP UP THE CONTRACT · CONVERT THE TRIAL · CHECK THE SERIES** — each row saying what is at stake. **On hold** is its own bucket and is never counted inside a live total. *Credit pools* shows contracts drawn past their allowance. One survey can need two or three decisions, so the group totals overlap; a line under them says so and names the count.
- **Per respondent** — *What one respondent costs*, by route, against the quote floor; *Where more margin could come from*, a ranked list of levers, each opening the surveys it was measured on; and *Rules tested and rejected*, so a rule that didn't survive the data isn't proposed again.
- **Improve** — *What to record next*: the gaps ranked by how many dollars each one hides, as a chart and a list, each row saying **who** records it, **when** and **where**. Plus *What each month's records carry*, *Logged within a week*, and *Blocked: needs data SOCC does not capture* (measures we can't compute at all yet, and what would have to be recorded first).

Old bookmarks still work: `?tab=now`, `unit`, `book` and `save` land on the tab that now answers the same question, and the address is rewritten once so the link you copy from then on is the one the page reads.

### Filters, and the "Since 1 Jun 2026" default

The sticky bar under the tabs carries three filters, and **every view is a URL** — the tab, the dates, the account and the route are all in the address, so any view can be bookmarked, shared or refreshed, and the tabs, chips and **Clear** are real links you can middle-click.

1. **Date** — **Since 1 Jun 2026** is the default on every tab, with **This month**, **Last month**, **This quarter**, **Custom** (which reveals a **From** and a **To**) and **All time** one click away. On **This week** the date control is greyed and reads *"Live work — all dates"*, because live work is judged by what it is doing now, not by when it was delivered; the date you picked elsewhere is kept for the other tabs.
2. **Account** — one client account, old name variants rolled together. Each name shows how many surveys it has **under the other filters**; an account with none is greyed out rather than removed, so you can see it is empty instead of wondering where it went.
3. **Route** — how a survey was **actually** fielded, read from its own cost records rather than how it was filed: **All routes**, **Blast only**, **Panel only**, **Both**, or **No field rows**.

Whatever is in force shows as removable chips under the bar, with **Clear** to drop them all.

### The banner, and why its dates move on their own

Under the filters, a banner says how far back the numbers can be trusted — *"Costs are reliable from …"* — plus what the surveys **in your view** actually carry. **Nothing in it is typed in.** Each date is the first month from which that field's coverage stays above its bar, computed from the records themselves, so as prices are backfilled toward June the line moves back by itself and the "prices are still thin" sentence disappears by itself when the last thin month clears. While months are still thin the banner names them and links to **the Improve tab** to see which surveys need a price. The banner turns **amber** when your view reaches back before costs were reliable (or into surveys with no date at all) — such a view mixes two eras and reads worse than the business did — and offers **Back to since 1 Jun 2026**.

**The integrity line** under it is the receipt: what the page read from the database and the time it read it. It turns **red and names the table** when a read failed, a count disagreed, or the spend the page recomputed doesn't match the stored figure. Anywhere on these tabs, **a failed read is never shown as $0** — you get **Blocked**, naming the table that did not load, or a dash with the reason.

### Looking behind a figure

Click any figure, chart mark or table row and a panel opens listing the surveys behind it. Each survey code is a real link to its project page. At the top, a strip says whether the rows **add back** to the figure; when they don't it goes red, names the missing and extra surveys, and says *"Do not rely on either number until this is explained."* **Esc** closes the panel and puts you back on the control you opened it from; on a phone it fills the screen. **Download these rows** saves just that list.

### Export what you see

1. Set the tab and filters you want.
2. Click **⭳ Export what you see** (top right of the filter bar). It writes **exactly** the rows behind that tab's main card — never a different cut — with the as-of time and every filter written at the top of the file.
3. The download starts straight away. A moment later the line beside the button says **"Logged as export #…"**, or says the export was not logged and why. A lost audit record never holds up your file.

A name typed as a spreadsheet formula is written out as plain text, in these files and in the board and list exports alike, so a CSV can't be turned into a script.

### "How to read this" — the glossary

The link at the top right of the page opens a drawer with the only ten words the finance page is allowed to use (**Esc** closes it). The same ten, one sentence each:

- **Client price** — the client's price per respondent times the respondents we delivered, never more than the N they bought — what the contract implies, not cash received, because there is no invoice record yet.
- **Our cost** — the field cost we recorded: blast rewards (bid × completes), text-message sends (cost per send × people; email is free), panel purchases (price per complete × completes) and vendor lines, minus rewards that went unclaimed and came back.
- **We keep** — what is left after field cost, before salaries and overhead: client price minus our cost.
- **Budget** — the most we planned to spend on a survey — a cost ceiling with a starting goal of about half the price, and never revenue.
- **Complete** — a respondent we paid for, counted before the quality checks (QA).
- **Qualified respondent** — a respondent the client received, after QA.
- **Scrub** — completes that QA removed: we paid for them, and the client never received them.
- **CPQR** — cost per qualified respondent: our cost divided by the respondents the client received.
- **Billed N** — the respondents we can bill: the N delivered after QA, never more than the N sold (the top of the range, when a range was sold).
- **Route** — how a survey was actually fielded, read from its cost records rather than how it was filed: blast (B2B email or text), panel (PureSpectrum), or both.

**50% is a goal, not a rule.** Keeping half of the client price, and budgeting about 50¢ per $1 of price, is drawn as a goal line and used to colour figures — it never blocks anything and never turns intake amber.

## 4d. Insights — the team dashboard

**More → Insights** is the dashboard for everyone. It answers "what has the team actually delivered", and it **shows no money at all** — no budget, spend, price or margin. (It doesn't even ask the database for those columns.)

It opens with a sentence that states the headline in words, then:

- **Six tiles, each with a sparkline**: **Surveys delivered** · **Respondents delivered** (post-QA N) · **On time** · **Median cycle time** · **In flight now** · **Reruns delivered**. Each compares against the period before — but **only when both periods have at least 10 surveys**, and only when deliveries missing a deliver date couldn't change the answer. Otherwise the tile says so rather than quoting a move it can't stand behind.
- **Charts**: delivered per month by type (months outside your dates are faded, for context), on time and median cycle time by month against their goal lines, and delivered by captain, by type and by account — plus a **Biggest deliveries** table.
- **Right now**: the pipeline by stage with collection progress, overdue / due this week / behind target, work **on hold** and **still scoping** counted separately, and workload by captain.

**Filters** (all in the address, so a view can be shared): **date range** — This month (the default), Last month, This quarter, Since 1 Jun 2026, Last 12 months, Custom, All time — plus **Type**, **Captain** and **Account**. "Right now" follows the type, captain and account filters and ignores the dates, because it describes today.

Every tile, column, bar and count opens a list of exactly the surveys behind it, each a real link to its project, with a check that the list's count matches the figure. Where the List page can show the same thing, the panel offers **"Open these in the List"** and says how the two may differ.

A few rules worth knowing: a survey is placed by its **deliver date** (the day the client had it); **on time** means delivered on or before the due date; **cycle time** is calendar days from submitted to delivered, using the median so one outlier can't drag it; empty rerun placeholders and demo accounts are left out, and the footer says how many. A read that fails shows as **Blocked**, never as zero.

## 4e. Insights for sales — the same dashboard, one book

Salespeople get their own **Insights** tab in the sales portal (between Contacts and What's new). It answers the same question §4d does — what has actually been delivered — narrowed to the accounts on that person's book, and it is the **same tested model** underneath, so a cycle time or an on-time share means exactly what it means on the analyst page.

What is there: a sentence stating the period in words, then four tiles (**studies delivered**, **respondents delivered**, **on time**, **typical time to deliver**), delivered per month by type, on time and time-to-deliver against their goal lines, delivered **by account** and **by type**, the **largest deliveries**, and an **Open right now** card (in flight, overdue, due within a week, being scoped, and the pipeline by stage). Filters are **dates**, **type** and **account**; "Open right now" ignores the dates, because it describes today.

What is deliberately **not** there: any dollar figure, and anything about who internally ran a study or how work is spread across the team — that is an operations view, not a book view, and the page says so at its foot rather than leaving a silent gap.

**Account pages** also now carry **Value of delivered work** for the dates chosen. Read it carefully: it is what the delivered studies were **worth**, not a record of what the client has **paid** — the app holds no invoices or payments. Where a study has no price recorded the tile says "not known yet" instead of counting it as nothing, and where only some are priced it says how many it left out. Most accounts have little pricing recorded today, so an empty tile is normal and is not a statement about the client.

## 5. The AI Assistant

![The ✦ Assistant panel](/guide-img/assistant-panel.png)
*The ✦ Assistant opens from the floating button (bottom-right) or ⌘/Ctrl-K. Ask it about your projects or tell it to make a change — it shows a preview to confirm first.*

The **✦ Assistant** is now a full working assistant — it can both **answer questions and make changes**, right in the app (no external setup). Open it from the floating **✦** button (bottom-right), press **⌘/Ctrl-K** anywhere, or expand it to the full-page view from the panel for a roomier session.

**Ask it anything** — same as before, from live project data, logged emails, next steps, and the data change log:
- *"What's due this week?"* · *"What's at risk?"* (leads with deadline/collection risk)
- *"Any recent emails on SPCX?"* · *"What data changes were made this month?"*
- *"Decode ALBNFOF20260529UK"* (it knows the survey ID format)

**Tell it to do things** — it has the same abilities as the "connect your Claude" connector: create/update projects, advance stages, log a blast, add next steps or notes, manage clients and contacts, set reminders, and more:
- *"Advance Government Shutdown Poll to Fielding"* · *"Add a next step to A4A Q3: chase the client for approval"* · *"Create a new PS project for Coatue, 800 N, due Aug 1, captain Julia"*
- Every change first shows a **preview with Confirm / Cancel** — nothing is saved until you click **Confirm**. The assistant can't change anything on its own, and the same compliance gate applies (e.g. it can't mark a gated project delivered without an approved review).
- On a **project or client page**, it knows what you're looking at — *"log a blast here"* or *"advance this to Data QA"* just works.

## 6. Things that happen automatically

- **Survey IDs** sync nightly (~6:45pm ET) from each project's Edwin link; conflicts show an amber review banner on the project
- **Launch (fielding) date auto-fills** the day a project first moves into **Fielding** — but only if it's still blank, so a date you entered yourself is never overwritten. Still editable anytime in the Details grid.
- **Morning digest** posts to Slack at 8am ET: overdue, due-soon, and behind-pace projects
- **Live updates**: teammates' changes appear on your screen within a second — no refreshing
- **If a save ever fails**, a message pops up bottom-left and the change safely reverts — nothing is ever half-saved
- **Next waves** of a rerun series spawn on their own only when the series is **in service**, set to **auto**, and **armed**. A series that is manual, paused, out of service, or has no cadence will never spawn one by itself — which is deliberate, and is why a series can sit with a due date and no next wave.

**Editing a rerun series** (Reruns → a series): **✎ Edit** on *Series details* now opens **every field it shows**, including the ones that used to be read-only — the **fielding start (anchor)**, the **next wave number**, and a **Next due (by hand)** date.

That last one is worth knowing about. Normally the next due date is *computed*: the last wave's date plus the cadence. Setting **Next due (by hand)** overrides that arithmetic, and works even on a series with no cadence set at all — which is the only way to give a due date to a series whose cadence was never known. It **expires by itself** once a wave lands on or after that date, so you never have to come back and clear it. Leave it empty for the usual computation.

**Writing things down on a series.** *Series details* carries three free-text fields, all shown on the record and all editable under **✎ Edit**:

- **Rerun guidance** — how the series is meant to be *run*: the standing instruction that should outlast whoever happens to pick up the next wave. Fielding windows, who has to be asked, what must not change between waves.
- **Notes** — whatever is worth recording about the series right now.
- **Data / QA note** — a known quirk in this study's *data*: a question that always needs recoding, a segment that under-fills.

Notes and the data/QA note were always saveable but were never shown once you left the edit form; they are on the record now, so an empty one reads as empty rather than as missing. You can also set all three by asking Claude ("add guidance to the Acme tracker series: …"), which previews the change before it writes.

## 7. Project IDs & Admin

- Every project has a permanent **Project ID** like `PR00042` — shown next to the project title and in the list view, included in CSV exports, and assigned automatically to new projects. It never changes, so use it when referencing a project in email or Slack. Clients have matching `Cl#####` ids.
- **Merging duplicates**: if the same project (or client) got entered twice, open either copy and click **Merge…** in the header, search for the duplicate, and you'll get a preview. Pick which record **survives**, resolve any **fields that differ** (dates, N, budget, etc. — matching fields are hidden), and everything else — bids, blasts, next steps, deliverables, contacts, notes, activity and audit history — **combines** onto the survivor. The other record is **soft-deleted** to Recently Deleted (recoverable). Analyst-only. Two caveats: a project whose N is **split into segments** must be un-split first; and merging two **clients** doesn't auto-merge their duplicate *projects* — merge those separately.
- The **More → Insights** page (top nav) is the team dashboard — what was delivered, on time, cycle time, and what's open right now, all clickable through to the surveys behind it. See §4d. It carries **no money figures at all**; budget, spend, price and margin live on the Finance page (§4c), which only the finance team can open. The overdue rule it uses is the one everything else uses: overdue means the due date has **passed**, and a project due today counts as due this week — the list, the board, the client and contact pages and the morning digest all agree.
- The **☰ menu → Internal Projects** page is a separate home for AlphaROC's own work (product, ops, hiring, tooling), kept entirely apart from survey projects. It's a sprint-based **Backlog → In Progress → Review → Done** board: "+ New internal project" defaults the client to AlphaROC, each project has an Owner, Category, Objective, a Sprint (a 2-week window — set the cadence in **Admin → Sprint cadence**), and a Next Steps checklist instead of survey N tracking. No survey fields, and internal projects never appear on the survey board, list, insights, or digest.
- The **☰ menu → Admin** page is organized into tabs — **Overview** (systems links, system status, AI usage, data health), **Accounts & Team**, **Operations** (sprint cadence, recently deleted), and **Audit Log** — and has: links to every system behind the tracker (including Supabase Users for password resets), a **System status** panel (shows whether the automated backend jobs — the nightly Slack digest and the survey-ID sync — ran cleanly, with any failures listed; the same failures also show up in the daily Slack digest), an **AI usage** panel (what the assistant chat and AI project entry have cost this month, with an editable monthly budget and an optional "hard stop" that pauses AI features when the budget is reached; a **Breakdown** shows spend **by person** and **by feature** over This month / last 30 / last 90 days / all time), **Recently Deleted** (restore a project you deleted by mistake, or delete it permanently), a **master audit log** (every field change across all projects — who, when, old → new, including deletes and restores, with the project linked), the client list with their ids, the team roster (with **+ Add member** to put a new teammate on the roster so they're selectable as a project captain, and ✎ to fix a name/initials), and a data-health checklist (open projects missing a captain or due date).
- **View as** (Admin → Access → 👁 View as, admins only): see exactly what a salesperson or compliance reviewer sees, through their own permissions. It is read-only and logged, and it does not touch their account. It won't start while they have an unused sign-in link waiting (it would cancel it) or before they have signed in for the first time (it would use up their invitation). **Stop viewing** and **Sign out** end only your viewing session, never theirs.
- **Adding a salesperson**: a new salesperson must be **pre-registered at the sales tier before they are invited** — an unregistered @alpharoc.ai address signs up as a full analyst and sees every budget and price. A salesperson can also be pointed at **another salesperson's book** (their row in the salespeople table names whose book they work): they sign in with their own login and see exactly that person's accounts and surveys, with the page header saying whose book it is. John Farrall works Alex Pinsky's book this way until he has accounts of his own. When he does, clear the pointer and add him to the project salesperson list.
- **Client pages**: click any client on the Admin page — or the client name on a project page — to see that client's full picture: client since, open/closed project counts, average spend per project, how often they come back, a **Contacts** roster you can add to and edit (the people who request this client's surveys — pick one as a project's "Requested by"; deleting archives a contact so it leaves the picker but stays on past projects), a **Notes** log (free-text notes about the client — each a dated, attributed bullet, newest first), every project (click one to open it), a **Compliance** card to set that client's review requirements, and **Name as printed on client documents** — the name a salesperson's statement and survey list print after "Prepared for" and in every page footer. Leave it blank and the documents print the internal name; set it when the client's own name is different from the one we file them under (see §7d).

## 7b. Compliance guardrails

Some clients (the financial ones) require their compliance team to sign off before a survey goes out. The tracker enforces this so nothing is fielded or delivered prematurely.

- **Tag the client** (Admin → Accounts shows a 🛡 Compliance chip, or set it on the client page): **before fielding** (the client reviews the *questions* before the survey goes live) and/or **after fielding** (they review the *questions + results* before delivery), plus the compliance contact email(s). Seeded from the sheet's Compliance tab; editable in the app.
- **The guardrails**: a before-fielding client can't be moved into **Fielding** until the questionnaire review is **approved**; an after-fielding client can't be marked **Delivered** until the results review is approved. If you genuinely need to proceed, you can **override with a reason** (recorded on the project).
- **How review happens**: it reuses the compliance portal — the contact gets an emailed link and approves/rejects. On a project page, the **Compliance Review** panel handles "Submit questions" (before) and "Send results to compliance" (after, available once N Actual is in). A banner flags any outstanding review.

## 7c. Occam invite check (before first delivery)

Clients view their data in Occam, so a new contact needs their Occam welcome email + a sign-in *before* they can open a deliverable. The tracker checks this the **first time** you deliver to a project's **Requested-by contact**.

- **When it fires**: as you mark a project **Delivered** (checkbox row or the command-bar dots), if that project's Requested-by contact hasn't been confirmed as invited to Occam yet, a prompt asks whether the invite was sent. Choose **"Yes, invite sent — deliver"** (records it) or **"Deliver anyway…"** (needs a reason, recorded on the project). It only asks **once per contact** — after that, every future project for them delivers without the prompt. Projects with no Requested-by contact aren't gated. This is independent of the compliance gate; a first delivery for a compliance client will show both prompts in turn.
- **Pre-mark people already onboarded**: on a client page, each contact row has an **"Occam ✓"** chip and a **"Mark Occam invited" / "Unmark Occam"** toggle — use it to flag contacts who already have their Occam account so their next delivery skips the prompt.
- **Via Claude**: the connector's delivery tool enforces the same check — it will ask you to confirm the invite before it marks a first delivery.

## 7d. Client documents — the statement and the survey list

Salespeople send clients two printed documents, both produced by the app and both designed to be saved as a PDF from the browser's own print dialog:

- **Study Activity Statement** — one account, opened with **Export PDF** on that account's page.
- **Study List** — whatever the sales studies list is showing (same group, filters and search), opened with **⎙ Export** above the list.

**What the statement carries:** a masthead with the account name, the statement date, the period covered, the contract in force and the client's AlphaROC contact; a **contract summary** (credits drawn, and the balance against the allowance); an **activity summary** (studies delivered, final responses); the **study ledger** — study and audience, Requested by, Status, Target, Final and Credits, with group subtotals and a total (plus **Ref.**, our PR number, if you tick it); and the **notes** that explain any mark in the table. Every page carries a footer: *AlphaROC · Confidential · Prepared for the account name* on the left, the document name, the date and *Page n of N* on the right. A list covering more than one account is an **internal** document: it prints marked Internal, never says "Prepared for", and is not for sending to a client.

**No dollar figure reaches either document.** Credits are counts; what a credit is worth, what we spend, what we charge and our internal targets stay inside the analyst and finance pages.

### Choosing what prints

By default **everything prints except two things you can add**: our **PR numbers** (the Ref. column) and the **final estimate**. To change it for one print:

1. Open the document (**Export PDF** on an account, or **⎙ Export** on the surveys list). It opens in a new tab with a **pre-send panel** at the top — that panel is on screen only and never prints.
2. In the panel's **What prints** box, untick any **column** (Requested by, Status, Target, Final, Credits — plus Account on a multi-account internal list) or any **section** (Contract summary, Activity summary, Notes). The page below changes at once, so you are always looking at what will come out.
3. Two ticks work the other way round — they are **off until you turn them on**:
   - **Ref. (PR number)** — our project number, PR00494 and the like. It is an internal code, so a client has nothing to match it against unless we have quoted it to them.
   - **Final estimate** — for a study still in quality review, a projected final count (*≈ 480 est.*) in the Final column instead of a dash. It is a projection from how past studies of ours finished against target, **not a measured figure**, so the pre-send panel tells you how many rows carry one before you print. When it is off, the panel still tells you there was something it could have shown.
4. **Study and audience** is shown ticked and greyed out: it always prints, because a row without it matches nothing the client holds.
5. Click **Save as my default** to make the current ticks your starting point for that kind of document, or **Reset to system default** to put every tick back where it started and forget the saved one. A line in the box always says which is in effect — *using your saved default*, *the system default*, *the choice in this link*, or *changed for this print only*.
6. Print or save as PDF. The print dialog opens by itself once the **"Check before sending"** list at the top is empty; while something is still on that list, read it first and print by hand.

**Things worth knowing:**

- Your saved default lives **in your browser** (so it doesn't follow you to another machine), and **statements and study lists keep separate defaults**. It remembers what you turned off *and* what you turned on, so a saved default can include the PR numbers. If the browser refuses to save it — a private window, or blocked site data — the panel says so and the print still uses your choice.
- The **address bar carries your choice**, so a copied link reproduces the same print. An older export link still prints what it always did.
- **Totals follow the columns.** Turn off Target and no target or percentage is stated anywhere, including the summary; turn off Credits and the credit total goes with it. A subtotal that would hold no figure is left out rather than printed empty, and the "Responses" banner only appears when it has more than one column to group.
- **Notes and their marks follow too** — a note prints only while something on the page still needs it, so the numbering never points at a figure that isn't there.
- A **note, never a block**, appears if you print Final without Target: the client then has no way to check the final count against what they bought.
- The **column picker on the screen behind it does not carry over** to the PDF. The printed document has its own "What prints" box; both screens' tooltips say so.
- The name printed after "Prepared for" and in the footer comes from the client page's **Name as printed on client documents** (§7). A salesperson can also type one for a single print, in the pre-send panel.

## 8. Tips

- Hover almost anything — (i) icons and labels explain every field, stage, and badge
- Light/dark/system theme: the toggle at the top right
- Works on phones at the same address with the same login
- Made a mess? Nothing here is truly lost: closed projects reopen, deleted bids have ↺ Undo, checked steps uncheck, and the data change log keeps the paper trail
- Signing in? Enter your @alpharoc.ai username and click "Email me a sign-in link" — open the emailed link on the same device. No password needed, and you stay signed in on that device afterwards. (If you're brand new and it says "no account yet," ask an admin to add you in Supabase → Auth → Users.)

## 9. Deliverables

The **deliverables depository** is a central store for final client deliverables — toplines, data files, links to Occam reports or Edwin surveys, or anything else you send to a client at the end of a project. Every file or link gets filed into the correct folder on the company Shared Drive and indexed here so they're easy to find later.

### Attaching a file or link

On any project page, open the **Deliverables** tab:

- **File:** click **+ Attach deliverable** and pick a file — it uploads and files immediately.
- **Link:** paste a URL (Occam, Edwin, Google Sheet, anything) into the link box and click **Add link**. Google-native links (Docs, Sheets, Drive) are stored as Drive shortcuts; other links are saved as bookmark files.

If you attach something that was already filed for the same project, the app says "Already filed — skipped" and doesn't create a duplicate.

### Where files land in Drive

Files go into the Shared Drive under:

```
Client name (ClXXXXX) / ProjectName_PR#####_YYYY.MM.DD   ← one-shot project (date-stamped folder)
Client name (ClXXXXX) / ProjectName_PR#####              ← rerun (one parent folder for all waves)
```

For a one-shot project the folder is date-stamped (the project's delivery date, or today). For a **rerun** (a project flagged *longitudinal*), every wave shares **one undated parent folder** and each wave lands inside it as its own dated file (`YYYY.MM.DD — filename`) — so a weekly or monthly tracker doesn't spawn a new folder every time. Low-confidence items (not yet tied to a project) are staged in `00_Needs Review` at the drive root until resolved.

> **Tip:** name the deliverable file with the client and study (e.g. `holocene_ai_tracker_survey_0715.xlsx`). The auto-filer treats the **client name in the filename** as the strongest signal, so a clearly-named file lands in the right client's folder even when another client happens to have a similarly-named project.

### Emailing deliverables (bcc / cc / forward)

You don't have to open the app to file a deliverable. When you send the final files/links to a
client, just **bcc, cc, or forward** that email to **deliverables@alpharoc.ai**.

- The system reads the **client you sent to** (the external recipient) plus the subject/body to
  figure out the client and project, then files every attachment and deliverable link into the
  client's `Client / {Project}_{PR#####}_{date}` Shared Drive folder.
- Put the **project code (e.g. PR00003) in the subject** for a near-certain match.
- You'll get a quick **"Filed ✓"** reply listing each item and its Drive link. If we couldn't tell
  which client/project it belonged to, the reply says **"Needs a quick review"** with a link to the
  **Deliverables → Review queue**.

### The Review queue

Open the **Deliverables** tab in the top nav. Anything emailed in that we couldn't auto-file to a single
client + project shows here with our best guesses (High / Med / Low confidence). Click a guess to
file it, pick another project from the dropdown, or mark it **"Not a deliverable"** to dismiss it.
Items already filed under the right client but with no project show as **unsorted** — assign a
project the same way.

### Weekly QA digest

Every **Monday morning** a deliverables QA digest is **emailed to you** (and also posts to Slack if a QA webhook is configured) so nothing slips through the cracks. It opens with an **email-pipeline health check** — when the last forward was ingested, and a ⚠️ if any forwards were rejected that week (e.g. a stale secret) — then flags:
- **Aging in review** — items sitting in the queue over a week without being filed or dismissed.
- **Auto-files to spot-check** — the week's AI-matched and lower-confidence filings, so someone can eyeball that they landed on the right survey.
- **Possible duplicates** and **unsorted** items (filed with no project).
- **Recently delivered, nothing filed** — projects delivered in the last month with no deliverable in the depository (a nudge to forward them), plus a one-line tally of what was filed that week.

If everything's tidy, it just says the depository is clean.

## 9b. Email activity timeline

Client emails are logged automatically to each project's **Activity** panel, so there's a clean, chronological record of what was said and when — nobody has to copy anything out of Gmail.

**Setup (once per captain):** **More → Connect your Claude → Email capture setup** — verify the forwarding address and import your filter set. **How it decides where an email goes:**
- **Auto-logged** when it's confident: the email mentions a project code (PR#####) or a survey ID, or it's from a known client contact and clearly about one project (its name is in the email, or the client has just one active project).
- **Sent to Email Review** (the **Email Review** tab) when it's unsure — e.g. a client with several active projects and nothing in the email says which one. Open the queue and file each email to the right project with one click, or **Ignore** it. Confident emails skip review entirely.

**On the project page:** the **Activity** tab lists emails newest-first — click one to expand the full message, use **open in Gmail** to jump to the original, and use the **search box** to find a specific email by subject, body, or person.

**Ask Claude:** with the connector you can ask things like *"find the email where Coatue approved the budget"* — it searches the activity log and can pull up the full message.

**Privacy:** only mail from a known client contact or domain is ever forwarded — and it's a copy, so your own inbox is untouched. Personal / HR / finance mail is never captured. Delivered and on-hold projects aren't treated as "open," and a project keeps logging email for 2 days after it's marked delivered (to catch stragglers), then stops.

## 10. Connect your Claude

The **Connect your Claude** page (`/connect`, under **More** in the top nav) links Survey Ops to Claude — claude.ai,
Claude Desktop, or Claude Code — so you can ask about your projects and set reminders straight
from a chat, using your own login. Analyst-only.

**Connector URL:** `https://survey-ops-tracker.vercel.app/api/mcp`

**⚠ The account gotcha:** the connector only works with your **@alpharoc.ai analyst account** —
not a personal Gmail, and not a compliance/client portal login. When you click "Log in" during
setup, make sure the Survey Ops sign-in step uses your @alpharoc.ai email. See "If you see 'Wrong
account'" below if you get stuck.

### claude.ai (web & mobile)

1. Go to **Settings → Connectors**.
2. Click **"Add custom connector"**.
3. Paste in the connector URL above.
4. Click **"Log in"** — this opens the Survey Ops login screen.
5. Sign in with your **@alpharoc.ai analyst account**.
6. On the consent screen, click **"Allow"**.

Requires a paid Claude plan (Pro, Max, Team, or Enterprise). On a Team or Enterprise plan, an
admin may need to add the connector organization-wide before you can use it.

### Claude Desktop

Same flow as claude.ai: **Settings → Connectors → Add custom connector**, paste in the same
connector URL, click **"Log in"**, sign in with your @alpharoc.ai account, then **"Allow"**.

### Claude Code

Run this from a terminal:

```
claude mcp add --transport http survey-ops https://survey-ops-tracker.vercel.app/api/mcp
```

It'll open a browser to log in the same way — sign in with your @alpharoc.ai account and click
"Allow".

### If you see "Wrong account"

If you're already signed into a browser as a personal Gmail or a compliance login, the consent
screen will show a **"Wrong account"** page instead of the normal "Allow" prompt. To fix it:

- Click **"Sign in with a different account"** on that page, then sign in as your @alpharoc.ai
  analyst account.
- If your browser keeps **autofilling the wrong account** and you can't shake it, the reliable
  fix is to open an **incognito/private window**, go to claude.ai there, and sign in fresh as
  your @alpharoc.ai account before retrying the connector setup.

**What you can ask:** *"What's due this week?"* · *"Give me the status on SPCX"* ·
*"Remind me Friday to chase the deliverable"* · *"What are my open reminders?"* — it reads live
project data the same way the in-app Assistant does, plus your personal reminders.

**Reminders:** anything you set through Claude shows up as an emailed reminder on the morning
it's due — nothing to check manually.

### What you can ask Claude to do & recall

Beyond reading, Claude can now make changes and pull up history for you — still only with your
**@alpharoc.ai analyst account**.

**Things you can ask it to do:** *"Log a 500-count blast on PR00123"* · *"Push PR00119's due date
to next Friday"* · *"Mark the questionnaire next-step done on the Coatue tracker"* · *"Create a
B2B project for Coatue, 500 responses, due July 20"* · *"Add Jane Smith as a contact at
Meridian."*

- **Nothing changes silently.** Any ask that would change or create a record gets a preview
  first — the exact fields, old → new — and Claude waits for your explicit OK before it writes
  anything.
- **It can't get around the rules.** A compliance gate stops it the same way it stops the app —
  it'll tell you and ask for an override reason rather than push through. It also can't touch
  **internal projects**, and it can't **delete** or **merge** anything.
- **Creating a project walks the essentials.** When you ask it to add a survey, Claude runs a quick
  intake — client, name, captain, type, salesperson, requested-by, due date, N, audience, budget,
  longitudinal, and whether it's approved for the open pipeline or still in scoping — asking for
  anything you skip and offering *"Not sure / will fill it in later"* so nothing blocks you. A
  **captain is required**; if that person isn't on the roster yet, Claude can add them (with your OK
  and their @alpharoc email).

**Things you can ask it to recall:** *"What did we do last time for Coatue?"* · *"What's overdue
for me?"* · *"How did last quarter's wave compare?"* · *"How many PS surveys launched in July?"* ·
*"Give me an Excel of everything delivered in Q2"* · *"What's at risk right now?"* · *"Which open
projects have Alex Pinsky as sales?"* · *"What changed on PR00123?"* — it can pull period counts, a
downloadable report, a risk triage, filtered project lists, and a project's field-change history.
If you ask what questions were asked last time, Claude hands the linked questionnaire doc over to
your Drive connector rather than guess at the content.

**Corrections:** logged blasts are editable by Claude — it can fill in the completes once they
come in, change the $/bid, people, date or description, or remove a blast entirely (all
preview-then-confirm). Ask it to leave a figure out rather than guess: unrecorded and 0 are
stored as different things, and Claude will tell you when a project's blast spend is a floor
because some blast still has no cost recorded. *(Manual **bids** are still app-only.)*

**Revoking access:** the Connect page lists every Claude currently connected (device/client name,
when it connected, when it was last used) with a **Revoke** button — click it to sign that Claude
out immediately; it'll need to log in again to reconnect.

---

*Maintained by Claude alongside the app — when features change, this guide changes. Source of truth lives in the project repo (USER_GUIDE.md).*
