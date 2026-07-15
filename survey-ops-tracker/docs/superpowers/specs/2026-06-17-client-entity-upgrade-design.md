# Client Entity Upgrade — Design Spec

**Date:** 2026-06-17
**Status:** Draft for review
**Sequence:** Build **after** the Compliance Guardrails feature (this enables compliance to later auto-derive from client type).

## Goal

Enrich the client entity so categorization and salesperson live at the **client level** instead of being re-entered per project. This makes it easy to isolate groups (financial clients, Alex's clients), cuts repetitive data entry, and lets the compliance requirement eventually derive from client type rather than a manual flag.

## Background (how clients work today)

- Clients are **auto-created** by the `sync_project_client` DB trigger from a project's free-text `client` field (firm-normalized: "BAM - James Cook" → "BAM"). There is **no add-client UI**.
- `Cl#####` codes come from the sheet's *Unique Clients* tab via a backfill script.
- Salesperson today is a per-project free-text field (`AlphaROC Sales/POC` in the sheet; full names: Alex Pinsky, Jenna Shrove, Steven Stubbs, Vineet Kapur).

## Pieces

### 1. Client types
- Add `clients.client_type` (text/enum). Candidate values: **Financial, Political, Trade Association, Consumer/Brand, Other** — *exact list = Q1*.
- Editable on the client page; shown + filterable in Admin → Accounts.
- Seed from existing signals where possible (e.g. the *Unique Clients* `is_private`/Notes, or manual first pass).

### 2. Salesperson on the client
- Add `clients.salesperson` (text to start, matching the project field's format; reference to a salesperson list is Q2).
- Set on the client page; seed by deriving each client's dominant salesperson from existing projects' `AlphaROC Sales/POC`.

### 3. Client picker on projects + pull-through
- Change the project **client field from free text → a picker** of existing clients (with an inline "add new client" that still creates the row).
- When a client is selected, **pull through** the client's salesperson as the project default (project can still override).
- This is the largest change and the enabler for pull-through; it must preserve the auto-create behavior for genuinely new clients.

## Interactions

- **Compliance:** once `client_type` exists, the compliance requirement can derive from `type = Financial` (the manual before/after booleans get back-filled from type, and new financial clients are flagged automatically).
- **Admin Accounts:** type + salesperson become filter/group dimensions (e.g. "show Alex's financial clients").

## Open questions (resolve at review)

- **Q1 — Client type list.** What are the exact types? Single-select or can a client be multiple?
- **Q2 — Salesperson representation.** Free-text full name (matches today) vs a managed salesperson list/reference? Salespeople aren't in `team_members` today — they're a project text field. A managed list enables clean filtering and the "client-level salesperson → compliance for Alex's clients" link.
- **Q3 — Client picker UX.** How should "add a new client" work inside the picker without surprising users, and do we migrate the existing free-text values cleanly? Does this change the AI project-entry flow (which currently writes free-text client)?
- **Q4 — Backfill.** Confirm the rule for deriving each client's salesperson from historical projects (most-recent? most-frequent?).

## Out of scope

- Re-architecting the compliance feature (it ships first with manual flags; this spec only adds the *type* it can later key off).
