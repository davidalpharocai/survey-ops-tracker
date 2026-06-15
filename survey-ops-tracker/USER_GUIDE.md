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
- **Audit Log** — automatic history of every field change on this project: who changed what, when, and the old → new value. You don't write to it — the system records it for you ("system" means an automated update like the nightly Edwin sync).
- **Links & setup** — Survey IDs (auto-synced nightly from the Edwin link; mismatches get flagged for review), Slack channel link, notification info

### Left column
- **Pipeline progress** — check off stages (this moves the card on the board)
- **Latest / Next Steps** — add to-dos (Ctrl+Enter saves); check one off and it moves to the "Latest" log with date + who. Old imported notes live under "History."
- **Linked Documents** — paste any URL; name it via the ✎; questionnaire/Edwin/data sheet links live here
- **Activity** — logged emails and events (expand to read)
- **✦ Edit by description** — type changes in plain English ("collected is 180, due pushed to July 20"), review the before→after preview, approve

### Right sidebar
Titled groups: **People** (client, captain + optional co-captains, salesperson from a dropdown), **Dates**, **Sample** (N target/actual, audience), **Flags** (click a chip to toggle), **Money** (budget, spend, and bid history with averages). Most projects have one captain; "+ add" under Co-Captains shares a project, and shared projects show "+1" on their board card.

### Header buttons
**⚑ Priority** (cycles none → high → urgent) · **⏸ Hold** (pauses; card greys out, sinks to column bottom; Resume brings it back) · **✕ Close** (done/archived — lives in Full View's Closed section, reopenable) · **🗑 Delete** (permanent, asks you to type "delete")

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
- The **☰ menu → Admin** page has: links to every system behind the tracker (including Supabase Users for password resets), a **master audit log** (every field change across all projects — who, when, old → new, with the project linked), the client list with their ids, the team roster, and a data-health checklist (open projects missing a captain or due date).
- **Client pages**: click any client on the Admin page — or the client name on a project page — to see that client's full picture: client since, open/closed project counts, average spend per project, how often they come back, the contacts who've brought us work, and every project (click one to open it).

## 8. Tips

- Hover almost anything — (i) icons and labels explain every field, stage, and badge
- Light/dark/system theme: the toggle at the top right
- Works on phones at the same address with the same login
- Made a mess? Nothing here is truly lost: closed projects reopen, deleted bids have ↺ Undo, checked steps uncheck, and the data change log keeps the paper trail

---

*Maintained by Claude alongside the app — when features change, this guide changes. Source of truth lives in the project repo (USER_GUIDE.md).*
