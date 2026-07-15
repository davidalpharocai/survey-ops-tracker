# SOCC → Surveys Write-Back — Go-Live Runbook

The write-back ships **dark**. `SHEET_WRITEBACK_ENABLED` is 3-state:
- **unset / `off` / `false`** — the scheduled cron returns immediately and touches nothing (no sheet reads — silent, so no pre-go-live noise). This is the default.
- **`dryrun`** — reads the sheet + logs exactly what it *would* write, writes nothing.
- **`live`** (or `true`/`1`) — writes.

Follow these steps to turn it on.

## Preconditions (do these first)

1. **Enable the Google Sheets API** in the GCP project that owns the Drive credentials. (The Drive API is already enabled; Sheets is a separate toggle — APIs & Services → Library → "Google Sheets API" → Enable.)
2. **Credential durability + access:**
   - The prod credential must be **non-expiring**. If the OAuth consent screen is **External**, the refresh token expires ~7 days and the cron will silently stop — switch the consent screen to **Internal**, or use a service account.
   - The authenticated principal must have **Editor** on the Surveys spreadsheet (`1ZTTJ0PQZ7vj13tmZmsMvKAcEEf0Nc0s8dVbfaYJju7Q`). If prod runs as David's OAuth (sheet owner), this is already true. If it's a service account, share the sheet with the service-account email as Editor.
3. **Run migration 053** in the Supabase SQL editor:
   ```sql
   alter table public.survey_projects add column if not exists sheet_synced_at   timestamptz;
   alter table public.survey_projects add column if not exists sheet_synced_hash text;
   ```

## Validate in dry-run

4. Set `SHEET_WRITEBACK_ENABLED=dryrun` (Production), redeploy, and trigger the cron:
   ```
   curl -H "x-webhook-secret: $WEBHOOK_SECRET" https://survey-ops-tracker.vercel.app/api/cron/sheet-writeback
   ```
   Response shows `{ "mode": "dryrun", appended, updated, skipped, failed }`. (Note: migrated projects already have a Surveys row, so the first dry-run should show mostly `UPDATE`, not `APPEND` — a flood of `APPEND` means row lookup by PR code is failing; investigate before going live.)
5. Read `system_events` (source `sheet-writeback`) or the daily-digest health line. Confirm the `[dry-run] would APPEND/UPDATE …` lines are correct for real projects (right client / name / PR code; sensible create-vs-update split). If the header drifted you'll see `aborted: header-guard` — re-verify the Surveys column order and update `EXPECTED_HEADERS` in `lib/sheets/surveysMap.ts` before continuing.

## Go live

6. Set the Vercel env var **`SHEET_WRITEBACK_ENABLED=live`** (Production) and redeploy.
7. Smoke test:
   - Create a test **PS** project in SOCC → within the next cron run (≤4h, or trigger manually) confirm a new row appears in the Surveys tab with the right columns + literal PR code.
   - Edit a mapped field (e.g. N Collected, status by delivering it) → confirm the row's mapped cells update on the next run, and the **Comments / unmapped columns are untouched**.
8. Once satisfied, stop running the reverse full-mirror `scripts/sheet-sync.mjs` against the mapped columns (SOCC now owns them).

## Notes / limits (v1)

- **SOCC wins:** a teammate's edit to a *mapped* column is overwritten on the next sync. Unmapped columns (Comments, Edwin Link, Deliverable, etc.) are never touched.
- **No delete/un-sync:** a soft-deleted project, or one whose type changes away from PS/B2B, is left in the sheet as-is.
- **Survey IDs (col AJ)** is intentionally left blank until David redirects (his upstream process first).
- To pause: set `SHEET_WRITEBACK_ENABLED=off` (or unset it) — the cron goes silent, no code change needed. Use `dryrun` to observe without writing.
- **First live run** updates every already-migrated project's row to match SOCC (one-time bulk), then only changed projects write. If it hits the 60s limit it resumes on the next run (stamped rows are skipped) — safe and idempotent.
