# SOCC → Surveys Sheet Write-Back — Design Spec

**Date:** 2026-07-15
**Status:** Approved (brainstorm) — pending spec review → implementation plan
**Author:** David + Claude

## Goal

Make SOCC the source of truth while the team is still living in the legacy "Survey Ops" Google Sheet. On a schedule (a few times a day), push SOCC projects **down into the sheet's "Surveys" tab** — both **new** projects and **subsequent changes** — so the team keeps seeing current data in the tool they already use, without SOCC having to wait for everyone to switch. A transitional bridge, retired once the team is fully on SOCC.

## Scope

**In scope**
- One-directional sync **SOCC → Surveys tab** (the sheet is downstream; we never read the sheet back into SOCC in this feature).
- **Create**: append a row for a qualifying project not yet in the sheet.
- **Update**: when a qualifying project's mapped data changes in SOCC, overwrite its mapped cells in the sheet (SOCC wins).
- Only **client projects**: `project_type IN ('PS','B2B')`. Excludes Internal and auto-spawned Rerun-type projects.

**Explicitly NOT in scope (v1)**
- No **delete / un-sync** propagation. A project later soft-deleted, or whose type changes away from PS/B2B after it was synced, is left in the sheet as-is (flagged as future work).
- No **sheet → SOCC** read-back. SOCC is authoritative; this feature only writes.
- **Survey IDs (column AJ)** — deferred at David's request; he is implementing an upstream process first, then will redirect us to populate AJ.
- No touching of **unmapped columns** — the team's own annotations (comments, etc.) are never written.

**Accepted tradeoff (SOCC as source of truth):** because SOCC wins, if a teammate edits one of the **mapped** columns directly in the sheet, the next sync overwrites their edit. The mapped columns are effectively read-only-for-the-team; unmapped columns remain theirs. This is the intended consequence of "SOCC is the source of truth."

## Architecture

A new Vercel cron `GET /api/cron/sheet-writeback`, scheduled a few times a day (proposed `0 */4 * * *`), mirroring existing cron conventions:
- Secret auth (`CRON_SECRET` bearer or `WEBHOOK_SECRET` header) via `safeEqual`.
- Always returns 200 (so Vercel Cron never retries/double-writes); failures are logged to `system_events` (surfaced in the daily-digest health line), not thrown.
- `maxDuration = 60`.
- Uses the **service-role** admin client to read `survey_projects`, so it catches every create/edit path (UI, Claude/MCP, future) uniformly rather than hooking a single app code path.

New Google **Sheets** API access (net-new — today the sheet is only ever *read* via Drive export):
- A small helper instantiates `google.sheets({ version: 'v4', auth })` reusing the **same auth object** from `lib/drive/google.ts` (OAuth locally, whatever prod is configured for), so prod/local auth stays consistent. No new dependency (`googleapis` is already present).
- Reads: `spreadsheets.values.get` for the header row (guard) and the PR-code column (row lookup).
- Writes: `spreadsheets.values.append` (new rows) and `spreadsheets.values.batchUpdate` (mapped-cell updates), `valueInputOption: 'USER_ENTERED'` so dates/numbers/checkboxes parse.

### Change detection — content hash (not `updated_at`)

Add two columns to `survey_projects` (migration 052):
- `sheet_synced_at timestamptz` — when the row was last written to the sheet (observability + staleness).
- `sheet_synced_hash text` — a stable hash of the last-synced **mapped payload**.

Each run, for every qualifying project, compute the mapped payload and its hash:
- `sheet_synced_hash IS NULL` → **never synced** → append a new row.
- `sheet_synced_hash <> <fresh hash>` → **changed** → update the existing row's mapped cells.
- equal → skip.

On a successful write, store the fresh hash + `now()`. Using a content hash makes change detection independent of whether every edit path maintains `updated_at`, and naturally unifies create + update.

### Row location (for updates)

