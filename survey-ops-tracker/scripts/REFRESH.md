# Survey Ops sheet → Command Center refresh (rerunnable)

Pre-migration, the ops team still works in the legacy **Survey Ops** Google Sheet. This brings the
Command Center fully into line with the sheet's **Surveys** tab. Re-run it whenever the app needs
to catch up (it's safe to run repeatedly — it's diff-based and idempotent).

## Prereqs
`survey-ops-tracker/.env.local` with `SUPABASE_SERVICE_ROLE_KEY` (+ `NEXT_PUBLIC_SUPABASE_URL`) and the
Drive OAuth vars (`GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN`) used by the export step. `npm i` done.

## The 4 commands
```bash
cd survey-ops-tracker

# 1. Pull the LIVE sheet to a local xlsx (uses Drive OAuth files.export — no manual download)
node --env-file=.env.local scripts/export-survey-sheet.mjs scripts/survey-ops.xlsx

# 2. Dry run — writes nothing; review the full plan in scripts/_sheet-sync-plan.log
node scripts/sheet-sync.mjs

# 3. Apply (PATCH matched projects + INSERT genuinely-new ones)
node scripts/sheet-sync.mjs --apply

# 4. Regenerate the PR-code map, then paste scripts/project-id-mapping.csv into the
#    sheet's "Project IDs" tab so the Surveys-tab XLOOKUP resolves new projects' codes
node scripts/build-mapping-csv.mjs
```

## What `sheet-sync.mjs` does (policy)
**Sheet-wins, full mirror, with smart exceptions** (pre-migration the sheet is the live truth):
- Overwrites: status, dates, N target/actual, audience, project type, canonical salesperson, Y/N flags
  (explicit-only — a blank sheet cell never forces `false`), Latest/Next-Steps, and pipeline stages/board.
- **Closed projects keep their board position** (the sheet's stage checkboxes are unreliable once a
  project is marked Done — mirroring them would drag finished work backward).
- `survey_tool_id` and `n_collected` are Edwin-owned: taken only where the sheet is clearly ahead or
  the app is blank; real conflicts are **flagged, not overwritten**.
- `linked_documents`: UNION (append missing; never removes). Dedups on the URL minus its
  `transaction_id` token, and parses JSON-string `{name,url}` entries.
- Compliance: stamps `⚠ Compliance approved via email` on fielded/delivered projects of compliance
  clients (Holocene/BAM/etc.) — records the team's real approval-by-email practice.
- Matching: PR##### (Surveys col AM) → canonical `client | name` → normalized name. New rows insert;
  app-only rows are left alone; the sheet never deletes app data.

## Maintenance (keep these current as the sheet evolves)
- **`CLIENT_CANON`** (in `sheet-sync.mjs` + `refresh-diff.mjs`): map the sheet's old/variant client
  spellings to the app's canonical names. e.g. the Junction.AI variants ("Vance Junction AI",
  "Main Fraim/Junction.AI - Vance", "Junction.AI - Vance Reavie") all → "Junction AI".
- **`SALES_CANON`**: short names → full ("Vineet" → "Vineet Kapur").
- **`HOLD_NEW`**: malformed/blank sheet rows to never auto-insert (e.g. rows where project name == client).
- **`SKIP`**: per-project (code → fields) genuine disagreements to never auto-overwrite — surfaced in the
  dry-run "GENUINE DISAGREEMENTS" section for a human call. Resolve those with a dated one-off script
  (pattern: `apply-refresh-flags-YYYYMMDD.mjs`).
- Before any run, **verify the Surveys column order still matches the positional `COL` map** (the dry run
  will look obviously wrong if a column was inserted/moved).

## Safety
Always dry-run (step 2) and skim the plan first. Every write is captured in `project_audit`
(reversible). `scripts/survey-ops.xlsx` is the working copy — keep a dated backup before overwriting if
you want a point-in-time reference. `refresh-diff.mjs` remains as the lighter "app-is-truth, blank-fills
only" alternative for post-migration true-ups.

## History
- **2026-06-30:** first full-mirror run — 92 matched updates + 19 new (PR00205–PR00223); resolved 5
  flagged disagreements + unified the Junction.AI client (see `apply-refresh-flags-20260630.mjs`).
