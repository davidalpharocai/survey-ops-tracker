# SOCC → Surveys Sheet Write-Back Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scheduled, one-directional SOCC→Google-Sheet mirror that appends new client (PS/B2B) projects to the legacy "Surveys" tab and pushes subsequent SOCC changes down (SOCC = source of truth), so the team keeps seeing current data during migration. Dark behind a flag until go-live.

**Architecture:** A flag-gated Vercel cron reads `survey_projects` (service-role), computes each project's mapped Surveys row + a content hash, and appends (new) or updates mapped cells (changed) via the Google **Sheets** API — a new capability (the sheet is only ever *read* today, via Drive export). A durable `sheet_synced_hash` on each project drives create/update/skip. A runtime header-guard aborts if the sheet's columns drift. Updates touch only SOCC-owned cell ranges, preserving the team's annotations.

**Tech Stack:** Next.js 15 App Router (route handler cron), `googleapis` sheets_v4 (already a dep), Supabase service-role (PostgREST), TypeScript, Vitest.

**Reference:** design spec `docs/superpowers/specs/2026-07-15-socc-sheet-writeback-design.md`. Live Surveys header confirmed 2026-07-15 (40 cols wide; mapping matches 1:1).

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/053_sheet_writeback.sql` | `sheet_synced_at` + `sheet_synced_hash` on `survey_projects` |
| Modify | `lib/supabase/types.ts` | add the two columns to Row/Insert/Update |
| Modify | `lib/drive/google.ts` | extract + export `getGoogleAuth()` (shared auth object) |
| Create | `lib/sheets/surveysMap.ts` | PURE: expected headers, mapped cells, hash, full-row, update-ranges, derived fields, header-guard |
| Create | `lib/sheets/surveysMap.test.ts` | unit tests for the pure mapping |
| Create | `lib/sheets/client.ts` | sheets_v4 wrapper: readHeader / readPrCodes / appendRow / updateCells |
| Create | `app/api/cron/sheet-writeback/route.ts` | the cron: detect → guard → dry-run/write → stamp |
| Modify | `vercel.json` | schedule the cron (every 4h) |
| Create | `docs/SHEET_WRITEBACK_GO_LIVE.md` | preconditions runbook (Sheets API, durable creds, flip flag) |
| Modify | `USER_GUIDE.md` | brief note that SOCC feeds the Surveys tab |

---

## Task 1: Migration 053 + types

**Files:** Create `supabase/migrations/053_sheet_writeback.sql`; Modify `lib/supabase/types.ts`.

- [ ] **Step 1: Write the migration**

```sql
-- 053_sheet_writeback.sql — sync state for the SOCC->Surveys write-back.
-- sheet_synced_hash = FNV hash of the last-written mapped payload (change detection);
-- null = never written. sheet_synced_at = last successful write (observability). Additive.
alter table public.survey_projects add column if not exists sheet_synced_at   timestamptz;
alter table public.survey_projects add column if not exists sheet_synced_hash text;
```

- [ ] **Step 2: Add columns to `lib/supabase/types.ts`** — in `survey_projects` Row add `sheet_synced_at: string | null` and `sheet_synced_hash: string | null`; in Insert and Update add the `?:` optional forms. Place after `updated_at`.

- [ ] **Step 3: Commit** `feat(sheet-writeback): migration 053 sync-state columns`. (David runs the SQL in Supabase before go-live; feature is dark until then.)

---

## Task 2: Shared Google auth

**Files:** Modify `lib/drive/google.ts`.

- [ ] **Step 1: Extract the auth builder.** Split `driveClient()` so the auth object is reusable:

```ts
function buildGoogleAuth() {
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  if (refreshToken) {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
    if (!clientId || !clientSecret) throw new Error('Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET')
    const oauth = new google.auth.OAuth2(clientId, clientSecret)
    oauth.setCredentials({ refresh_token: refreshToken })
    return oauth
  }
  const email = process.env.GOOGLE_CLIENT_EMAIL
  const key = process.env.GOOGLE_PRIVATE_KEY
  if (!email || !key) throw new Error('Missing GOOGLE_OAUTH_REFRESH_TOKEN or GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY')
  return new google.auth.JWT({
    email,
    key: key.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/drive'], // full Drive scope also authorizes Sheets writes
    subject: process.env.GOOGLE_IMPERSONATE_SUBJECT || undefined,
  })
}
function driveClient() { return google.drive({ version: 'v3', auth: buildGoogleAuth() }) }

