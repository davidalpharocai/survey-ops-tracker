# Survey Ops Command Center — User Guide

*Last updated: June 12, 2026. The team's tracker for survey projects from first inquiry through delivery.*

**Finding this guide later:** the top navigation bar's **More** menu links straight here, along with the Systems & Handover doc.

**App:** https://survey-ops-tracker.vercel.app
**Sign in:** passwordless. Enter your **@alpharoc.ai** username on the login page (the domain is fixed, so only company accounts can get in) and click **"Email me a sign-in link"** — you'll get a one-tap magic link. Open it **on the same device** you requested it from to finish signing in. No password to set or remember.

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
A compact three-zone strip: **N collected** (accented, click to edit) · a **Dates** tile holding all the project dates inline — **Submitted, Launch, Due (internal), Deliver (client)**, plus **Rerun** for longitudinal studies — each click-to-edit, with Due showing its urgency color and Deliver spelling out the buffer ("same day as due", "2d buffer", or a ⚠ if delivery is set before the internal due date) · and a compact **Waiting on** (computes itself from the stage checkboxes — use "Blocked by" to override when stuck on the client or on us). Budget now lives in the Money card, not the hero.

### Tabs
- **Overview** — everything below
- **Activity** — logged emails and events for the project (click one to expand and read; the search box finds a specific email by subject, body, or person). See §9b.
- **Deliverables** — the final client deliverables filed for this project. See §9.
- **Links** — Survey IDs (auto-synced nightly from the Edwin link; mismatches get flagged for review), Slack channel link, notification info. (Survey IDs also stay pinned to the top-right of the tab row so they're always in view.)
- **Logs** — two histories in one place: the **Data Change Log**, where engineers log manual data edits ("removed 4 speeders from SV-2201"; date + author stamped, edit/delete with confirmation), and the automatic **Audit Log** — every field change on the project (who changed what, when, and the old → new value; "system" means an automated update like the nightly Edwin sync). You don't write to the Audit Log — the system records it for you.

### Left column
- **Pipeline progress** — check off stages (this moves the card on the board)
- **Linked Documents** (shown first) — paste any URL (its document title fills in automatically), rename via the ✎ or remove via the ✕ (this only unlinks it — the file stays in Drive); questionnaire/Edwin/data sheet links live here
- **Latest / Next Steps** — add to-dos (Ctrl+Enter saves); check one off and it moves to the "Latest" log with date + who (old imported notes live under "History"). It sits below Linked Documents so a long notes log can't push the documents down the page
- **Compliance Review** — appears only when the client requires a review (before and/or after fielding) or a review has already been submitted (see §6)

(Changes in plain English are handled by the connector now — ask your Claude to make edits instead of a per-page box.)

### Right sidebar
Titled groups: **People** (spans the full sidebar width so names aren't clipped — client, the **Requested by** contact, captain + optional co-captains, salesperson from a dropdown), **Sample N & Audience** (N target, internal target, collected, actual, audience size), **Flags** (click a chip to toggle), **Money** (by project type first: **PS** shows **Suppliers** — the PureSpectrum sample suppliers, each with a $ / complete (CPI) and a completes cap, plus an estimated cost = Σ cap×CPI; **B2B** shows **Blast Configuration** — create a blast with its $/bid + per-respondent reward + optional schedule, then mark it sent, at which point its cost (incl. incentive) counts toward spend — then the **Budgets** section beneath: Total budget + computed Actual $ / cost-per-complete / budget-used). Most projects have one captain; "+ add" under Co-Captains shares a project, and shared projects show "+1" on their board card. Project dates now live in the hero strip at the top, not the sidebar.

**Requested by** is the client contact who asked for the survey. Click it to pick from that client's people or add a new one inline (first + last name required; email/title/phone optional), and click a chosen name to view or edit their details. Manage the full roster — and archive/delete contacts — on the client page.

### Header buttons
**⚑ Priority** (cycles none → high → urgent) · **⏸ Hold** (pauses; card greys out, sinks to column bottom; Resume brings it back) · **✕ Close** (done/archived — lives in Full View's Closed section, reopenable) · **🗑 Delete** (asks you to type "delete"; the project moves to Admin → Recently Deleted and can be restored — it's not gone for good unless you delete it permanently from there) · **Merge…** (fold a duplicate of this project into it — see *Merging duplicates* in §7)

## 4. The List view

A sortable table of all projects (click column headers to sort — the header stays frozen as you scroll). It has the **same filters as the board** (Captain, Type, Due, Stage, search). **⚙ Columns** lets you hide columns you don't use — your choice is personal (saved in your browser) and doesn't affect teammates. **Saved views** here remember the whole table setup — Operations/Full, filters, which columns are showing, and the sort — under a name you pick; ⟳ Update, ✎ rename, and 🗑 delete them just like board views. Rows carry the same colored due-date edge as board cards (red overdue, orange tomorrow, amber in 2 days; dropped once a project is closed). **⬇ Export CSV** downloads whatever is currently shown, with every field regardless of hidden columns.

## 4b. The Calendar

Open the **Calendar** tab in the top nav to see everything dated on one **month grid** (‹ / › to change month, **Today** to jump back). Each day shows its events as color-coded chips; a busy day shows the first few plus **＋N more** (click the day to see them all), and clicking an event opens that project.

**What's on it** (each colour is a type, and the legend toggles each on/off): **Due** (internal) · **Deliver** (client) · **Launch** · **Rerun** (next wave of a longitudinal study) · **Reminder** (your own). Due and Deliver keep the overdue/soon colour.

**Filters** (remembered per person): **Captain**, **Type** (PS / B2B / Rerun — so Sree can isolate reruns), **Just mine**, **Client**, **Priority**, and **Status** — by default it shows **only open, active projects**; tick to also include On-Hold, Closed, or Scoping. On a phone it switches to a chronological agenda list.

## 5. The AI Assistant

[screenshot: assistant panel]

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
- **Voter QA + Citation flags** auto-set when the salesperson is Jenna or the project/client mentions "vote"
- **Morning digest** posts to Slack at 8am ET: overdue, due-soon, and behind-pace projects
- **Legacy sheet sync** (migration period): new PS/B2B projects and their changes are mirrored into the old "Surveys" Google Sheet automatically, so the team keeps seeing current data there while everyone moves onto SOCC
- **Live updates**: teammates' changes appear on your screen within a second — no refreshing
- **If a save ever fails**, a message pops up bottom-left and the change safely reverts — nothing is ever half-saved

## 7. Project IDs & Admin

- Every project has a permanent **Project ID** like `PR00042` — shown next to the project title and in the list view, included in CSV exports, and assigned automatically to new projects. It never changes, so use it when referencing a project in email or Slack. Clients have matching `Cl#####` ids.
- **Merging duplicates**: if the same project (or client) got entered twice, open either copy and click **Merge…** in the header, search for the duplicate, and you'll get a preview. Pick which record **survives**, resolve any **fields that differ** (dates, N, budget, etc. — matching fields are hidden), and everything else — bids, blasts, next steps, deliverables, contacts, notes, activity and audit history — **combines** onto the survivor. The other record is **soft-deleted** to Recently Deleted (recoverable). Analyst-only. Two caveats: a project whose N is **split into segments** must be un-split first; and merging two **clients** doesn't auto-merge their duplicate *projects* — merge those separately.
- The **More → Insights** page (top nav) rolls up the whole pipeline: active/scoping/closed counts, overdue and due-this-week, on-time delivery %, average cycle time, stage distribution, per-captain workload, budget vs spend, and top clients — all derived live from your projects.
- The **☰ menu → Internal Projects** page is a separate home for AlphaROC's own work (product, ops, hiring, tooling), kept entirely apart from survey projects. It's a sprint-based **Backlog → In Progress → Review → Done** board: "+ New internal project" defaults the client to AlphaROC, each project has an Owner, Category, Objective, a Sprint (a 2-week window — set the cadence in **Admin → Sprint cadence**), and a Next Steps checklist instead of survey N tracking. No survey fields, and internal projects never appear on the survey board, list, insights, or digest.
- The **☰ menu → Admin** page is organized into tabs — **Overview** (systems links, system status, AI usage, data health), **Accounts & Team**, **Operations** (sprint cadence, recently deleted), and **Audit Log** — and has: links to every system behind the tracker (including Supabase Users for password resets), a **System status** panel (shows whether the automated backend jobs — the nightly Slack digest and the survey-ID sync — ran cleanly, with any failures listed; the same failures also show up in the daily Slack digest), an **AI usage** panel (what the assistant chat and AI project entry have cost this month, with an editable monthly budget and an optional "hard stop" that pauses AI features when the budget is reached), **Recently Deleted** (restore a project you deleted by mistake, or delete it permanently), a **master audit log** (every field change across all projects — who, when, old → new, including deletes and restores, with the project linked), the client list with their ids, the team roster, and a data-health checklist (open projects missing a captain or due date).
- **Client pages**: click any client on the Admin page — or the client name on a project page — to see that client's full picture: client since, open/closed project counts, average spend per project, how often they come back, a **Contacts** roster you can add to and edit (the people who request this client's surveys — pick one as a project's "Requested by"; deleting archives a contact so it leaves the picker but stays on past projects), a **Notes** log (free-text notes about the client — each a dated, attributed bullet, newest first), every project (click one to open it), and a **Compliance** card to set that client's review requirements.

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
- Signing in? Enter your @alpharoc.ai username and click "Email me a sign-in link" — open the emailed link on the same device. No password needed. (If you're brand new and it says "no account yet," ask an admin to add you in Supabase → Auth → Users.)

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

Every **Monday morning** a deliverables QA digest posts to Slack (its own QA channel) so nothing slips through the cracks. It flags:
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
for me?"* · *"How did last quarter's wave compare?"* If you ask what questions were asked last
time, Claude hands the linked questionnaire doc over to your Drive connector rather than guess
at the content.

**Corrections:** if a logged blast needs fixing, do that in the app — Claude can log new
ones but won't edit or delete an existing entry.

**Revoking access:** the Connect page lists every Claude currently connected (device/client name,
when it connected, when it was last used) with a **Revoke** button — click it to sign that Claude
out immediately; it'll need to log in again to reconnect.

---

*Maintained by Claude alongside the app — when features change, this guide changes. Source of truth lives in the project repo (USER_GUIDE.md).*
