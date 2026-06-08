# Survey Ops Tracker — Design Spec
**Date:** 2026-06-08  
**Status:** Approved for implementation  
**Platform:** Base44 (app) + Make.com (automations)

---

## 1. Overview

A hosted web app that replaces the team's current Google Sheets-based survey operations tracker. The core pain points being solved:

- Endless scrolling through a large spreadsheet
- Stale fields due to manual entry
- No shared real-time view for the team
- No guided context for what fields mean

The app tracks **Survey Projects** from initial scoping through final delivery, with a kanban board as the primary view, a list/table view as an alternative, a full project detail page, and an AI assistant for natural language queries against live project data.

**Target users:** A small survey operations team (project captains + managers).

---

## 2. Architecture

### Base44 (the app)
Hosts the database, user accounts/login, board view, list view, project detail pages, and AI assistant. All UI changes (rename a stage, add a field, change a color) are made directly in Base44's editor — no code required.

### Make.com (the automation layer)
Sits between Base44 and external tools. Each integration is an independent Make "scenario" — breaking one doesn't affect others, and new integrations can be added without touching Base44.

### Offline
Base44 is cloud-first. The app requires internet connectivity. Treat as online-only.

---

## 3. Data Model

### Primary Entity: Survey Project

#### Identity
| Field | Type | Notes |
|---|---|---|
| Project Name | Text | Required |
| Client | Text | e.g. "AARP", "BAM - Jeff Cumming" |
| Type | Dropdown | PS / B2B / Rerun |

#### Team
| Field | Type | Notes |
|---|---|---|
| Project Captain | Link → Team Member | The person responsible end-to-end |

#### Timeline
| Field | Type | Notes |
|---|---|---|
| Submitted Date | Date | When the project was received |
| Launch Date | Date | When fielding begins |
| Due Date | Date | Client-facing deadline |
| Deliver Date | Date | When final deliverable was sent |

#### Sample
| Field | Type | Notes |
|---|---|---|
| N (Target) | Number | Target number of survey responses |
| N Collected | Number | Auto-synced from survey platform every 15 min. Read-only in UI. |
| Audience Size | Number | Total size of panel/population being surveyed |
| Row-Level Data | Boolean | Whether individual respondent data is included in deliverable |
| Terminations | Boolean | Whether any participants have been terminated/screened out |

#### Pipeline (checkboxes — each represents a completed stage)
| Field | Type |
|---|---|
| Doc Programming | Boolean (checkbox) |
| Survey Programming | Boolean (checkbox) |
| EdWin QA | Boolean (checkbox) |
| Fielding | Boolean (checkbox) |
| Data QA | Boolean (checkbox) |
| Delivery | Boolean (checkbox) |

**Current Stage** is derived automatically: the first unchecked box in pipeline order. Checking a box auto-advances the project card on the board. Unchecking moves it back.

#### Status
| Field | Type | Notes |
|---|---|---|
| Status | Dropdown | Open / Closed |
| Phase | Dropdown | "Scoping" or "Active" — set to "Scoping" on creation; manually changed to "Active" when a Scoping project is approved and enters the main pipeline at Submitted |

#### Notes & Links
| Field | Type | Notes |
|---|---|---|
| Latest / Next Steps | Long Text | Free-text status field. Updates auto-stamp date + user name. |
| Linked Documents | URL list | Google Doc URLs, stored and displayed as clickable links |
| Google Calendar Event ID | Text | Internal — used to sync date changes back to Calendar |

---

### Scoping Pipeline (sub-stages within Scoping phase)

Projects in the Scoping phase have their own current stage:
1. New Inquiry
2. Proposal Sent
3. Pricing Discussion
4. Awaiting Approval
5. Closed *(terminal — project does not enter main pipeline)*

When a Scoping project is approved, its Status becomes Open and it enters the main pipeline at **Submitted**.

---

### Secondary Entity: Team Member
| Field | Type |
|---|---|
| Name | Text |
| Initials | Text (e.g. AL, AW, BF) |
| Email | Text |

---

## 4. Views & Navigation