let _auth: ReturnType<typeof buildGoogleAuth> | undefined
/** Shared, lazily-built Google auth (OAuth locally / service account in prod). Reused by the Sheets client. */
export function getGoogleAuth() { if (!_auth) _auth = buildGoogleAuth(); return _auth }
```

- [ ] **Step 2: Verify** `npx next build` compiles; existing `google.test.ts` still passes (`npx vitest run lib/drive`).
- [ ] **Step 3: Commit** `refactor(drive): extract shared getGoogleAuth for the Sheets client`.

---

## Task 3: Pure mapping module

**Files:** Create `lib/sheets/surveysMap.ts`.

- [ ] **Step 1: Write the module** (complete):

```ts
import type { Database } from '@/lib/supabase/types'

export type SurveyProject = Database['public']['Tables']['survey_projects']['Row']

export const SURVEYS_TAB = 'Surveys'
export const SHEET_WIDTH = 40 // columns A..AN as of 2026-07-15
export const PR_COL_INDEX = 38 // AM — literal project_code; used to locate rows

// Header label expected at each SOCC-written column (live dump 2026-07-15). The
// runtime guard aborts the sync if any of these drift, rather than corrupt data.
export const EXPECTED_HEADERS: Record<number, string> = {
  0: 'Latest/Next Steps', 1: 'Client', 2: 'Survey/Project Name', 3: 'Longitudinal?',
  4: 'Type', 5: 'Status', 6: 'Submitted date', 7: 'Launch date', 8: 'Due Date',
  9: 'Deliver date', 10: 'Voter Survey - Additional QA', 11: 'Citation Lang. Needed',
  12: 'Row-Level Data', 13: 'N', 14: 'N (Internal Target)', 15: 'N Collected',
  16: 'N Actual', 17: 'Audience Size', 18: 'Project captain', 19: 'Terminations',
  23: 'Doc Programming', 24: 'Survey Programming', 25: 'EdWin QA', 26: 'Fielding',
  27: 'DATA QA', 28: 'Delivery', 32: 'Survey Question(s) Document', 34: 'GoogleSheet',
  37: 'AlphaROC Sales/POC', 38: 'Project ID',
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
export function headerGuardOk(liveHeader: unknown[]): boolean {
  return Object.entries(EXPECTED_HEADERS).every(([i, label]) => norm(liveHeader[Number(i)]) === norm(label))
}

const fmtDate = (d: string | null) => d ?? ''          // 'YYYY-MM-DD'; USER_ENTERED parses as a date
const fmtBool = (b: boolean | null) => (b == null ? '' : b ? 'TRUE' : 'FALSE') // blank = unknown (triBool)
const fmtNum = (n: number | null) => (n == null ? '' : String(n))
const statusFor = (p: SurveyProject) => (p.delivered_at ? 'Done' : 'In Progress')

export function classifyLinkedDocs(links: string[] | null): { doc: string; sheet: string } {
  const arr = links ?? []
  return {
    doc: arr.find(u => /docs\.google\.com\/document/i.test(u)) ?? '',
    sheet: arr.find(u => /docs\.google\.com\/spreadsheets/i.test(u)) ?? '',
  }
}

/** The sparse {colIndex -> string} cells SOCC owns for a project. captainInitials is
 *  pre-resolved by the caller (primary + co-captains, comma-joined) since it needs team_members. */
export function mappedCells(p: SurveyProject, captainInitials: string): Record<number, string> {
  const { doc, sheet } = classifyLinkedDocs(p.linked_documents)
  return {
    0: p.latest_next_steps ?? '', 1: p.client ?? '', 2: p.project_name ?? '',
    3: fmtBool(p.longitudinal), 4: p.project_type ?? '', 5: statusFor(p),
    6: fmtDate(p.submitted_date), 7: fmtDate(p.launch_date), 8: fmtDate(p.due_date), 9: fmtDate(p.deliver_date),
    10: fmtBool(p.voter_survey_qa), 11: fmtBool(p.citation_language_needed), 12: fmtBool(p.row_level_data),
    13: fmtNum(p.n_target), 14: fmtNum(p.n_internal_target), 15: fmtNum(p.n_collected), 16: fmtNum(p.n_actual),
    17: fmtNum(p.audience_size), 18: captainInitials, 19: fmtBool(p.terminations),
    23: fmtBool(p.stage_doc_programming), 24: fmtBool(p.stage_survey_programming), 25: fmtBool(p.stage_edwin_qa),
    26: fmtBool(p.stage_fielding), 27: fmtBool(p.stage_data_qa), 28: fmtBool(p.stage_delivery),
    32: doc, 34: sheet, 37: p.salesperson ?? '', 38: p.project_code ?? '',
  }
}

/** Full-width row for append: mapped values + blanks everywhere else (keeps positional alignment). */
export function fullRow(cells: Record<number, string>): string[] {
  const row: string[] = new Array(SHEET_WIDTH).fill('')
  for (const [i, v] of Object.entries(cells)) row[Number(i)] = v
  return row
}

/** Stable FNV-1a hash of the mapped cells — change detection independent of updated_at. */
export function rowHash(cells: Record<number, string>): string {
  const canonical = Object.keys(cells).map(Number).sort((a, b) => a - b).map(i => `${i}=${cells[i]}`).join('')
  let h = 0x811c9dc5
  for (let i = 0; i < canonical.length; i++) { h ^= canonical.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16)
}

const colLetter = (i: number) => { let s = ''; let n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }

/** batchUpdate value ranges for one existing row (1-based). Only SOCC-owned contiguous runs,
 *  so team columns (gaps, Comments, Edwin/Deliverable links, Survey IDs) are never overwritten. */
export function updateData(cells: Record<number, string>, rowNumber: number) {
  const runs: [number, number][] = [[0, 19], [23, 28], [32, 32], [34, 34], [37, 38]]
  return runs.map(([a, b]) => ({
    range: `${SURVEYS_TAB}!${colLetter(a)}${rowNumber}:${colLetter(b)}${rowNumber}`,
    values: [Array.from({ length: b - a + 1 }, (_, k) => cells[a + k] ?? '')],
  }))
}
```

- [ ] **Step 2: Commit** `feat(sheet-writeback): pure Surveys column mapping + hash + header guard`.

---

## Task 4: Mapping unit tests

**Files:** Create `lib/sheets/surveysMap.test.ts`.

- [ ] **Step 1: Write tests** covering the behaviors that matter:

```ts
import { describe, it, expect } from 'vitest'
import { mappedCells, fullRow, rowHash, updateData, classifyLinkedDocs, headerGuardOk, EXPECTED_HEADERS, SHEET_WIDTH } from './surveysMap'

const base = {
  latest_next_steps: 'ping client', client: 'A4A', project_name: 'TSA Poll', longitudinal: false,
  project_type: 'PS', delivered_at: null, submitted_date: '2026-07-01', launch_date: null, due_date: '2026-07-20',
  deliver_date: null, voter_survey_qa: true, citation_language_needed: null, row_level_data: false,
  n_target: 400, n_internal_target: 450, n_collected: 0, n_actual: null, audience_size: 100000,
  terminations: false, stage_doc_programming: true, stage_survey_programming: false, stage_edwin_qa: false,
  stage_fielding: false, stage_data_qa: false, stage_delivery: false,
  linked_documents: ['https://docs.google.com/document/d/abc', 'https://docs.google.com/spreadsheets/d/xyz'],
  salesperson: 'Jenna Shrove', project_code: 'PR00057',
} as any

describe('mappedCells', () => {
  it('places values at the correct sheet columns', () => {
    const c = mappedCells(base, 'CT, SC')
    expect(c[1]).toBe('A4A'); expect(c[2]).toBe('TSA Poll'); expect(c[4]).toBe('PS')
    expect(c[5]).toBe('In Progress'); expect(c[13]).toBe('400'); expect(c[17]).toBe('100000')
    expect(c[18]).toBe('CT, SC'); expect(c[37]).toBe('Jenna Shrove'); expect(c[38]).toBe('PR00057')
  })
  it('derives status from delivered_at', () => {
    expect(mappedCells({ ...base, delivered_at: null }, '')[5]).toBe('In Progress')
    expect(mappedCells({ ...base, delivered_at: '2026-07-10' }, '')[5]).toBe('Done')
  })
  it('formats booleans as TRUE/FALSE and null as blank', () => {
    const c = mappedCells(base, '')
    expect(c[10]).toBe('TRUE'); expect(c[12]).toBe('FALSE'); expect(c[11]).toBe('') // citation null -> blank
  })
  it('classifies linked docs into Doc (AG=32) and Sheet (AI=34)', () => {
    const c = mappedCells(base, '')
    expect(c[32]).toContain('/document/'); expect(c[34]).toContain('/spreadsheets/')
  })
})

describe('classifyLinkedDocs', () => {
  it('is blank when no matching link', () => {
    expect(classifyLinkedDocs(null)).toEqual({ doc: '', sheet: '' })
    expect(classifyLinkedDocs(['https://example.com'])).toEqual({ doc: '', sheet: '' })
  })
})

describe('fullRow', () => {
  it('is full-width with blanks in unmapped columns', () => {
    const row = fullRow(mappedCells(base, 'CT'))
    expect(row.length).toBe(SHEET_WIDTH)
    expect(row[20]).toBe(''); expect(row[30]).toBe(''); expect(row[35]).toBe('') // gaps / comments / survey-ids left blank
    expect(row[1]).toBe('A4A'); expect(row[38]).toBe('PR00057')
  })
})

describe('rowHash', () => {
  it('changes when a mapped field changes', () => {
    const a = rowHash(mappedCells(base, 'CT'))
    const b = rowHash(mappedCells({ ...base, n_collected: 10 }, 'CT'))
    expect(a).not.toBe(b)
  })
  it('is stable for identical inputs', () => {
    expect(rowHash(mappedCells(base, 'CT'))).toBe(rowHash(mappedCells(base, 'CT')))
  })
})

describe('updateData', () => {
  it('emits only SOCC-owned ranges for the target row, never the gap/comment columns', () => {
    const ranges = updateData(mappedCells(base, 'CT'), 57).map(r => r.range)
    expect(ranges).toEqual(['Surveys!A57:T57', 'Surveys!X57:AC57', 'Surveys!AG57', 'Surveys!AI57', 'Surveys!AL57:AM57'])
  })
})

describe('headerGuardOk', () => {
  it('passes on the real header order', () => {
    const live: string[] = []
    for (const [i, label] of Object.entries(EXPECTED_HEADERS)) live[Number(i)] = label
    expect(headerGuardOk(live)).toBe(true)
  })
  it('fails if a mapped column drifted', () => {
    const live: string[] = []
    for (const [i, label] of Object.entries(EXPECTED_HEADERS)) live[Number(i)] = label
    live[38] = 'Something Else'
    expect(headerGuardOk(live)).toBe(false)
  })
})
```

- [ ] **Step 2: Run** `npx vitest run lib/sheets` — expect all pass. **Commit** `test(sheet-writeback): mapping unit tests`.

---

## Task 5: Sheets API client

**Files:** Create `lib/sheets/client.ts`.

- [ ] **Step 1: Write the wrapper** (network I/O; kept thin so the logic stays in the pure module + cron):

```ts
import 'server-only'
import { google } from 'googleapis'
import { getGoogleAuth } from '@/lib/drive/google'
import { SURVEYS_TAB, SHEET_WIDTH } from '@/lib/sheets/surveysMap'

const SHEET_ID = '1ZTTJ0PQZ7vj13tmZmsMvKAcEEf0Nc0s8dVbfaYJju7Q'
const lastCol = (() => { let s = ''; let n = SHEET_WIDTH; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s })() // 'AN'

function sheets() { return google.sheets({ version: 'v4', auth: getGoogleAuth() }) }

export async function readHeader(): Promise<string[]> {
  const res = await sheets().spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${SURVEYS_TAB}!1:1` })
  return (res.data.values?.[0] ?? []) as string[]
}

/** Map of PR-code -> 1-based sheet row number (data starts row 2). */
export async function readPrCodeRows(): Promise<Map<string, number>> {
  const res = await sheets().spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${SURVEYS_TAB}!AM2:AM` })
  const rows = res.data.values ?? []
  const map = new Map<string, number>()
  rows.forEach((r, i) => { const pr = String(r?.[0] ?? '').trim(); if (pr) map.set(pr, i + 2) })
  return map
}

