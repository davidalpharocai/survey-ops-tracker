# SOCC → Surveys Write-Back — Go-Live Runbook

The write-back ships **dark**: the cron `/api/cron/sheet-writeback` runs every 4h but does nothing beyond a dry-run log until `SHEET_WRITEBACK_ENABLED` is set. Follow these steps to turn it on.

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

## Validate in dry-run (flag still OFF)

4. With the code deployed and `SHEET_WRITEBACK_ENABLED` unset, trigger the cron:
   ```
   curl -H "x-webhook-secret: $WEBHOOK_SECRET" https://survey-ops-tracker.vercel.app/api/cron/sheet-writeback
   ```
   Response shows `{ "mode": "dry-run", appended, updated, skipped, failed }`.
5. Read `system_events` (source `sheet-writeback`) or the daily-digest health line. Confirm the `[dry-run] would APPEND/UPDATE …` lines are correct for real projects (right client / name / PR code; sensible create-vs-update split). If the header drifted you'll see `aborted: header-guard` — re-verify the Surveys column order and update `EXPECTED_HEADERS` in `lib/sheets/surveysMap.ts` before continuing.

## Go live

6. Set the Vercel env var **`SHEET_WRITEBACK_ENABLED=true`** (Production) and redeploy.
7. Smoke test:
   - Create a test **PS** project in SOCC → within the next cron run (≤4h, or trigger manually) confirm a new row appears in the Surveys tab with the right columns + literal PR code.
   - Edit a mapped field (e.g. N Collected, status by delivering it) → confirm the row's mapped cells update on the next run, and the **Comments / unmapped columns are untouched**.
8. Once satisfied, stop running the reverse full-mirror `scripts/sheet-sync.mjs` against the mapped columns (SOCC now owns them).

## Notes / limits (v1)

- **SOCC wins:** a teammate's edit to a *mapped* column is overwritten on the next sync. Unmapped columns (Comments, Edwin Link, Deliverable, etc.) are never touched.
- **No delete/un-sync:** a soft-deleted project, or one whose type changes away from PS/B2B, is left in the sheet as-is.
- **Survey IDs (col AJ)** is intentionally left blank until David redirects (his upstream process first).
- To pause: unset `SHEET_WRITEBACK_ENABLED` (returns to dry-run) — no code change needed.