To update an existing row we must find it. Once per run, read `Surveys!AM:AM` (the PR-code column) and build a `PR#### → rowNumber` map. Update targets the mapped cells of that row. Because we write the PR code as a **literal** value (see mapping), every SOCC-written row is locatable.

### Write ranges (updates write only mapped cells)

The mapped columns fall into these contiguous runs, so an update is a `batchUpdate` of these ranges for the target row `r` (leaving all gap/unmapped columns untouched):
- `A{r}:T{r}` (0–19)
- `X{r}:AC{r}` (23–28)
- `AG{r}` (32)
- `AI{r}` (34)
- `AL{r}:AM{r}` (37–38)

Appends write a single full-width row `A:AM` (39 cells, blanks in the gap/unmapped/AJ positions) so the positional parser downstream stays aligned.

### Header guard (anti-corruption)

Before writing anything in a run, read `Surveys!1:1` and assert the header text at each **mapped** column index matches the expected label captured during build (see "Build step 1"). On any mismatch, **abort the run, write nothing, log a `system_events` error**. This makes a silently-reordered sheet fail safe instead of corrupting data. (Two existing scripts already disagree about column 38, which is exactly the drift this guards against.)

### Dry-run first (safety flag)

`SHEET_WRITEBACK_ENABLED` env flag, default **off (dry-run)**. While off, the cron does all detection and logs exactly what it *would* append/update to `system_events`, but writes nothing to the sheet. We validate the mapping against real projects, flip the flag on when confident. (Same build-dark-then-enable pattern as the rerun nudges.)

## Column mapping (the contract)

0-indexed / spreadsheet letter → Surveys field ← SOCC source. Booleans written as real `TRUE`/`FALSE` (or blank when the SOCC value is null/"unknown"); dates as date-typed values (blank when null); numbers as integers (blank when null).

| Col | Surveys field | ← SOCC source |
|---|---|---|
| A (0) | Latest / Next Steps | `latest_next_steps` |
| B (1) | Client | `client` |
| C (2) | Project Name | `project_name` |
| D (3) | Longitudinal | `longitudinal` (bool) |
| E (4) | Type | `project_type` (PS / B2B) |
| F (5) | Status | **derived**: `delivered_at IS NOT NULL` → `"Done"`, else `"In Progress"` |
| G (6) | Submitted | `submitted_date` |
| H (7) | Launch | `launch_date` |
| I (8) | Due | `due_date` |
| J (9) | Deliver | `deliver_date` |
| K (10) | Voter QA | `voter_survey_qa` (bool, nullable → blank) |
| L (11) | Citation | `citation_language_needed` (bool, nullable → blank) |
| M (12) | Row-level data | `row_level_data` (bool) |
| N (13) | N Target | `n_target` |
| O (14) | N Internal Target | `n_internal_target` |
| P (15) | N Collected | `n_collected` |
| Q (16) | N Actual | `n_actual` |
| R (17) | Audience Size | `audience_size` |
| S (18) | Captain | `team_members.initials` via `captain_id` (blank if none) |
| T (19) | Terminations | `terminations` (bool) |
| X (23) | Doc Programming | `stage_doc_programming` (bool) |
| Y (24) | Survey Programming | `stage_survey_programming` (bool) |
| Z (25) | Edwin QA | `stage_edwin_qa` (bool) |
| AA (26) | Fielding | `stage_fielding` (bool) |
| AB (27) | Data QA | `stage_data_qa` (bool) |
| AC (28) | Delivery | `stage_delivery` (bool) |
| AG (32) | Linked doc — Google **Doc** | first `linked_documents` URL matching `docs.google.com/document` (blank if none) |
| AI (34) | Linked doc — Google **Sheet** | first `linked_documents` URL matching `docs.google.com/spreadsheets` (blank if none) |
| AJ (35) | Survey IDs | **left blank (deferred)** |
| AL (37) | Salesperson | `salesperson` (free text, e.g. "Jenna Shrove") |
| AM (38) | Project ID | `project_code` — **literal** PR##### (not the XLOOKUP formula), so it shows immediately and rows are locatable |

