# Survey Ops Command Center — User Guide

*Last updated: June 12, 2026. The team's tracker for survey projects from first inquiry through delivery.*

**Finding this guide later:** the ☰ menu in the app's top-left corner links straight here, along with the Systems & Handover doc.

**App:** https://survey-ops-tracker.vercel.app
**Sign in:** your @alpharoc.ai email + password (only company accounts can get in). Forgot your password? Ask David to reset it in Supabase.

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
- **Full View**: adds the **Scoping** board (pre-sale deals), the **Closed** section (finished projects, collapsed at the bottom), and on-hold context. Drag a scoping card down into the pipeline to approve it.

### Card colors (the key at the top explains them in-app)
- **Red border** = due today or overdue · **Orange** = due tomorrow · **Amber** = due in 2 days
- **Grey, faded, ⏸ corner badge** = on hold
- **Green border + NEW!** = a project someone just assigned to you (opens it to dismiss)
- **⚑ / ‼ chips** = high/urgent priority (those cards float to the top of their column)
- **💤 Stale?** = no dates and no updates in 30+ days — worth reviewing
- **PS / B2B / Rerun badges** = project type (PureSpectrum panel / expert panel / repeat wave)

### Filters & search
Captain, Type, Due (today/tomorrow/2 days), Stage (including Closed), and a search box (project or client name). Hover any filter label's (i) for what it does.

**Saved views**: set the filters how you like, hit ★ Save, name it ("My urgent", "Jenna's PS work") — then jump back to it from the Views dropdown anytime. After picking a view you can **⟳ Update** it to your current filters, **✎** rename it, or **🗑** delete it. Views are personal (saved in your browser). In Full View, the Scoping and Operations Pipeline sections collapse with the ▾ next to their titles — also remembered per person.

