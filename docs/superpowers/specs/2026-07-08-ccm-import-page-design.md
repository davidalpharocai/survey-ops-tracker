# CCM in-app data importer — design (approved 2026-07-08)

Approved by David in-session (chat approval of the presented design).

## What

An admin-gated **Import Data** page in the CMS frontend (`/ccm/admin/import`):
upload an `.xlsx` → preview exactly what will change → Apply → per-row results
report. Plus a downloadable blank template.

## Accepted formats (auto-detected by tab names)

1. **SOCC export** (`Projects` + `Clients` tabs, tracker column names) — same
   mapping as `.devstack/seed-from-socc.mjs`: clients (RM = modal salesperson,
   since = earliest project date), projects → 0-cost studies attributed to the
   requested-by contact or "(Unassigned)", Client Contacts → users.
   **Create-only**: rows matching existing records are left untouched (the
   tracker carries no pricing, so updates from this format could only damage
   priced studies).
2. **CMS template** (`Clients` / `Users` / `Contracts` / `Studies` tabs,
   CMS-native columns incl. contract credit/dollar amounts and study
   cost/cadence/setup) — the way costs and contracts are bulk-loaded.

## Duplicate rule

Match by name, case-insensitive (client name globally; contract/study name
within its client; user name within its client). Matched row → **update of
only the columns the sheet fills** (empty cells never overwrite). Unmatched →
create. Preview shows three buckets: create / update (old → new per field) /
unchanged. Nothing applies until the Apply click; re-uploading the same file
is a no-op.

## Architecture

Frontend-only. A server action parses the workbook (exceljs, already a
dependency), fetches current CMS state through `lib/api.ts`, and builds a
serializable plan. Apply executes the plan row-by-row through the **existing
backend CRUD endpoints** with the acting user's email — zero backend changes,
every row lands in the audit trail. Non-atomic by design: failures produce a
per-row report; the match-by-name rule makes fix-and-reupload safe. Update
calls merge unprovided fields from the existing record first (backend PATCH
bodies are full replacements).

## Out of scope

Deletes (importer never removes anything), CSV, fuzzy matching.