**Left for the team (never written):** gap columns U/V/W (20–22), AD (29), AE=Comments (30), AF (31), AH=Edwin link (33), AK=Deliverable link (36), and AJ until redirected.

### Derived-field rules
- **Status (F):** `delivered_at` set → `"Done"`; otherwise `"In Progress"`. (Casing to be matched to the sheet's existing status vocabulary, confirmed during Build step 1.)
- **Captain (S):** resolve `captain_id` → `team_members.initials`; blank if unassigned.
- **Linked-doc classification (AG/AI):** scan `linked_documents`; the first Google-Doc URL → AG, the first Google-Sheet URL → AI. Other links ignored.

## Qualification rules
- **Eligible for sync:** `project_type IN ('PS','B2B')` AND `deleted_at IS NULL`.
- **Append** when eligible AND `sheet_synced_hash IS NULL`.
- **Update** when eligible AND `sheet_synced_hash <> fresh hash`.
- A project that becomes ineligible after being synced (soft-deleted, or type changed away) is **left in the sheet unchanged** in v1 (future work).

## Data model change (migration 052)
```sql
alter table public.survey_projects add column if not exists sheet_synced_at timestamptz;
alter table public.survey_projects add column if not exists sheet_synced_hash text;
```
No RLS change (service-role writes; the columns are internal sync state).

## Failure handling
- Per-project try/catch: a failed append/update logs a `system_events` error naming the PR code and leaves `sheet_synced_hash`/`sheet_synced_at` unchanged, so it retries next run.
- Header-guard failure aborts the whole run (writes nothing) and logs.
- The cron always returns 200; a summary `{ mode, appended, updated, skipped, failed }` is returned in the body and logged.

## Go-live preconditions (setup, verified before flipping `SHEET_WRITEBACK_ENABLED` on)
1. **Google Sheets API enabled** in the GCP project (Drive API is on today; Sheets is separate).
2. The prod credential is **durable (non-expiring)** and has **Editor** on spreadsheet `1ZTTJ0PQZ7vj13tmZmsMvKAcEEf0Nc0s8dVbfaYJju7Q`. If prod runs as David's OAuth (sheet owner) that's covered — but if the OAuth consent screen is "External," the refresh token expires ~7 days and the cron would silently die; that requires Internal consent or a service account shared as Editor.

## Interaction with the existing full-mirror sync
Today a human-run `scripts/sheet-sync.mjs` reads the Surveys tab *into* SOCC. Once this write-back is live, that reverse flow becomes redundant for the mapped columns (SOCC would be reading back its own writes) and should be wound down to avoid confusion. Not deleted by this feature, but flagged: don't run the reverse full-mirror against mapped columns once write-back is enabled.

## Build step 1 (first task in the plan): pin the live layout
Dump the **live** Surveys header row (row 1) via a one-off script, capture the exact header strings, and encode them as the header-guard's expected labels. This both verifies our positional mapping against the real sheet (resolving the col-38 disagreement) and produces the guard's assertion data. Nothing else is built until this matches.

## Testing strategy
- **Unit (pure functions):** the mapping function (`SOCC project row → 39-cell array`), the update-range builder, the content-hash, the status derivation, the linked-doc classifier, boolean/date/number formatting. These are DB/network-free and fully testable.
- **Dry-run validation:** run the cron in dry-run against real prod data; inspect the logged would-be writes for correctness before enabling.
- **Live smoke:** with the flag on, create one test PS project → confirm it appears; edit it → confirm the mapped cells update and unmapped cells are untouched.

## Open / future items
- Populate **Survey IDs (AJ)** once David's upstream process is ready.
- **Delete / un-sync** propagation for removed or type-changed projects.
- Retire the reverse full-mirror sync for mapped columns.
- Eventually retire the whole write-back when the team is fully on SOCC.