### Shortcuts
- **Ctrl+K** (or Cmd+K) — command palette: type a few letters of any project and jump straight to it; type `>` for actions
- **/** — jump to the search box
- **N** — new project (on the board)

## 2. Creating a project

Click **+ New Project** (or press N). Fill the form — or use the **✦ Describe it** box: type something like *"New B2B for Meridian, Tom sold it, Priya captain, 200 responses, due July 15, budget 15k"* and AI fills the form for your review. Check "Already approved" to skip scoping and land straight in the pipeline.

New projects normally start in **Scoping** (New Inquiry → Proposal Sent → Pricing Discussion → Awaiting Approval). Approve a deal by dragging its card into the pipeline, or with the green button on its project page. It works in reverse too — if a deal reopens, drag the card back onto a scoping column (Full View), or use "↩ Back to Scoping" on the project page; pipeline progress is kept in case it gets re-approved.

## 3. The project page

[screenshot: project page Overview]

### Hero stats (top)
Four big tiles: **N collected** (click to edit), **Timing** — Due (internal: when our work must be done) and Deliver (client: when they need it in hand) side by side, with the buffer between them spelled out ("same day as due", "2d buffer", or a ⚠ if delivery is set before the internal due date; both dates click-to-edit) — **Budget left** (with cost per response), and **Waiting On** (computes itself from the stage checkboxes — use "Blocked by" to override when stuck on the client or on us).

### Tabs
- **Overview** — everything below
- **Data Change Log** — engineers log manual data edits here ("removed 4 speeders from SV-2201"); date + author stamped, edit/delete with confirmation
- **Links & setup** — Survey IDs (auto-synced nightly from the Edwin link; mismatches get flagged for review), Slack channel link, notification info
- **Audit Log** (last tab) — automatic history of every field change on this project: who changed what, when, and the old → new value. You don't write to it — the system records it for you ("system" means an automated update like the nightly Edwin sync).

### Left column
- **Pipeline progress** — check off stages (this moves the card on the board)
- **Latest / Next Steps** — add to-dos (Ctrl+Enter saves); check one off and it moves to the "Latest" log with date + who. Old imported notes live under "History."
- **Linked Documents** — paste any URL; name it via the ✎; questionnaire/Edwin/data sheet links live here
- **Activity** — logged emails and events (expand to read)
- **✦ Edit by description** — type changes in plain English ("collected is 180, due pushed to July 20"), review the before→after preview, approve

### Right sidebar
Titled groups: **People** (client, captain + optional co-captains, salesperson from a dropdown), **Dates**, **Sample** (N target/actual, audience), **Flags** (click a chip to toggle), **Money** (budget, spend, and bid history with averages). Most projects have one captain; "+ add" under Co-Captains shares a project, and shared projects show "+1" on their board card.

### Header buttons
**⚑ Priority** (cycles none → high → urgent) · **⏸ Hold** (pauses; card greys out, sinks to column bottom; Resume brings it back) · **✕ Close** (done/archived — lives in Full View's Closed section, reopenable) · **🗑 Delete** (asks you to type "delete"; the project moves to Admin → Recently Deleted and can be restored — it's not gone for good unless you delete it permanently from there)

## 4. The List view

A sortable table of all projects (click column headers to sort — the header stays frozen as you scroll). It has the **same filters as the board** (Captain, Type, Due, Stage, search). **⚙ Columns** lets you hide columns you don't use — your choice is personal (saved in your browser) and doesn't affect teammates. **Saved views** here remember the whole table setup — Operations/Full, filters, which columns are showing, and the sort — under a name you pick; ⟳ Update, ✎ rename, and 🗑 delete them just like board views. Rows carry the same colored due-date edge as board cards (red overdue, orange tomorrow, amber in 2 days; dropped once a project is closed). **⬇ Export CSV** downloads whatever is currently shown, with every field regardless of hidden columns.

## 5. The AI Assistant

[screenshot: assistant panel]

The **✦ Assistant** button (bottom-right) answers questions from live project data, logged emails, next steps, and the data change log:
- *"What's due this week?"* · *"What's at risk?"* (leads with deadline/collection risk)
- *"Any recent emails on SPCX?"* · *"What data changes were made this month?"*
- *"Decode ALBNFOF20260529UK"* (it knows the survey ID format)

## 6. Things that happen automatically

- **Survey IDs** sync nightly (~6:45pm ET) from each project's Edwin link; conflicts show an amber review banner on the project
- **Voter QA + Citation flags** auto-set when the salesperson is Jenna or the project/client mentions "vote"
- **Morning digest** posts to Slack at 8am ET: overdue, due-soon, and behind-pace projects
- **Live updates**: teammates' changes appear on your screen within a second — no refreshing
- **If a save ever fails**, a message pops up bottom-left and the change safely reverts — nothing is ever half-saved

## 7. Project IDs & Admin

- Every project has a permanent **Project ID** like `PR00042` — shown next to the project title and in the list view, included in CSV exports, and assigned automatically to new projects. It never changes, so use it when referencing a project in email or Slack. Clients have matching `Cl#####` ids.
- The **☰ menu → Insights** page rolls up the whole pipeline: active/scoping/closed counts, overdue and due-this-week, on-time delivery %, average cycle time, stage distribution, per-captain workload, budget vs spend, and top clients — all derived live from your projects.
- The **☰ menu → Internal Projects** page is a separate home for AlphaROC's own work (product, ops, hiring, tooling), kept entirely apart from survey projects. It's a sprint-based **Backlog → In Progress → Review → Done** board: "+ New internal project" defaults the client to AlphaROC, each project has an Owner, Category, Objective, a Sprint (a 2-week window — set the cadence in **Admin → Sprint cadence**), and a Next Steps checklist instead of survey N tracking. No survey fields, and internal projects never appear on the survey board, list, insights, or digest.
- The **☰ menu → Admin** page is organized into tabs — **Overview** (systems links, system status, AI usage, data health), **Accounts & Team**, **Operations** (sprint cadence, recently deleted), and **Audit Log** — and has: links to every system behind the tracker (including Supabase Users for password resets), a **System status** panel (shows whether the automated backend jobs — the nightly Slack digest and the survey-ID sync — ran cleanly, with any failures listed; the same failures also show up in the daily Slack digest), an **AI usage** panel (what the assistant chat and AI project entry have cost this month, with an editable monthly budget and an optional "hard stop" that pauses AI features when the budget is reached), **Recently Deleted** (restore a project you deleted by mistake, or delete it permanently), a **master audit log** (every field change across all projects — who, when, old → new, including deletes and restores, with the project linked), the client list with their ids, the team roster, and a data-health checklist (open projects missing a captain or due date).
- **Client pages**: click any client on the Admin page — or the client name on a project page — to see that client's full picture: client since, open/closed project counts, average spend per project, how often they come back, the contacts who've brought us work, every project (click one to open it), and a **Compliance** card to set that client's review requirements.

## 7b. Compliance guardrails

Some clients (the financial ones) require their compliance team to sign off before a survey goes out. The tracker enforces this so nothing is fielded or delivered prematurely.

- **Tag the client** (Admin → Accounts shows a 🛡 Compliance chip, or set it on the client page): **before fielding** (the client reviews the *questions* before the survey goes live) and/or **after fielding** (they review the *questions + results* before delivery), plus the compliance contact email(s). Seeded from the sheet's Compliance tab; editable in the app.
- **The guardrails**: a before-fielding client can't be moved into **Fielding** until the questionnaire review is **approved**; an after-fielding client can't be marked **Delivered** until the results review is approved. If you genuinely need to proceed, you can **override with a reason** (recorded on the project).
- **How review happens**: it reuses the compliance portal — the contact gets an emailed link and approves/rejects. On a project page, the **Compliance Review** panel handles "Submit questions" (before) and "Send results to compliance" (after, available once N Actual is in). A banner flags any outstanding review.

## 8. Tips

- Hover almost anything — (i) icons and labels explain every field, stage, and badge
- Light/dark/system theme: the toggle at the top right
- Works on phones at the same address with the same login
- Made a mess? Nothing here is truly lost: closed projects reopen, deleted bids have ↺ Undo, checked steps uncheck, and the data change log keeps the paper trail

## 9. Deliverables

The **deliverables depository** is a central store for final client deliverables — toplines, data files, links to Occam reports or Edwin surveys, or anything else you send to a client at the end of a project. Every file or link gets filed into the correct folder on the company Shared Drive and indexed here so they're easy to find later.

### Attaching a file or link

On any project page, scroll to the **Deliverables** panel in the left column:

- **File:** click **+ Attach deliverable** and pick a file — it uploads and files immediately.
- **Link:** paste a URL (Occam, Edwin, Google Sheet, anything) into the link box and click **Add link**. Google-native links (Docs, Sheets, Drive) are stored as Drive shortcuts; other links are saved as bookmark files.

If you attach something that was already filed for the same project, the app says "Already filed — skipped" and doesn't create a duplicate.

### Where files land in Drive

Files go into the Shared Drive under:

```
Client name (ClXXXXX) / ProjectName_PR#####_YYYY.MM.DD
```

The date is the project's delivery date (or today if none is set). Low-confidence items (not yet tied to a project) are staged in `00_Needs Review` at the drive root until resolved.

### Coming in later phases

- **Email forwarding:** forward a deliverable email to `deliverables@alpharoc.ai` — it routes and files automatically.
- **Weekly QA report:** a digest of what was filed, near-duplicates, and items still in the review queue.

---

*Maintained by Claude alongside the app — when features change, this guide changes. Source of truth lives in the project repo (USER_GUIDE.md).*