### View Toggle (Operations / Full)
A persistent toggle at the top of the board and list views:

- **⚙ Operations** (default): Shows only the main pipeline (Submitted → Delivery). Scoping phase and Closed projects are hidden. This is what the product team sees day-to-day.
- **◉ Full View**: Shows the Scoping phase above the main pipeline, plus Closed projects (grayed out, crossed out). Used for management meetings and full pipeline reviews.

### Board / List Tab
A secondary toggle on the same page switches between Board and List view. Both show the same underlying data and respect the Operations/Full view setting.

---

## 5. Board View

**Default landing screen.**

### Columns
In Operations mode: 7 columns — Submitted, Doc Programming, Survey Programming, EdWin QA, Fielding, Data QA, Delivery.

In Full mode: Scoping phase columns (New Inquiry, Proposal Sent, Pricing Discussion, Awaiting Approval, Closed) appear above the main pipeline, separated by a labeled divider.

### Project Cards
Each card displays:
- Project Name (bold)
- Client
- Type badge (color-coded: PS = blue, B2B = purple, Rerun = green)
- N Collected / N Target progress bar (color: green when complete, amber when in progress)
- Latest/Next Steps snippet (first ~100 chars)
- Captain initials (pill badge)
- Due Date (amber if within 3 days, red + ⚠ if overdue)
- Left border color reflects current stage

### Interactions
- **Drag card** between columns → auto-checks all pipeline stages up to and including the destination column (e.g. dragging to Fielding marks Doc Programming, Survey Programming, and EdWin QA as complete)
- **Check pipeline checkbox** in project detail → auto-moves card to correct column
- **Click card** → navigates to full project detail page

### Filters
Filter bar at top of board: by Captain, Type, Client, Overdue only.

---

## 6. List View

Sortable, filterable table. Columns: Project Name, Client, Type, Current Stage, Captain, N Collected / N Target, Due Date.

- Sortable by any column
- Same filter bar as board
- Inline edit for quick field updates (no need to open project detail)
- Stage column color-coded to match board column colors
- Overdue due dates shown in red

---

## 7. Project Detail Page

Full-page view. Opened by clicking a project card. "← Board" breadcrumb navigates back.

### Layout
Two-column layout:

**Left column (main content):**
- **Pipeline Progress Bar** — horizontal strip showing all stages; completed = green with checkmark, current = amber with active indicator, future = gray. Checking/unchecking stages here advances/retreats the board card.
- **Latest / Next Steps** — current notes displayed, plus a quick-add input that auto-stamps date and user name on save. Append-only log.
- **Linked Documents** — list of linked Google Doc URLs with paste-to-add input.

**Right column (sidebar):**
- All project detail fields (Client, Captain, dates, N, Audience Size, Row-Level Data, Terminations) — each with an ⓘ tooltip
- N Collected progress bar
- Calendar section (Launch and Due dates with "Sync to Google Calendar" link)
- Notification summary (what Slack alerts are active for this project)

### Header actions
- **+ Update** — quick-add to Latest/Next Steps
- **✕ Close Project** — marks Status as Closed; removes from Operations view

---

## 8. Info Tooltips (ⓘ)

Every field that isn't self-explanatory has a small ⓘ icon. Hovering shows a one-sentence plain-English definition. Key ones:

| Field | Tooltip text |
|---|---|
| N (Target) | Total number of survey responses you're aiming to collect. |
| N Collected | Responses collected so far. Auto-synced from the survey platform every 15 minutes — do not edit manually. |
| Audience Size | Total size of the panel or population being surveyed. Different from N (target responses). |
| Row-Level Data | Whether individual respondent-level data is included in the deliverable. |
| Terminations | Whether any survey participants have been terminated (screened out) from the study. |
| Project Captain | The team member responsible for this project end-to-end. |
| Latest / Next Steps | Free-text field for current status and next actions. Updated by the project captain. Each entry is date- and name-stamped automatically. |

---

## 9. AI Assistant

A persistent chat panel — expandable widget accessible from the board and list views. Powered by Base44's built-in AI feature.