export async function appendRow(row: string[]): Promise<void> {
  await sheets().spreadsheets.values.append({
    spreadsheetId: SHEET_ID, range: `${SURVEYS_TAB}!A:${lastCol}`,
    valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', requestBody: { values: [row] },
  })
}

export async function updateCells(data: { range: string; values: string[][] }[]): Promise<void> {
  await sheets().spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data },
  })
}
```

- [ ] **Step 2: Verify** `npx next build`. **Commit** `feat(sheet-writeback): sheets_v4 client wrapper (append/update/read)`.

---

## Task 6: The write-back cron

**Files:** Create `app/api/cron/sheet-writeback/route.ts`.

- [ ] **Step 1: Write the route** (complete):

```ts
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeEqual } from '@/lib/utils/secureCompare'
import { logSystemEvent } from '@/lib/server/observability'
import { mappedCells, fullRow, rowHash, updateData, headerGuardOk, type SurveyProject } from '@/lib/sheets/surveysMap'
import { readHeader, readPrCodeRows, appendRow, updateCells } from '@/lib/sheets/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: NextRequest): boolean {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (safeEqual(bearer, process.env.CRON_SECRET)) return true
  return safeEqual(req.headers.get('x-webhook-secret'), process.env.WEBHOOK_SECRET)
}
function live(): boolean {
  const v = (process.env.SHEET_WRITEBACK_ENABLED ?? '').trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })
  const dry = !live()
  const supabase = createAdminClient()

  // Candidates: client projects, not deleted. (PS/B2B only; excludes Internal + Rerun.)
  const { data: projects, error } = await supabase
    .from('survey_projects')
    .select('*')
    .in('project_type', ['PS', 'B2B'])
    .is('deleted_at', null)
  if (error) {
    await logSystemEvent({ source: 'sheet-writeback', status: 'error', detail: `Query failed: ${error.message}` })
    return Response.json({ mode: dry ? 'dry-run' : 'live', appended: 0, updated: 0, skipped: 0, failed: 0 })
  }

  // team_members -> initials, to resolve captain + co-captains (col S is comma-joined).
  const { data: members } = await supabase.from('team_members').select('id, initials')
  const initialsById = new Map((members ?? []).map(m => [m.id, m.initials]))
  const captainCell = (p: SurveyProject) =>
    [p.captain_id, ...(p.co_captain_ids ?? [])].map(id => (id ? initialsById.get(id) : null)).filter(Boolean).join(', ')

  // Header guard — abort the whole run on drift.
  const header = await readHeader()
  if (!headerGuardOk(header)) {
    await logSystemEvent({ source: 'sheet-writeback', status: 'error', detail: 'Surveys header drifted from the expected mapping — aborting, wrote nothing.' })
    return Response.json({ mode: dry ? 'dry-run' : 'live', aborted: 'header-guard' })
  }

  const prRows = await readPrCodeRows() // PR -> row number (for updates)
  let appended = 0, updated = 0, skipped = 0, failed = 0

  for (const p of (projects ?? []) as SurveyProject[]) {
    try {
      const cells = mappedCells(p, captainCell(p))
      const hash = rowHash(cells)
      if (p.sheet_synced_hash === hash) { skipped++; continue }

      const isNew = !p.sheet_synced_hash
      const rowNum = p.project_code ? prRows.get(p.project_code) : undefined

      if (dry) {
        await logSystemEvent({ source: 'sheet-writeback', status: 'ok', detail: `[dry-run] would ${isNew || !rowNum ? 'APPEND' : 'UPDATE row ' + rowNum}: ${p.project_code} ${p.client} / ${p.project_name}` })
        isNew ? appended++ : updated++
        continue
      }

      if (isNew || !rowNum) { await appendRow(fullRow(cells)); appended++ }
      else { await updateCells(updateData(cells, rowNum)); updated++ }

      await supabase.from('survey_projects').update({ sheet_synced_hash: hash, sheet_synced_at: new Date().toISOString() }).eq('id', p.id)
    } catch (e) {
      failed++
      await logSystemEvent({ source: 'sheet-writeback', status: 'error', detail: `Write failed for ${p.project_code ?? p.id}: ${(e as Error).message}`.slice(0, 500) })
    }
  }

  const result = { mode: dry ? 'dry-run' : 'live', appended, updated, skipped, failed }
  if (!dry && failed === 0 && (appended || updated)) {
    await logSystemEvent({ source: 'sheet-writeback', status: 'ok', detail: `Appended ${appended}, updated ${updated}.` })
  }
  return Response.json(result)
}
```

> Note: a brand-new project not yet in the sheet but whose PR code somehow already appears in `prRows` (e.g. a stale hand-entered row) updates that row instead of duplicating — `isNew || !rowNum` appends only when there is no locatable row.

- [ ] **Step 2: Verify** `npx next build`. **Commit** `feat(sheet-writeback): flag-gated cron (create+update, header-guard, dry-run)`.

---

## Task 7: Schedule the cron

**Files:** Modify `vercel.json`.

- [ ] **Step 1: Add** to `crons`:

```json
    {
      "path": "/api/cron/sheet-writeback",
      "schedule": "0 */4 * * *"
    }
