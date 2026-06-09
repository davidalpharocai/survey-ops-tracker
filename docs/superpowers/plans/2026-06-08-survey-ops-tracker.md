# Survey Ops Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hosted survey operations tracker on Base44 with a kanban board, list view, AI assistant, and six Make.com integrations that replace a manual Google Sheets workflow.

**Architecture:** Base44 hosts the app (database, UI, AI assistant, user auth). Make.com handles all external integrations as independent scenarios. The two tools are loosely coupled — Base44 is the source of truth; Make reads and writes to it via API.

**Tech Stack:** Base44 (no-code app builder), Make.com (automation), Google Workspace (Sheets, Docs, Calendar, Gmail), Slack, Internal survey tool (webhook or API)

**Spec:** `docs/superpowers/specs/2026-06-08-survey-ops-tracker-design.md`

---

## Task 1: Base44 Account & Project Setup

**What this produces:** A Base44 account, a new app project, and team members invited.

- [ ] **Step 1: Create Base44 account**

  Go to [base44.com](https://base44.com) → Sign up with your work email (david@alpharoc.ai). Choose the team plan (supports multiple users).

- [ ] **Step 2: Create a new app**

  From the Base44 dashboard → "New App" → Name it **"Survey Ops Tracker"** → Select blank template (not a pre-built one).

- [ ] **Step 3: Note your app's API details**

  Go to Settings → API → Copy and save:
  - App ID
  - API Key

  Save these somewhere safe — Make.com will need them in later tasks.

- [ ] **Step 4: Invite team members**

  Go to Settings → Team → Invite each team member by email. Assign role "Member" to project captains, "Admin" to yourself and any other managers.

- [ ] **Verify:** Log out and log back in as a team member (use a test email if needed). Confirm they can see the app but cannot access Settings.

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "chore: add implementation plan for survey ops tracker"
  ```

---

## Task 2: Data Model — Team Member Entity

**What this produces:** A Team Member table that Survey Projects can link to for the Project Captain field.

- [ ] **Step 1: Create the Team Member entity**

  In Base44 → Data → "New Entity" → Name: **Team Member**

- [ ] **Step 2: Add fields**

  Add the following fields in order:

  | Field Name | Type | Notes |
  |---|---|---|
  | Name | Text | Required |
  | Initials | Text | Required. e.g. AL, AW, BF, SC |
  | Email | Email | Required |

- [ ] **Step 3: Add all current team members**

  Go to Data → Team Member → Add a row for each person on the team. Use the initials exactly as they appear in the current spreadsheet (AL, AW, BF, SC, CN, etc.).

- [ ] **Verify:** The Team Member table has one row per person, initials match the spreadsheet. You can filter/search by name.

---

## Task 3: Data Model — Survey Project Entity (Identity + Team + Timeline)

**What this produces:** The core Survey Project entity with the first three field groups from the spec.

- [ ] **Step 1: Create the Survey Project entity**

  In Base44 → Data → "New Entity" → Name: **Survey Project**

- [ ] **Step 2: Add Identity fields**

  | Field Name | Type | Configuration |
  |---|---|---|
  | Project Name | Text | Required, set as the entity's display name |
  | Client | Text | Required |
  | Type | Select | Options: PS, B2B, Rerun. Colors: PS = Blue, B2B = Purple, Rerun = Green |

- [ ] **Step 3: Add Team fields**

  | Field Name | Type | Configuration |
  |---|---|---|
  | Project Captain | Relation | Links to: Team Member. Display field: Initials |

- [ ] **Step 4: Add Timeline fields**

  | Field Name | Type | Configuration |
  |---|---|---|
  | Submitted Date | Date | |
  | Launch Date | Date | |
  | Due Date | Date | |
  | Deliver Date | Date | |

- [ ] **Step 5: Add Status fields**

  | Field Name | Type | Configuration |
  |---|---|---|
  | Status | Select | Options: Open (Green), Closed (Red). Default: Open |
  | Phase | Select | Options: Scoping (Purple), Active (Blue). Default: Scoping |

- [ ] **Verify:** Create one test Survey Project. Fill in all fields. Confirm the Type badge shows the right color, Phase defaults to Scoping, Status defaults to Open. Delete the test record.

---

## Task 4: Data Model — Survey Project Entity (Sample + Pipeline + Notes)

**What this produces:** The remaining field groups on the Survey Project entity — sample data, pipeline checkboxes, and notes/links.

- [ ] **Step 1: Add Sample fields**

  | Field Name | Type | Configuration |
  |---|---|---|
  | N Target | Number | Label: "N (Target)" |
  | N Collected | Number | Label: "N Collected". Mark as read-only in UI (no manual editing). |
  | Audience Size | Number | |
  | Row-Level Data | Checkbox | Default: unchecked |
  | Terminations | Checkbox | Default: unchecked |

- [ ] **Step 2: Add Pipeline (stage checkbox) fields**

  | Field Name | Type |
  |---|---|
  | Stage: Doc Programming | Checkbox |
  | Stage: Survey Programming | Checkbox |
  | Stage: EdWin QA | Checkbox |
  | Stage: Fielding | Checkbox |
  | Stage: Data QA | Checkbox |
  | Stage: Delivery | Checkbox |

  Name each field exactly as shown — the "Stage:" prefix groups them visually.

- [ ] **Step 3a: Add a computed Current Stage field (formula — read-only)**

  In Base44 → Add Formula field → Name: **Current Stage**

  Set the formula logic as:
  - If Stage: Doc Programming is unchecked → "Submitted"
  - Else if Stage: Survey Programming is unchecked → "Doc Programming"
  - Else if Stage: EdWin QA is unchecked → "Survey Programming"
  - Else if Stage: Fielding is unchecked → "EdWin QA"
  - Else if Stage: Data QA is unchecked → "Fielding"
  - Else if Stage: Delivery is unchecked → "Data QA"
  - Else → "Delivery"

  *(Base44's formula field uses IF/ELSE logic — map the above conditions into Base44's formula builder)*

- [ ] **Step 3b: Add a writable Board Column field (for drag-to-advance)**

  Formula fields are read-only — dragging a card on the board requires a writable field. Add:

  | Field Name | Type | Configuration |
  |---|---|---|
  | Board Column | Select | Same options as Current Stage: Submitted, Doc Programming, Survey Programming, EdWin QA, Fielding, Data QA, Delivery. Default: Submitted. |

  The board will group by **Board Column** (not Current Stage). Board Column is updated two ways:
  1. **By dragging** — Base44 updates it directly when a card is dragged
  2. **By checking a checkbox** — a Base44 automation (configured in Task 5) keeps Board Column in sync with the checkboxes

- [ ] **Step 3c: Add automation: checkbox → sync Board Column**

  In Base44 → Automations → "New Automation":
  - Trigger: Survey Project record updated AND any Stage: * field changed
  - Action: Set Board Column = Current Stage (the formula value)

  This means: checking a pipeline checkbox updates Current Stage (formula), which the automation then copies into Board Column, which moves the card on the board.

- [ ] **Step 4: Add Notes & Links fields**

  | Field Name | Type | Configuration |
  |---|---|---|
  | Latest / Next Steps | Long Text | |
  | Linked Documents | URL (multi) | Allow multiple URLs |
  | Calendar Event ID | Text | Hidden from default view (internal use only) |
  | N Last Synced | DateTime | Hidden from default view. Auto-set by Make.com sync. |

- [ ] **Step 5: Add Scoping Stage field**

  | Field Name | Type | Configuration |
  |---|---|---|
  | Scoping Stage | Select | Options: New Inquiry, Proposal Sent, Pricing Discussion, Awaiting Approval, Closed. Only visible when Phase = Scoping. |

- [ ] **Verify:** Create one test Survey Project. Check each Stage checkbox one at a time and confirm Current Stage updates correctly after each check. Check all boxes → Current Stage should read "Delivery". Delete test record.

---

## Task 5: Board View

**What this produces:** The kanban board as the app's default landing view, with columns and card layout matching the spec.

- [ ] **Step 1: Create a Board view**

  In Base44 → Views → "New View" → Select "Board" → Name it **"Board"** → Set as the default view.

- [ ] **Step 2: Set the grouping field**

  Board grouping field: **Board Column** (the writable select field from Task 4 Step 3b — NOT the formula Current Stage field)

  This creates one column per stage value: Submitted, Doc Programming, Survey Programming, EdWin QA, Fielding, Data QA, Delivery. Dragging a card directly updates Board Column; the Task 4 automation keeps it in sync when checkboxes are used instead.

- [ ] **Step 3: Configure card display**

  In the card layout settings, include these fields in order:
  1. Project Name (bold, title)
  2. Client (subtitle)
  3. Type (badge)
  4. N Collected + N Target (shown as "X / Y" with a progress bar)
  5. Latest / Next Steps (truncated to ~100 characters)
  6. Project Captain → Initials (pill badge, right-aligned)
  7. Due Date (right-aligned; color rule: red if past today, amber if within 3 days)

- [ ] **Step 4: Set card border color by stage**

  Add a color rule on cards:
  - Current Stage = Submitted → border: Blue (#3b82f6)
  - Current Stage = Doc Programming or Survey Programming → border: Amber (#f59e0b)
  - Current Stage = EdWin QA → border: Cyan (#06b6d4)
  - Current Stage = Fielding → border: Green (#10b981)
  - Current Stage = Data QA → border: Purple (#8b5cf6)
  - Current Stage = Delivery → border: White (#e2e8f0)

- [ ] **Step 5: Add filter bar**

  Add filter controls at the top of the board for:
  - Project Captain (dropdown — team members)
  - Type (dropdown — PS / B2B / Rerun)
  - Client (text search)
  - Overdue only (toggle — filters to records where Due Date < today)

- [ ] **Step 6: Set default filter for Operations mode**

  Create a saved filter named **"Operations"**:
  - Phase = Active
  - Status = Open

  Set this as the default when the view loads. This hides Scoping and Closed projects by default.

- [ ] **Step 7: Create the Full View saved filter**

  Create a second saved filter named **"Full View"** with no restrictions (shows all phases and statuses).

- [ ] **Verify:** Add two test projects — one with Phase = Active, one with Phase = Scoping. Confirm the board in Operations mode shows only the Active one. Switch to Full View filter, confirm both appear. Delete test records.

---

## Task 6: List View

**What this produces:** A sortable table view as the secondary view, accessible via a tab next to the board.

- [ ] **Step 1: Create a Table view**

  In Base44 → Views → "New View" → Select "Table" → Name it **"List"**.

- [ ] **Step 2: Configure visible columns**

  Show these columns in order:
  1. Project Name
  2. Client
  3. Type (badge)
  4. Current Stage (badge, color-coded to match board)
  5. Project Captain → Initials
  6. N Collected / N Target (shown as "X / Y")
  7. Due Date (red if overdue)

  Hide all other fields from this view.

- [ ] **Step 3: Enable sorting**

  Set default sort: Due Date ascending (soonest first).
  Enable user-sortable columns for all 7 columns.

- [ ] **Step 4: Apply same filters as Board**

  Apply the same Operations/Full View saved filters to this view so toggling works consistently across both views.

- [ ] **Step 5: Enable inline editing**

  Enable inline cell editing for: Type, Project Captain, Due Date, Status. Keep N Collected as read-only.

- [ ] **Verify:** Add 3 test projects with different due dates. Confirm they sort correctly. Edit a field inline, confirm it saves. Delete test records.

---

## Task 7: Project Detail Page

**What this produces:** The full-page view shown when a user clicks a project card, with all fields, pipeline progress, notes, and links.

- [ ] **Step 1: Open the detail page editor**

  In Base44 → Views → click the record detail icon (or "Detail View") → Edit layout.

- [ ] **Step 2: Configure the header**

  Header bar should show:
  - ← Back link (navigates to board)
  - Project Name (large, bold)
  - Type badge
  - Status badge (Open = green, Closed = red)
  - "✕ Close Project" button — sets Status to Closed
  - "+ Update" button — focuses the Latest/Next Steps input

- [ ] **Step 3: Configure the left column**

  Add these sections top to bottom:

  **Section 1 — Pipeline Progress**
  Show all 6 stage checkboxes (Stage: Doc Programming through Stage: Delivery) as a horizontal progress strip. Style: checked = green with ✓, current (first unchecked) = amber with ▶, future = gray with ○.

  Add helper text below: *"Checking a stage advances the project card on the board. Uncheck to move it back."*

  **Section 2 — Latest / Next Steps**
  - Display existing text (full, not truncated)
  - Quick-add input with placeholder: *"Add update... (auto-stamps date + your name)"*
  - Save button
  - Configure auto-stamp: on save, prepend `[YYYY-MM-DD] [User Name]: ` to the new entry and append it to the existing text

  **Section 3 — Linked Documents**
  - Show existing URLs as clickable links with a 📄 icon
  - "Paste Google Doc URL" input to add new links
  - Show date linked next to each

- [ ] **Step 4: Configure the right sidebar**

  Add these fields with their ⓘ tooltip text (hover definitions):

  | Field | Tooltip |
  |---|---|
  | Client | — |
  | Project Captain | "The team member responsible for this project end-to-end." |
  | Submitted Date | — |
  | Launch Date | — |
  | Due Date | — |
  | Deliver Date | — |
  | N Target | "Total number of survey responses you're aiming to collect." |
  | N Collected | "Responses collected so far. Auto-synced every 15 minutes — do not edit manually." |
  | N progress bar | Computed: N Collected / N Target × 100% |
  | Audience Size | "Total size of the panel or population being surveyed. Different from N (target responses)." |
  | Row-Level Data | "Whether individual respondent-level data is included in the deliverable." |
  | Terminations | "Whether any survey participants have been terminated (screened out) from the study." |

  Add a **Calendar section** below the fields:
  - Shows Launch Date and Due Date as calendar entries
  - "Sync to Google Calendar" link (triggers Make.com scenario — see Task 13)

  Add a **Notifications section** at the bottom of the sidebar:
  - Static text: "Slack alerts sent to #survey-ops when: stage advances, due date is tomorrow, N target is hit."

- [ ] **Step 5: Style Terminations warning**

  Add a conditional style rule: if Terminations = checked, show the field value in red with a ⚠ icon.

- [ ] **Step 6: Style N Collected sync staleness**

  Add a conditional style rule: if N Last Synced is more than 30 minutes ago, show a small amber badge next to N Collected: "⚠ Last synced X min ago".

- [ ] **Verify:** Open a test project. Confirm all fields are visible with tooltips. Check a Stage checkbox — confirm Current Stage updates. Add a Latest/Next Steps update — confirm date and name are auto-stamped. Check Terminations — confirm red warning appears. Delete test record.

---

## Task 8: Scoping Phase (Full View)

**What this produces:** Scoping columns visible in Full View mode above the main pipeline, with Closed projects grayed out.

- [ ] **Step 1: Create a Scoping Board section**

  In the Board view, add a second grouping section (or a second board panel) that groups by **Scoping Stage**, filtered to Phase = Scoping.

  Columns: New Inquiry, Proposal Sent, Pricing Discussion, Awaiting Approval, Closed.

  This section should only be visible when the Full View filter is active (hide it in Operations mode).

- [ ] **Step 2: Style Closed projects**

  Add a card style rule: if Status = Closed → reduce opacity to 60%, add strikethrough to Project Name.

- [ ] **Step 3: Add "Approve → Active Pipeline" action**

  On Scoping project cards, add a button: **"✓ Approve"**
  - Sets Phase → Active
  - Sets Status → Open
  - Sets Scoping Stage → (cleared)
  - Sets Current Stage → Submitted (by ensuring all pipeline checkboxes are unchecked)
  - Moves card to Active pipeline board

- [ ] **Step 4: Add visual divider**

  Between the Scoping section and the main pipeline, add a labeled divider: "── Active Pipeline ──"

  This divider is only shown in Full View mode.

- [ ] **Verify:** Create a test project with Phase = Scoping. In Operations mode — confirm it is not visible. Switch to Full View — confirm it appears in the Scoping section. Click "✓ Approve" — confirm it moves to the Active pipeline at Submitted stage, Phase changes to Active. Delete test record.

---

## Task 9: AI Assistant

**What this produces:** A chat panel accessible from the board and list views, powered by Base44's built-in AI, with read access to all project data.

- [ ] **Step 1: Enable Base44 AI feature**

  Go to Settings → AI / Integrations → Enable the AI Assistant feature. Select the AI model (use the default or GPT-4o if available — stronger reasoning for data queries).

- [ ] **Step 2: Configure the AI data context**

  In the AI settings, grant the assistant read access to the **Survey Project** entity with all fields. Do NOT grant write access — the assistant is read-only.

  Set the system prompt to:

  ```
  You are a survey operations assistant. You have read access to the team's live project data including all Survey Projects, their stages, due dates, N collected vs target, captains, and statuses.

  When answering questions:
  - "My projects" or "assigned to me" means projects where Project Captain = the logged-in user
  - "Due today" means Due Date = today's date
  - "Overdue" means Due Date < today and Status = Open
  - "At risk" means: overdue, OR Terminations = true, OR (Phase = Active AND Fielding stage is checked AND N Collected < N Target × 0.5 AND Due Date is within 7 days)
  - Always include the Project Name and Client when listing projects
  - Keep answers concise — bullet points for lists, 1-2 sentences for summaries
  - You cannot create, edit, or delete projects. If asked to do so, explain this and suggest the user update the project directly.
  ```

- [ ] **Step 3: Add suggested prompts**

  Configure 4 suggested prompts that appear when the panel opens:
  1. "What's due today that's assigned to me?"
  2. "What should I prioritize today?"
  3. "Any risks on the projects I own?"
  4. "Which in-field projects are behind on N collection?"

- [ ] **Step 4: Position the widget**

  Set the AI assistant as a floating panel button (bottom-right corner) visible on the Board and List views. Clicking opens a chat panel.

- [ ] **Verify:**
  - Create 3 test projects: one due today assigned to you, one overdue, one in Fielding with low N
  - Open the AI panel → click "What's due today that's assigned to me?" → confirm it returns only the project due today assigned to your user
  - Type "Any risks?" → confirm it returns the overdue project and the low-N fielding project
  - Type "Delete the overdue project" → confirm AI refuses and explains it's read-only
  - Delete test records

---

## Task 10: Make.com Setup

**What this produces:** A Make.com account connected to Base44, ready for automation scenarios.

- [ ] **Step 1: Create Make.com account**

  Go to [make.com](https://make.com) → Sign up → Choose a plan that supports the number of operations you need (estimate: ~10,000 operations/month for all 6 integrations).

- [ ] **Step 2: Install the Base44 connector**

  In Make.com → Connections → Search for "Base44" → Connect → Enter your Base44 App ID and API Key from Task 1.

  Name this connection: **"Survey Ops - Base44"**

- [ ] **Step 3: Connect Google account**

  In Make.com → Connections → "Google" → Connect your work Google account. Grant access to Gmail, Calendar, Drive/Docs, and Sheets.

  Name this connection: **"Survey Ops - Google"**

- [ ] **Step 4: Connect Slack**

  In Make.com → Connections → "Slack" → Connect your workspace → Grant access to post messages.

  Name this connection: **"Survey Ops - Slack"**

- [ ] **Verify:** All three connections show green "Connected" status. Send a test Slack message via Make to confirm the connection works.

---

## Task 11: Integration — Email → New Scoping Card

**What this produces:** A Make.com scenario that watches a designated inbox and auto-creates a Scoping project card when a new inquiry email arrives.

- [ ] **Step 1: Create the scenario**

  In Make.com → "Create a new scenario" → Name it: **"Email → New Scoping Card"**

- [ ] **Step 2: Add the email trigger**

  Module 1: **Gmail → Watch Emails**
  - Connection: Survey Ops - Google
  - Folder: Inbox (or a dedicated label like "Survey Inquiries" if you use one)
  - Filter: Only emails with subject containing keywords like "survey", "research", "proposal", "inquiry" (adjust to your actual email patterns)
  - Maximum results: 1

- [ ] **Step 3: Add a text parser**

  Module 2: **Text Parser → Parse Text**
  - Use regex or Base44 AI to extract:
    - Project Name: look for project/survey name in subject or body
    - Client: look for company name
    - Submitted Date: use today's date (Make's `{{now}}` variable)

  Set fallback values for all fields: if not found, use "— (from email)" as a placeholder so the card is created and someone fills it in.

- [ ] **Step 4: Create the Base44 record**

  Module 3: **Base44 → Create Record**
  - Connection: Survey Ops - Base44
  - Entity: Survey Project
  - Fields to set:
    - Project Name → parsed value (or "New Inquiry — [email subject]" as fallback)
    - Client → parsed value (or "— (check email)")
    - Phase → Scoping
    - Status → Open
    - Scoping Stage → New Inquiry
    - Submitted Date → `{{now}}`
    - Latest / Next Steps → "Auto-created from email on [date]. Subject: [email subject]. Review and fill in details."

- [ ] **Step 5: Add Slack alert for failed parsing**

  Module 4: **Router** (after Module 2)
  - Route A: Parsing succeeded → run Module 3
  - Route B: Parsing failed (Project Name is blank) → also run Module 3 with fallback values, THEN:

  Module 5 (Route B only): **Slack → Post Message**
  - Connection: Survey Ops - Slack
  - Channel: #survey-ops
  - Message: "⚠️ New inquiry email received but couldn't be parsed. A blank Scoping card has been created — please fill it in. Email subject: [subject]"

- [ ] **Step 6: Activate the scenario**

  Set schedule: Run immediately when triggered (instant trigger with Gmail webhook).

- [ ] **Verify:** Send a test email to the watched inbox with "survey proposal for [company]" in the subject. Within 2 minutes, confirm a new Scoping card appears in Base44 at "New Inquiry" stage. Check that Latest/Next Steps contains the auto-note. Then send an email with a non-parseable subject and confirm the Slack alert fires and a blank card is still created.

---

## Task 12: Integration — Google Sheets One-Time Import

**What this produces:** A one-time Make.com scenario that imports existing projects from the spreadsheet into Base44.

- [ ] **Step 1: Prepare the spreadsheet**

  Before running the import, clean up the source spreadsheet:
  - Ensure column headers exactly match (or can be mapped to) Base44 field names
  - Remove any rows that are not real projects (blank rows, header rows, notes)
  - Make a backup copy of the sheet before doing anything

- [ ] **Step 2: Create the import scenario**

  In Make.com → "Create a new scenario" → Name it: **"Google Sheets → Base44 Import (Run Once)"**

- [ ] **Step 3: Add the Sheets trigger**

  Module 1: **Google Sheets → Search Rows**
  - Connection: Survey Ops - Google
  - Spreadsheet: [your current ops tracker sheet]
  - Sheet: [the main sheet tab]
  - Column range: A:N (or however many columns you have)

- [ ] **Step 4: Map fields to Base44**

  Module 2: **Base44 → Create Record**
  - Entity: Survey Project
  - Map each spreadsheet column to the correct Base44 field:

  | Spreadsheet Column | Base44 Field |
  |---|---|
  | Project Name | Project Name |
  | Client | Client |
  | Type (PS/B2B/Rerun) | Type |
  | Submitted date | Submitted Date |
  | Launch date | Launch Date |
  | Due Date | Due Date |
  | Deliver date | Deliver Date |
  | N (target) | N Target |
  | N Collected | N Collected |
  | Audience Size | Audience Size |
  | Row-Level Data (checkbox) | Row-Level Data |
  | Project captain (initials) | Project Captain (lookup by Initials field on Team Member) |
  | Terminations (checkbox) | Terminations |
  | Latest/Next Steps | Latest / Next Steps |

  Set Phase = Active for all imported records (they're already past Scoping).
  Set Status = Open for all active records; Closed for any that are completed.

- [ ] **Step 5: Run the import once**

  Run the scenario manually (do not schedule it). Watch the execution log for errors. Fix any mapping issues and re-run if needed.

- [ ] **Step 6: Verify and disable**

  - Confirm record count in Base44 matches the spreadsheet row count
  - Spot-check 5–10 records for accuracy
  - Disable (do not delete) the scenario — keep it for reference

- [ ] **Verify:** Base44 board shows all imported projects in the correct stages. No duplicate records. Field values match the spreadsheet. The old spreadsheet is now retired — Base44 is the source of truth.

---

## Task 13: Integration — Google Calendar Date Sync

**What this produces:** A Make.com scenario that creates/updates a Google Calendar event when Launch Date or Due Date is set on a project.

- [ ] **Step 1: Create the scenario**

  In Make.com → "Create a new scenario" → Name it: **"Base44 → Google Calendar Sync"**

- [ ] **Step 2: Add the Base44 trigger**

  Module 1: **Base44 → Watch Records (Updated)**
  - Entity: Survey Project
  - Watch for changes to: Launch Date, Due Date

- [ ] **Step 3: Check if Calendar event already exists**

  Module 2: **Router**
  - Route A: Calendar Event ID field is empty → create new event
  - Route B: Calendar Event ID field has a value → update existing event

- [ ] **Step 4: Route A — Create event**

  Module 3A: **Google Calendar → Create an Event**
  - Connection: Survey Ops - Google
  - Calendar: [your shared team ops calendar]
  - Summary: "[Project Name] — [Client] (Due)"
  - Start: Due Date at 9:00 AM
  - End: Due Date at 9:30 AM
  - Description: "Project Captain: [Captain Initials]\nLaunch Date: [Launch Date]\nSurvey Ops Tracker link: [Base44 record URL]"

  Then: **Base44 → Update Record** → set Calendar Event ID = event ID returned from Module 3A.

- [ ] **Step 5: Route B — Update event**

  Module 3B: **Google Calendar → Update an Event**
  - Event ID: Calendar Event ID field value from the Base44 record
  - Update Summary, Start, End same as Route A

- [ ] **Step 6: Activate**

  Schedule: Run every 15 minutes.

- [ ] **Verify:** Set a Due Date on a test project in Base44. Within 15 minutes, confirm a Calendar event appears on the shared team calendar with the right name and date. Change the Due Date — confirm the event updates. Delete test project.

---

## Task 14: Integration — Slack Notifications

**What this produces:** A Make.com scenario that sends Slack alerts for three triggers: stage advance, due tomorrow, N target hit.

- [ ] **Step 1: Create the scenario**

  In Make.com → "Create a new scenario" → Name it: **"Base44 → Slack Notifications"**

- [ ] **Step 2: Trigger — Stage advance**

  Module 1: **Base44 → Watch Records (Updated)**
  - Watch for changes to: Current Stage

  Module 2: **Slack → Post Message**
  - Channel: #survey-ops
  - Message: "📋 *[Project Name]* ([Client]) moved to *[Current Stage]* — Captain: [Project Captain Initials]"

- [ ] **Step 3: Add second scenario for Due Tomorrow**

  Create a separate scenario named **"Slack — Due Tomorrow Alerts"**:

  Module 1: **Base44 → Search Records**
  - Filter: Due Date = tomorrow's date AND Status = Open

  Module 2: **Iterator** (loop over results)

  Module 3: **Slack → Post Message**
  - Channel: #survey-ops
  - Message: "⏰ *[Project Name]* for *[Client]* is due tomorrow. Captain: [Project Captain Initials]"

  Schedule: Run daily at 9:00 AM.

- [ ] **Step 4: Add third scenario for N Target Hit**

  Create a separate scenario named **"Slack — N Target Hit"**:

  Module 1: **Base44 → Watch Records (Updated)**
  - Watch for changes to: N Collected

  Module 2: **Filter** — only continue if N Collected ≥ N Target AND N Target > 0

  Module 3: **Slack → Post Message**
  - Channel: #survey-ops
  - Message: "✅ *[Project Name]* ([Client]) hit its N target — [N Collected] / [N Target] responses collected! Captain: [Project Captain Initials]"

- [ ] **Step 5: Activate all three scenarios**

- [ ] **Verify:**
  - Manually advance a test project's stage (check a pipeline checkbox) → confirm Slack message in #survey-ops within 2 minutes
  - Create a test project with Due Date = tomorrow → run the Due Tomorrow scenario manually → confirm Slack alert fires
  - Set N Collected = N Target on a test project → confirm the N Target Hit Slack message fires
  - Delete test projects

---

## Task 15: Integration — Internal Survey Tool → N Collected Sync

**What this produces:** Automated sync of N Collected from the internal survey platform into Base44.

> ⚠️ **Requires coordination with your internal dev.** Before starting this task, share the following with them and get their answer on Method A vs B.

- [ ] **Step 1: Confirm integration method with dev**

  Share this with your dev:

  > "We need our internal survey tool to push N Collected counts to our new project tracker. Option A (preferred): can you add a webhook to the tool that fires a POST request to a URL we provide whenever N Collected updates for a project? The payload should include a project identifier (name or ID) and the new N Collected value.
  >
  > Option B (fallback): does the tool have an API endpoint we can poll on a schedule to get current N Collected per project?"

  Get their answer before proceeding with either sub-path below.

- [ ] **Step 2A (if webhook): Set up Make webhook receiver**

  Create a scenario: **"Survey Tool → N Collected Sync (Webhook)"**

  Module 1: **Webhooks → Custom Webhook**
  - Create a new webhook → copy the URL → give this URL to your dev
  - Expected payload structure: `{ "project_id": "...", "n_collected": 123 }`

  Module 2: **Base44 → Search Records**
  - Find the Survey Project where Project Name (or a new "Survey Tool ID" field) matches `project_id`

  Module 3: **Base44 → Update Record**
  - Set N Collected = `n_collected` from the webhook payload
  - Set N Last Synced = `{{now}}`

- [ ] **Step 2B (if API poll): Set up polling scenario**

  Create a scenario: **"Survey Tool → N Collected Sync (Poll)"**

  Module 1: **HTTP → Make a Request**
  - URL: [survey tool API endpoint — get from dev]
  - Auth: [API key from dev]
  - Returns: array of `{ project_name, n_collected }`

  Module 2: **Iterator** (loop over results)

  Module 3: **Base44 → Search Records**
  - Find Survey Project by Project Name

  Module 4: **Base44 → Update Record**
  - Set N Collected = value from API
  - Set N Last Synced = `{{now}}`

  Schedule: Run every 15 minutes.

- [ ] **Step 3: Add a "Survey Tool ID" field to Base44 (if using webhook)**

  If using Method A, add a new Text field to Survey Project: **Survey Tool ID**. Your dev will provide the ID for each project. Fill these in during the Google Sheets import (Task 12) or manually after.

- [ ] **Verify:** Confirm N Collected updates in Base44 within 15 minutes (Method B) or within seconds of a change (Method A). Open a project in Base44 and confirm N Collected shows the correct value and "Last synced X min ago" doesn't show a staleness warning.

---

## Task 16: Final Verification & Team Onboarding

**What this produces:** A confirmed working system and an onboarded team.

- [ ] **Step 1: End-to-end smoke test**

  Run through this sequence manually:
  1. Send a test inquiry email → confirm Scoping card created in Base44
  2. Approve the Scoping project → confirm it moves to Submitted in Active pipeline
  3. Check pipeline stages one by one → confirm board card advances
  4. Set a Due Date → confirm Google Calendar event created
  5. Ask the AI "What's due today?" → confirm accurate answer
  6. Manually update N Collected to match N Target → confirm Slack "N target hit" fires
  7. Click "✕ Close Project" → confirm project disappears from Operations view, visible in Full View

- [ ] **Step 2: Create a .gitignore**

  ```bash
  echo ".superpowers/" >> .gitignore
  git add .gitignore
  git commit -m "chore: ignore superpowers brainstorm artifacts"
  ```

- [ ] **Step 3: Write a one-page team guide**

  Create `docs/team-guide.md` with:
  - How to add a new project (manually vs via email)
  - How to advance a project through stages (check the checkbox on the project detail)
  - How to use the Operations vs Full View toggle
  - How to use the AI assistant (with the 4 suggested prompts)
  - Who to contact if the N Collected sync seems stale (> 30 min warning)
  - How to link a Google Doc to a project

  ```bash
  git add docs/team-guide.md
  git commit -m "docs: add team onboarding guide"
  ```

- [ ] **Step 4: Onboard the team**

  Schedule a 30-min walkthrough with the team covering:
  - The board (Operations vs Full View toggle)
  - How to update a project (check a stage, update Latest/Next Steps)
  - The AI assistant — show the suggested prompts live
  - Where to find linked docs

- [ ] **Step 5: Retire the spreadsheet**

  Rename the old Google Sheet to "ARCHIVED — Survey Ops [date]" and add a note in cell A1: "This sheet is retired. Use the Survey Ops Tracker at [Base44 URL]."

---

## Appendix: Field Reference

Quick lookup for anyone configuring fields in Base44 or Make.com.

### Survey Project — All Fields

| Field | Type | Editable? | Source |
|---|---|---|---|
| Project Name | Text | ✓ Manual | |
| Client | Text | ✓ Manual | |
| Type | Select | ✓ Manual | |
| Project Captain | Relation → Team Member | ✓ Manual | |
| Phase | Select | ✓ Manual | Set to Scoping on create; Active on approval |
| Status | Select | ✓ Manual | Default Open; Close via button |
| Scoping Stage | Select | ✓ Manual | Only used when Phase = Scoping |
| Submitted Date | Date | ✓ Manual | |
| Launch Date | Date | ✓ Manual | |
| Due Date | Date | ✓ Manual | |
| Deliver Date | Date | ✓ Manual | |
| N Target | Number | ✓ Manual | |
| N Collected | Number | ✗ Read-only | Auto-synced by Make (Task 15) |
| N Last Synced | DateTime | ✗ Read-only | Auto-set by Make (Task 15) |
| Audience Size | Number | ✓ Manual | |
| Row-Level Data | Checkbox | ✓ Manual | |
| Terminations | Checkbox | ✓ Manual | |
| Stage: Doc Programming | Checkbox | ✓ Manual | |
| Stage: Survey Programming | Checkbox | ✓ Manual | |
| Stage: EdWin QA | Checkbox | ✓ Manual | |
| Stage: Fielding | Checkbox | ✓ Manual | |
| Stage: Data QA | Checkbox | ✓ Manual | |
| Stage: Delivery | Checkbox | ✓ Manual | |
| Board Column | Select | ✓ (via drag or automation) | Writable field used for board grouping; kept in sync with checkboxes via automation |
| Current Stage | Formula | ✗ Computed | Derived from stage checkboxes; copied to Board Column by automation |
| Latest / Next Steps | Long Text | ✓ Manual | Auto-stamped with date + user |
| Linked Documents | URL (multi) | ✓ Manual | |
| Calendar Event ID | Text | ✗ Internal | Set by Make (Task 13) |
| Survey Tool ID | Text | ✓ Manual | Provided by dev (only if webhook method) |