### Capabilities
The AI has read access to all live project data and knows:
- The logged-in user's identity (for "my projects" queries)
- Today's date (for due/overdue calculations)
- All project fields, stages, captains, and N progress

### Example queries
- "What's due today that's assigned to me?"
- "What should I prioritize today?"
- "Any risks on the projects I own?"
- "Which in-field projects are behind on N collection?"
- "Summarize what AL has on their plate"
- "How many projects are currently in fielding?"

### Suggested prompts
The panel surfaces 3–4 suggested prompt buttons when opened, matching the most common daily queries. Users can also type free-form questions.

### Constraints
- Read-only — the AI cannot create, update, or delete projects
- Answers are based on current data at time of query; no historical trend analysis in Phase 1

---

## 10. Integrations (all via Make.com)

### Email → New Scoping Card
- **Trigger:** New email received in a designated inbox (configure your actual ops inbox address during setup)
- **Action:** Make parses Project Name, Client, and any dates from the email body; creates a new Survey Project in Base44 at stage "New Inquiry" in Scoping
- **Manual fallback:** If parsing fails, Make creates a blank Scoping card and sends a Slack alert to fill it in

### Internal Survey Tool → N Collected Sync
- **Method A (preferred):** Your dev adds a webhook to the internal tool that fires a POST to a Make webhook URL whenever N Collected updates for a project
- **Method B (fallback):** Make polls the survey tool API on a 15-minute schedule and syncs N Collected to the matching Base44 project
- **Matching:** Projects are matched by Project Name or an internal ID field (to be confirmed with dev)
- **N Collected is read-only in Base44** — only updated via this sync

### Google Sheets → One-Time Import
- Runs once during setup to seed Base44 with existing project data
- Make maps spreadsheet columns to Base44 fields
- After import, the sheet is retired — Base44 becomes the source of truth

### Google Docs → Linked Documents
- Native Base44 feature — no Make needed
- User pastes a Google Doc URL into the Linked Documents field on a project; stored and displayed as a clickable link for the whole team

### Google Calendar → Date Sync
- **Trigger:** Launch Date or Due Date is set or changed on a project in Base44
- **Action:** Make creates or updates a Google Calendar event in a shared team calendar
- Events include project name, client, and captain

### Slack → Notifications
- **Trigger conditions (Make monitors Base44 for):**
  - Project stage advances → posts to #survey-ops: "📋 [Project] moved to [Stage] by [Captain]"
  - Due date is tomorrow → posts: "⏰ [Project] for [Client] is due tomorrow. Captain: [Captain]"
  - N target is hit (N Collected ≥ N Target) → posts: "✅ [Project] hit its N target ([N] responses)!"
- **Channel:** Configurable — default #survey-ops

---

## 11. Error Handling & Edge Cases

- **N Collected sync fails:** Last synced value stays; a small "Last synced: X min ago" indicator on the project detail flags staleness if > 30 min
- **Email parsing fails:** Blank Scoping card created + Slack alert sent to fill in manually
- **Duplicate project names:** Base44 allows duplicates; team convention to use Client + Project Name to avoid confusion (documented in onboarding)
- **Project closed mid-pipeline:** Status set to Closed; project disappears from Operations view, visible in Full View with strikethrough styling
- **Captain not assigned:** Project card shows "Unassigned" badge in red — visible prompt to fix

---

## 12. Out of Scope (Phase 1)

- Offline support
- Historical trend analytics / reporting dashboard
- Time tracking
- Client-facing portal
- Mobile app
- Comments / threaded discussion (Latest/Next Steps log serves this purpose for now)
- AI writing or editing projects (AI is read-only in Phase 1)

---

## 13. Success Criteria

- Team can see all active projects on the board in one view without scrolling
- N Collected updates automatically — no manual entry required
- A new project submission creates a Scoping card with minimal manual effort
- Any team member can answer "what's due today?" in under 10 seconds
- New team members can understand any field by hovering the ⓘ tooltip
- Stages are added/renamed in Base44 without developer help