```

- [ ] **Step 2: Commit** `chore(sheet-writeback): schedule cron every 4h (dark until flag on)`.

---

## Task 8: Dry-run validation (verification, no code)

- [ ] With `SHEET_WRITEBACK_ENABLED` unset (dry-run) and deployed, trigger the cron with the webhook secret. Read `system_events` (or the daily-digest health line) and confirm the `[dry-run] would APPEND/UPDATE …` lines look correct for real projects (right client/name/PR, sensible create-vs-update split). Fix mapping issues before enabling. Document findings.

---

## Task 9: Docs

**Files:** Create `docs/SHEET_WRITEBACK_GO_LIVE.md`; Modify `USER_GUIDE.md`.

- [ ] **Step 1: Runbook** — preconditions in order: (1) enable the Google **Sheets API** in the GCP project; (2) confirm the prod credential is durable (Internal OAuth consent or service account) and has **Editor** on the sheet; (3) run migration 053; (4) deploy; (5) trigger a dry-run and review; (6) set `SHEET_WRITEBACK_ENABLED=true`; (7) create a test PS project → confirm the row appears; edit it → confirm mapped cells update and Comments/unmapped stay intact.
- [ ] **Step 2: USER_GUIDE** — one line under the project/list section: new PS/B2B projects and their changes are mirrored into the legacy Surveys sheet automatically during the migration period.
- [ ] **Step 3: Commit** `docs(sheet-writeback): go-live runbook + user guide note`.

---

## Task 10: Final review + ship

- [ ] Adversarial review (SQL/idempotency, cron correctness/double-write, header-guard, mapping fidelity, auth). Fix confirmed findings.
- [ ] `npx next build` + `npx vitest run` green.
- [ ] Rebase onto `origin/main` (parallel session pushes often), push. Feature ships **dark**; go-live is the runbook, gated on David's GCP/credential steps.

---

## Self-Review notes
- **Spec coverage:** create+update+skip (hash), PS/B2B-only, header-guard, dry-run flag, literal PR code, mapped-only updates, migration 053, go-live preconditions — all covered. Survey IDs (AJ) intentionally unmapped (deferred).
- **Type consistency:** `mappedCells(p, captainInitials)` signature is used identically in tests and the cron; `updateData` ranges match the mapped runs (`A:T, X:AC, AG, AI, AL:AM`).
- **No placeholders:** header labels are the real live strings; all code is complete.
