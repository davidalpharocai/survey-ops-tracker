# Internal project type + Sprints — design

*2026-06-15. Approved via mockup. Builds on the Survey Ops tracker.*

## Goal
A new project **type = "Internal"** for AlphaROC's own work (product, ops, hiring, tooling, etc.) that runs on a non-survey workflow, plus a **Sprint** cadence so internal work can be planned in 2-week increments and visualized on the timeline.

## Type & workflow
- Add `Internal` to the `project_type` enum (alongside PS / B2B / Rerun).
- Internal projects use a four-stage workflow instead of the survey pipeline: **Backlog → In Progress → Review → Done**. These are added to the existing `board_column` enum (one column field, two domains; the board renders the set that matches the active Type filter).
- Internal projects are `phase = 'Active'`, never go through Scoping, and default `board_column = 'Backlog'`.

## Navigation (revised — dedicated tab, not a board mode)
- Internal projects get their **own ☰ menu entry, "Internal Projects" → `/internal`** — a self-contained section. They never appear on the survey Board, List, Insights, Timeline, client pages, or digest. `project_type = 'Internal'` is the discriminator; it is NOT offered on the main New Project Type dropdown — it's set automatically when creating from the Internal section.
- `useProjects()` (survey-wide) excludes internal; a dedicated `useInternalProjects()` powers the section.
- The `/internal` board has the four internal columns with drag, a current-sprint chip, and its own "New internal project" button.

## Project page (internal variant)
Hidden vs. survey: N collected/target/actual, audience size, Survey IDs + Edwin sync, bids, Voter QA, Citation, Row-Level Data, Terminations, Salesperson, derived Waiting-On.
Shown: title + PR code, status, priority, **Owner** (the captain field, relabeled) + co-owners, internal stage progress, **Next Steps checklist** (its completion % is the progress signal, replacing N), notes, Linked Documents, Activity, Audit Log.
New fields: **Objective** (one line), **Category** (Product / Hiring / Tooling / Marketing / Ops / Research / Other), **Sprint**.
Client defaults to **AlphaROC** but stays editable.

## Sprints
- **Centrally defined, auto-generated from an anchor.** A single `sprint_config` row holds `anchor_date` (start of Sprint 1) and `length_days` (14). Sprint number for a date = `floor((date − anchor) / length) + 1`; sprint N spans `anchor + (N−1)·length` for `length` days.
- Admin gets a **Sprint cadence** setting to set/change the anchor date (Sree manages it). Seed with a recent Monday.
- The project stores only `sprint_number` (int, nullable). The 2-week range is always derived from the config, so "Sprint 15" means the same dates everywhere.
- The Sprint **dropdown** (internal project page) lists nearby sprints as "Sprint 15 · Jul 1–14". Picking one **inherits** the project's start date (= sprint start) but is overridable. Clearing it removes the sprint.
- A project may span multiple sprints implicitly: you pick the anchoring sprint; the timeline bar runs start → due date, crossing later sprint bands as needed.

## Timeline interaction (separate, already-approved feature)
- Internal projects' bars run **start → due date**; faint 2-week **sprint bands** can back the internal timeline. (Built in the Timeline workstream; this spec just guarantees the data.)

## Data model summary (migration 033)
- `ALTER TYPE project_type ADD VALUE 'Internal'`
- `ALTER TYPE board_column ADD VALUE` for Backlog / In Progress / Review / Done
- `survey_projects`: add `category text`, `objective text`, `sprint_number int`
- new table `sprint_config (id int pk default 1, anchor_date date, length_days int default 14)` + analyst RLS
- "Start" for internal reuses the existing `launch_date` field (no new date column)

## Out of scope (v1)
Multi-sprint tagging, per-sprint capacity/velocity, sprint burndown, sprints on survey projects, irregular/holiday sprint overrides.
