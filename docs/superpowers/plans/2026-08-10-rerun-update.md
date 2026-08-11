# Rerun Update — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make reruns first-class: a `rerun_series` record owns cadence + future-wave defaults and spawns each wave as a normal project; type becomes B2B/PS with a separate rerun dimension; compliance waived after wave 1; Sree is the primary captain; a weekly digest emails Sree (cc David); and both AI surfaces can ask/report/search/act on reruns.

**Architecture:** New `rerun_series` table (one row per recurring survey) + a new `survey_projects.series_id` FK linking each wave to its series. The existing informal lineage (`rerun_series_id` = root project id, self-healing renumber in `link-rerun`) stays working for legacy data; new series use `series_id`. A weekly cron builds the digest with a pure builder (mirrors `lib/email/reminderDigest.ts`) and sends via `lib/email/send.ts`. New MCP tools are added to the shared `lib/mcp/registry.ts` `TOOLS` array (so the claude.ai connector and the in-app ✦ assistant both get them). Compliance waiver is one change in the pure `lib/utils/compliance.ts` gate, threaded through its 3 enforcement sites.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase/Postgres (enums, RLS, views, triggers, RPCs — DDL run by David in the SQL editor; Claude verifies via REST), Tailwind v4 + shadcn tokens, Vitest, Zod (MCP schemas), Resend/nodemailer (email), Vercel cron.

**Conventions used throughout:**
- **Migrations:** Claude cannot run DDL. Each migration task ends by handing David the SQL to paste into the Supabase SQL editor, then Claude **re-verifies** via a REST/`information_schema` probe (never trust "done").
- **Verify commands:** `npx vitest run <file>` (unit), `npx tsc --noEmit 2>&1 | grep -vE '\.test\.|__tests__'` (types, excluding pre-existing test-file errors), `npx next build`, `npx eslint <files>`. Run the dev server for UI via `preview_start` (`socc-dev`) + the Playwright/`_mint` auth pipeline (see memory `guide-screenshot-pipeline`).
- **Ship:** work on branch `feat/rerun-update` (already created off `origin/main`); squash-merge PRs `--admin`; the Vercel auto-deploy webhook has been unreliable — re-trigger with the empty-commit trick after each merge.
- **Types in lockstep:** `lib/supabase/types.ts` is hand-maintained — every schema change updates it in the same task (Row/Insert/Update + Enums + Views).

---

## File Structure

**Created:**
- `supabase/migrations/073_rerun_series.sql` — `rerun_series` table, `survey_projects.series_id` + `wave_order` + `compliance_required_override`, RLS, `rerun_series_status` view.
- `lib/reruns/series.ts` — pure helpers: effective-next-date, wave-ordering/renumber, field-inheritance for a new wave. Unit-tested.
- `lib/reruns/series.test.ts`
- `lib/reruns/digest.ts` — pure weekly-digest builder (overdue/fielding/delivering/next-week buckets → subject + HTML). Unit-tested. Mirrors `lib/email/reminderDigest.ts`.
- `lib/reruns/digest.test.ts`
- `app/api/cron/rerun-digest/route.ts` — weekly cron; builds + sends the digest via `sendAndLog`.
- `lib/hooks/useRerunSeriesRecord.ts` — hooks for the series record (get/create/set-defaults/pause/end/spawn/link).
- `components/reruns/RerunSeriesRecord.tsx` — the series detail card (fields + future-defaults + waves list w/ drag).
- `app/api/reruns/series/route.ts` — write endpoints for series create/update/defaults/pause/end/spawn (analyst-gated; used by hooks + reused by MCP handlers).
- `scripts/seed-rerun-series.mjs` — one-time Rerun_DS import + dedup cross-check (dry-run first).

**Modified:**
- `lib/supabase/types.ts` — new table/view/columns.
- `lib/utils/compliance.ts` + `lib/utils/compliance.test.ts` — wave-≥2 waiver.
- `lib/hooks/useProjects.ts` — add `series_id`, `rerun_number`, `wave_order`, `salesperson` (salesperson already added) to `SLIM_PROJECT_COLUMNS`.
- `lib/mcp/writes.ts` — `loadGateInput` selects `rerun_number`; `GateInputData` carries it.
- `components/board/Board.tsx`, `app/(app)/page.tsx`, `lib/hooks/usePipelineStage.ts`, `lib/mcp/registry.ts` (advance_project) — pass `rerunNumber` to the gate.
- `app/api/cron/spawn-reruns/route.ts` — spawn keys off rerun-service (series) not `longitudinal`; carries base type (not `'Rerun'`), applies inheritance, sets Sree captain + co-captain, `series_id`.
- `components/board/BoardFilters.tsx`, `components/board/Board.tsx`, `app/(app)/list/page.tsx` — add a separate **Rerun** filter dimension; keep Type = B2B/PS.
- Type badge/chip sites (`ProjectCard.tsx`, `ProjectTable.tsx`, `projects/[id]/page.tsx`, `OverviewFieldGrid.tsx`) — show a `Rerun` chip when in a series; Money section picks widget by base type.
- `lib/mcp/registry.ts` + `lib/mcp/data.ts` + `lib/mcp/toolHelpers.ts` — new tools `search_reruns`, `get_rerun_series`, `rerun_calendar`, `put_in_rerun_service`, `set_rerun_defaults`, `log_wave`/`link_wave`, `pause_rerun`/`resume_rerun`/`end_rerun`; update `rerun_radar` to include series.
- `app/(app)/reruns/*` — surface series + a month view (reads new model).
- `vercel.json` — add the `rerun-digest` weekly cron.
- `USER_GUIDE.md` — reruns section.

---

## Task 1 — Migration 073: `rerun_series` + wave-link columns + status view

**Files:** Create `supabase/migrations/073_rerun_series.sql`; modify `lib/supabase/types.ts`.

- [ ] **Step 1: Write the migration SQL.** Create `073_rerun_series.sql`:

```sql
-- Rerun series: one row per recurring survey. Supersedes the ad-hoc rerun_meta
-- (kept for the legacy sheet-mirror radar; bridged, not dropped, in Phase 1).
create table if not exists public.rerun_series (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid references public.clients(id),
  client             text not null,                -- denormalized for display parity
  survey_name        text not null,
  base_type          text not null check (base_type in ('B2B','PS')),
  origin_project_id  uuid references public.survey_projects(id),  -- wave 1
  cadence_months     integer,                      -- 1/3/6/12; null = ad-hoc
  delivery_cadence   text,                         -- e.g. "Beginning of month"
  in_service         boolean not null default true,
  service_mode       text not null default 'auto' check (service_mode in ('auto','manual')),
  auto_armed         boolean not null default true,   -- seed sets FALSE so the first post-load wave is manual; first manual create / bulk-arm flips it true, then auto (see §18)
  paused             boolean not null default false,
  template_id        text,
  owner_email        text,                         -- defaults to the rerun captain (Sree)
  next_wave_no       integer not null default 2,
  future_defaults    jsonb not null default '{}'::jsonb,
  notes              text,
  data_qa_note       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         text
);
create index if not exists rerun_series_client_idx on public.rerun_series(client_id);

alter table public.survey_projects
  add column if not exists series_id uuid references public.rerun_series(id),
  add column if not exists wave_order integer,               -- manual drag order (null = date order)
  add column if not exists compliance_required_override boolean;  -- force compliance on a specific wave
create index if not exists survey_projects_series_idx on public.survey_projects(series_id);

alter table public.rerun_series enable row level security;
revoke all on public.rerun_series from anon, authenticated;
grant select, insert, update on public.rerun_series to authenticated;
grant all on public.rerun_series to service_role;
drop policy if exists rerun_series_analyst_rw on public.rerun_series;
create policy rerun_series_analyst_rw on public.rerun_series
  for all to authenticated using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');
drop policy if exists rerun_series_service_all on public.rerun_series;
create policy rerun_series_service_all on public.rerun_series
  for all to service_role using (true) with check (true);

-- Read model: each in-service, non-paused series + its computed effective next date
-- (last wave's fielding/rerun date + cadence), overdue / due-soon flags. Mirrors the
-- date math already in rerun_status so the page/digest/AI all agree.
drop view if exists public.rerun_series_status;
create view public.rerun_series_status with (security_invoker = true) as
with last_wave as (
  select p.series_id,
         max(coalesce(p.launch_date, p.rerun_date, p.deliver_date)) as last_on
  from public.survey_projects p
  where p.series_id is not null and p.deleted_at is null
  group by p.series_id
)
select s.*,
       lw.last_on,
       case
         when s.paused or not s.in_service then null
         when s.cadence_months is not null and lw.last_on is not null
           then (lw.last_on + make_interval(months => s.cadence_months))::date
         else null
       end as effective_next,
       ((case when s.paused or not s.in_service then null
              when s.cadence_months is not null and lw.last_on is not null
                then (lw.last_on + make_interval(months => s.cadence_months))::date
              else null end) - (now() at time zone 'America/New_York')::date) as days_to_next  -- Eastern, not UTC (see §18)
from public.rerun_series s
left join last_wave lw on lw.series_id = s.id;
grant select on public.rerun_series_status to authenticated, service_role;
```

- [ ] **Step 2: Update `lib/supabase/types.ts`.** Add `rerun_series` to `Tables` (Row/Insert/Update mirroring the columns), `rerun_series_status` to `Views`, and add `series_id: string | null`, `wave_order: number | null`, `compliance_required_override: boolean | null` to the `survey_projects` Row/Insert/Update. Follow the existing shape (see `rerun_meta` at ~1449 and the `survey_projects` Row at ~191).

- [ ] **Step 3: Typecheck.** Run: `npx tsc --noEmit 2>&1 | grep -vE '\.test\.|__tests__' | head`. Expected: no errors in non-test files.

- [ ] **Step 4: Hand David the SQL + verify.** Post the SQL for David to run in the Supabase SQL editor. Then verify via REST (service key) that the objects exist:

Run (Bash): probe `information_schema.columns` for `survey_projects.series_id` and `select` 0 rows from `rerun_series` + `rerun_series_status`.
Expected: `series_id` present; both relations select without `42P01`.

- [ ] **Step 5: Commit.**

```bash
git add supabase/migrations/073_rerun_series.sql lib/supabase/types.ts
git commit -m "feat(rerun): migration 073 — rerun_series table + wave-link cols + status view"
```

---

## Task 2 — Pure series helpers (`lib/reruns/series.ts`) with tests

**Files:** Create `lib/reruns/series.ts`, `lib/reruns/series.test.ts`.

Pure, DB-free functions so they're cheaply testable and reused by the cron, the spawn route, and the UI.

- [ ] **Step 1: Write failing tests** in `lib/reruns/series.test.ts` covering:
  - `effectiveNext(lastOn, cadenceMonths, {paused,inService})` → date | null (paused/ended → null; null cadence or null lastOn → null; else lastOn + N months).
  - `waveOrderKey(wave)` and `renumberWaves(waves)` → assigns 1..N by `wave_order ?? date`, original (origin) always 1, gaps healed, ties broken by date then created_at. (Mirror `renumberSeries` in `app/api/projects/link-rerun/route.ts:28-45` but generalized to `series_id`.)
  - `nextWaveInherit(series, prevWave, todayISO)` → the field-inheritance object from spec §8: base_type from series; captain = series.owner (Sree) + prev captain into `co_captain_ids`; N target/audience/money model/template from `future_defaults`; dates advanced by cadence; survey_tool_id null; n_collected/n_actual null; stage reset; `compliance_required_override` carried from defaults; `series_id` set; `wave_no = series.next_wave_no`.

- [ ] **Step 2: Run — expect fail.** `npx vitest run lib/reruns/series.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `lib/reruns/series.ts`** to pass. Keep date math in `todayEastern`/date-only strings consistent with `lib/utils/date.ts`.
- [ ] **Step 4: Run — expect pass.** `npx vitest run lib/reruns/series.test.ts` → PASS.
- [ ] **Step 5: Commit.** `git add lib/reruns/series.ts lib/reruns/series.test.ts && git commit -m "feat(rerun): pure series helpers (effective-next, renumber, wave inheritance)"`

---

## Task 3 — Compliance waiver for waves ≥ 2

**Files:** modify `lib/utils/compliance.ts` (+ `.test.ts`), `lib/hooks/useProjects.ts`, `lib/mcp/writes.ts`, `components/board/Board.tsx`, `app/(app)/page.tsx`, `lib/hooks/usePipelineStage.ts`, `lib/mcp/registry.ts`, display surfaces.

- [ ] **Step 1: Failing tests** in `lib/utils/compliance.test.ts`: with client requiring before/after fielding and no approval — `rerunNumber >= 2` → `blocked:false` (waived); `rerunNumber >= 2` **but** `compliance_required_override === true` → `blocked:true` (force wins); `rerunNumber == 1` → unchanged (still blocks). Precedence: override true → required; override false → skip; else wave≥2 → waive; else client flag.
- [ ] **Step 2: Run — expect fail.** `npx vitest run lib/utils/compliance.test.ts`.
- [ ] **Step 3: Implement.** Add `rerunNumber?: number` to `GateInput`; thread into `beforeFieldingRequired`/`afterFieldingRequired` as: `if (override===true) return true; if (override===false) return false; if ((rerunNumber ?? 1) >= 2) return false; return !!client?.flag`.
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Thread `rerunNumber` to all call sites.**
  - `lib/hooks/useProjects.ts`: add `'rerun_number'`, `'series_id'`, `'wave_order'` to `SLIM_PROJECT_COLUMNS`.
  - `components/board/Board.tsx:162` + `app/(app)/page.tsx:179`: pass `rerunNumber: moved.rerun_number`.
  - `lib/hooks/usePipelineStage.ts:164`: pass `rerunNumber: project.rerun_number`.
  - `lib/mcp/writes.ts` `loadGateInput`: add `rerun_number` to the `.select` + `GateInputData`; `registry.ts` advance_project passes it.
  - Display: `ComplianceBanner.tsx`, `CompliancePanel.tsx`, `lib/mcp/data.ts` get_project — treat wave≥2 as not-required so banners don't contradict the gate.
- [ ] **Step 6: Verify** `npx tsc --noEmit` clean; `npx next build` passes.
- [ ] **Step 7: Commit.** `feat(rerun): waive compliance gate for waves ≥ 2 (per-wave override forces it)`

---

## Task 4 — Generalize auto-spawn to rerun-service + inheritance + Sree captain

**Files:** modify `app/api/cron/spawn-reruns/route.ts`; reuse `lib/reruns/series.ts`.

- [ ] **Step 1:** Change the selection query: spawn waves for projects in a series whose `rerun_series_status.effective_next <= horizon` and no un-spawned next wave exists — driven by **rerun-service membership**, not `longitudinal=true`. Keep the legacy `longitudinal`+`rerun_date` path behind a guard so un-migrated series still spawn until seeded.
- [ ] **Step 2:** Build the new wave via `nextWaveInherit(series, prevWave, today)` (Task 2): base type carried (NOT `'Rerun'`), `series_id` set, Sree = captain + prev captain → `co_captain_ids`, dates advanced by cadence, `compliance_required_override` from defaults, run-data reset. Resolve the rerun captain by `RERUN_CAPTAIN_EMAIL` env (default `sreerag@alpharoc.ai`) → `team_members` by email; fall back to initials `SC`.
- [ ] **Step 3:** Increment `rerun_series.next_wave_no`; stamp the origin/prev wave `rerun_spawned_at`.
- [ ] **Step 4: Verify** with a throwaway series against the live DB (create a demo series + a wave, run the route locally with the CRON secret, confirm the next wave is created with base type + Sree + waived compliance). Delete the throwaway after.
- [ ] **Step 5: Commit.** `feat(rerun): auto-spawn keys off rerun-service; carries base type, Sree captain, inheritance`

---

## Task 5 — Weekly digest: pure builder + cron route + vercel cron

**Files:** create `lib/reruns/digest.ts` (+ `.test.ts`), `app/api/cron/rerun-digest/route.ts`; modify `vercel.json`; confirm `lib/email/send.ts` supports `cc`.

- [ ] **Step 1: Failing tests** in `lib/reruns/digest.test.ts`: given series-status rows + waves for a week window, `buildRerunDigest(rows, weekStartISO)` returns `{subject, html}` with four buckets (overdue / fielding this week / delivering this week / next-week preview), counts in the subject, and an **empty-week** case → a short "nothing on the rerun calendar this week" body (still returns a digest). HTML-escape names. Mirror `lib/email/reminderDigest.ts` structure.
- [ ] **Step 2: Run — fail.** `npx vitest run lib/reruns/digest.test.ts`.
- [ ] **Step 3: Implement `lib/reruns/digest.ts`** (pure).
- [ ] **Step 4: Run — pass.**
- [ ] **Step 5: `cc` support.** Check `SendArgs` in `lib/email/send.ts`; if no `cc`, add optional `cc` passed to both nodemailer and Resend. Add a unit test if a test file exists, else keep minimal.
- [ ] **Step 6: Cron route** `app/api/cron/rerun-digest/route.ts` — GET, gated by `CRON_SECRET`/`WEBHOOK_SECRET` (mirror `app/api/cron/rerun-nudges/route.ts`). Query `rerun_series_status` + waves due in the week, build via `buildRerunDigest`, send via `sendAndLog({ to: RERUN_DIGEST_TO ?? 'sreerag@alpharoc.ai', cc: RERUN_DIGEST_CC ?? 'david@alpharoc.ai', subject, html })`. Recipients from env (config-driven).
- [ ] **Step 7: vercel.json** — add `{ "path": "/api/cron/rerun-digest", "schedule": "0 12 * * 1" }` (Mon ~8am ET; matches the daily-digest 12:00-UTC convention — note DST caveat in a comment).
- [ ] **Step 8: Verify** by invoking the route locally with the secret and a seeded demo series; confirm `sendAndLog` returns true and `notification_log` gets a row. (Use `ALPHAROC_NOTIFY_OVERRIDE`-style guard or a test inbox so no real email fires during dev.)
- [ ] **Step 9: Commit.** `feat(rerun): weekly digest email to Sree (cc David) + Monday cron`

---

## Task 6 — Series record UI (fields + future-defaults + waves list w/ drag)

**Files:** create `lib/hooks/useRerunSeriesRecord.ts`, `components/reruns/RerunSeriesRecord.tsx`, `app/api/reruns/series/route.ts`; modify `app/(app)/reruns/*` and `components/project/WaveHistory.tsx` (read via `series_id` when present).

Implements the approved POC (see `docs/superpowers/specs/2026-08-10-rerun-update-design.md` §3/§6/§7 and the two POC widgets). Waves list columns: Wave · Survey ID · **Fielded/rerun date** · Delivered · **N collected** · **N actual** · Status; **whole row clickable** to the wave; **drag handle** reorders → renumbers (writes `wave_order`, calls a renumber endpoint reusing `renumberWaves`).

- [ ] **Step 1:** `app/api/reruns/series/route.ts` — analyst-gated POST actions: `create` (promote a project → wave 1, set base_type/cadence/defaults), `update` (fields), `set_defaults` (future_defaults), `pause`/`resume`/`end`/`reactivate`, `spawn_next`, `reorder` (wave_order + renumber), `link_wave`/`unlink_wave`. Reuse `lib/reruns/series.ts`. Writes via admin client; stamp `updated_by`.
- [ ] **Step 2:** `lib/hooks/useRerunSeriesRecord.ts` — query the series + its waves (via `series_id`), mutations for each action above; invalidate `['rerun-series-record', id]`, `['all-rerun-series']`, `['projects']`.
- [ ] **Step 3:** `components/reruns/RerunSeriesRecord.tsx` — the card: header (client — survey, PS/B2B badge + Rerun chip + in-service/paused/cadence chips, Sree primary + co-captain), Next-wave callout, series-details grid, **Defaults-for-future-waves** section (edit → `set_defaults`), waves list (reuse/extend `components/reruns/WaveSeriesView.tsx` to show N collected + N actual + clickable rows + drag).
- [ ] **Step 4:** Wire into `app/(app)/reruns/series/*` and the project page (`WaveHistory` reads via `series_id` when set, else legacy root).
- [ ] **Step 5: Verify UI** via `preview_start socc-dev` + the mint/Playwright pipeline against a seeded demo series (screenshot the record; confirm drag renumbers, defaults save, pause/end toggle).
- [ ] **Step 6: Commit.** `feat(rerun): first-class series record (fields, future-defaults, waves w/ drag)`

---

## Task 7 — Type split: keep B2B/PS, add a separate Rerun dimension

**Files:** modify the badge/chip sites + filters listed in File Structure.

Do NOT change the `project_type` enum (leave `'Rerun'` legacy value in place, unused going forward — Postgres can't drop enum values cleanly).

- [ ] **Step 1:** Add a `Rerun` chip wherever the type badge renders (`ProjectCard.tsx`, `ProjectTable.tsx`, `projects/[id]/page.tsx`, `OverviewFieldGrid.tsx`) shown when `series_id != null` (or legacy `rerun_number > 1`). Keep the PS/B2B badge from `base type`.
- [ ] **Step 2:** Money section (`OverviewFieldGrid.tsx:131-150`) picks the widget by base type even for rerun waves (removes the "Rerun → show both" fallback for series waves).
- [ ] **Step 3:** Filters — add a separate **Rerun** control (all / reruns only / non-reruns) to `components/board/BoardFilters.tsx` + wire in `Board.tsx` and `list/page.tsx` (mirror the salesperson filter just shipped: optional prop, chip, clear-all, saved-view). Keep the Type control at B2B/PS (legacy `Rerun`-typed rows still match "reruns only").
- [ ] **Step 4:** Verify build + a live filter check (Playwright popover) as in the salesperson-filter task.
- [ ] **Step 5: Commit.** `feat(rerun): B2B/PS type + separate Rerun filter/chip dimension`

---

## Task 8 — Connector + in-app AI parity (search / report / ask / act)

**Files:** modify `lib/mcp/registry.ts` (`TOOLS`), `lib/mcp/data.ts`, `lib/mcp/toolHelpers.ts`; reuse `app/api/reruns/series/route.ts` logic in handlers.

Every tool is one `AssistantTool` entry in `TOOLS` (so both `app/api/mcp/route.ts` and `lib/assistant/engine.ts` get it). Reads return deterministic server-computed data (pattern: `lib/mcp/data.ts`). Writes follow the **confirmable** pattern (handler previews without `confirm:true`, commits with it — mirror `advance_project`/`set_compliance_override`).

- [ ] **Step 1 (read):** `search_reruns` (by client/survey/template/cadence/owner/status), `get_rerun_series` (detail + waves + next date), `rerun_calendar` (date-windowed report: overdue/fielding/delivering, month or quarter) — add `data.ts` functions + registry entries; schemas via Zod.
- [ ] **Step 2 (write, confirmable):** `put_in_rerun_service`, `set_rerun_defaults`, `log_wave`/`link_wave`, `pause_rerun`/`resume_rerun`/`end_rerun` — registry entries calling the shared series logic; preview → confirm.
- [ ] **Step 3:** Update `rerun_radar` (`data.ts:727`) to include first-class series (union with the legacy snapshot radar during transition).
- [ ] **Step 4:** Add rerun guidance to `MCP_INSTRUCTIONS` in `lib/mcp/toolHelpers.ts` (the backtick template — no stray backticks). Add examples: "what reruns are due this week?", "put X into monthly rerun", "how many waves has RP3 had?"
- [ ] **Step 5:** Extend `lib/mcp/registry.test.ts` (schema/registration sanity) + a small handler test for `search_reruns`/`rerun_calendar`.
- [ ] **Step 6: Verify** `npx vitest run lib/mcp/registry.test.ts`; `npx tsc --noEmit`; a live in-app assistant check ("what reruns are due this week?").
- [ ] **Step 7: Commit.** `feat(rerun): connector + assistant tools — search/report/ask/act on reruns`

---

## Task 9 — One-time Rerun_DS seed + dedup cross-check

**Files:** create `scripts/seed-rerun-series.mjs`.

- [ ] **Step 1:** Read the `Rerun_DS` tab (reuse the xlsx/hyperlink-reading approach from `scripts/link-diff.mjs`; export live via `scripts/export-survey-sheet.mjs` first). Map the ~29 rows → `rerun_series` rows (client, survey_name, base_type from the type column, cadence, delivery cadence, template_id, notes, data_qa_note, service_mode from "In Rerun or Manual").
- [ ] **Step 2 (DRY RUN default):** For each candidate, **dedup cross-check** against recently-created `survey_projects` (match on client + survey name + template + date proximity) and against existing `rerun_series`; print a per-candidate report (create / likely-duplicate / needs-decision). Write nothing.
- [ ] **Step 3:** Surface the dedup report to David; get a per-suspect decision (do NOT auto-create suspected dups).
- [ ] **Step 4 (`--apply`):** Create the confirmed series; link the current live wave-1 project where identified (set `series_id`, `origin_project_id`).
- [ ] **Step 5:** Verify counts via REST; spot-check 3 series in the UI.
- [ ] **Step 6: Commit.** `chore(rerun): one-time Rerun_DS seed script + dedup cross-check`

---

## Task 10 — Reruns page month visibility + guide + ship

**Files:** modify `app/(app)/reruns/*`, `USER_GUIDE.md`.

- [ ] **Step 1:** Add a **month view** to the Reruns page (all series' scheduled/overdue waves across clients, from `rerun_series_status` + waves). This is the cross-client home (never on a single series record).
- [ ] **Step 2:** ~~Update `USER_GUIDE.md`~~ — **MOVED OUT.** The guide update is the gated post-ship task (#60): done only after ship + David plays with it + signs off (per David's instruction). Do NOT update the guide in this task.
- [ ] **Step 3:** Full verify — `npx tsc --noEmit` clean, `npx next build` passes, all vitest green; live smoke test of the Reruns page + a spawned wave.
- [ ] **Step 4: Adversarial review** — fan out reviewer agents (Workflow) over the diff (correctness of the compliance waiver + gate threading, spawn inheritance, digest date-window math, dedup safety, RLS on the new table). Fix confirmed findings.
- [ ] **Step 5: Ship** — PR, squash-merge `--admin`, re-trigger Vercel deploy, hand David migration 073 SQL (already run in Task 1 if done then; otherwise now). Update memory (`reruns-tab-plan`, `pending-migrations`).

---

## Phase 2 (deferred — separate spec/plan later)
- Expand-in-place Reruns UX (details card → expand to waves on one screen).
- Historical backfill: re-type legacy `Rerun`-typed projects to real B2B/PS; link old delivered waves into series; retire `rerun_meta`/sheet mirror once series is the sole source.

---

## Self-review notes
- **Spec coverage:** §3 (Task 1,6), §4 (1), §5 (7), §6 (2,6), §7 (2,6,8), §8 (2,4), §9 (3), §10 (2,4), §11 (4,6,8), §12 (5,10), §13 (9), §14 (8) — all covered.
- **Ordering risk:** Tasks 1→2→3 are foundational; 4/5/6/7/8 depend on 1–2; 9 depends on 1,6,8; 10 last. Compliance (3) is independent of the series table except the SLIM column add.
- **Migration numbering:** confirm `073` is unused (`ls supabase/migrations | tail`); bump if taken.
- **Legacy bridge:** the old `rerun_series_id` root-pointer + `link-rerun` renumber keep working for un-seeded data; new series use `series_id`. Unifying/retiring the legacy path is Phase 2.

---

## Review-hardening addendum (v2 — 5-lens adversarial review, 2026-08-10)

Apply these deltas on top of the task steps above; they resolve the review findings (rationale in spec §18).

**Task 1 (migration 073):**
- `service_mode` default `auto`; add `auto_armed boolean not null default true`.
- **No `wave_no` column** — the wave number is the existing `rerun_number`; `wave_order` is only the drag override.
- Add `unique (series_id, rerun_number) where deleted_at is null` — hard guard against duplicate/racey spawns.
- Add a **resume anchor** column (`resume_anchor date null`); the view uses `effective_next = max(last_wave_on, resume_anchor) + cadence` so a resumed/re-activated series isn't instantly overdue.
- View computes overdue/`days_to_next` in `America/New_York`, not UTC.
- Also add a nullable **anchor** for seed-only series with no linked wave yet (fallback for `last_wave_on`), so a freshly-seeded series still computes a due date.

**Task 3 (compliance):** waive when `(rerun_number ?? 1) >= 2` **regardless of client flag** (client flag still gates Wave 1); per-wave `compliance_required_override=true` forces it back on. Add the positive banner state ("not required — rerun wave; override to force"). Tests: strict-client wave 2 → waived; wave 2 + override → blocked; wave 1 → unchanged.

**Task 4 (spawn):** selection filters on the prior wave's `rerun_spawned_at is null` AND `service_mode='auto' AND auto_armed AND not paused AND in_service`; the new wave gets a **concrete** next `rerun_date` (never blank) so `last_wave_on` advances; the legacy `longitudinal` path adds `AND series_id IS NULL`; carry **child rows** (suppliers/launches/blasts/segments) via `lib/server/clone.ts`; seed co_captain_ids once (original captain) and carry verbatim. Test: two back-to-back cron runs → exactly one wave; a row that's both `longitudinal` and in a series → exactly one wave.

**Task 5 (digest):** build a **branded, table-based, inline-styled** email shell (navy `#010B40` header, teal `#0076AF` links) safe in Gmail/Outlook (no flex/inline-block pills); add `cc` to `SendArgs` (thread to nodemailer + Resend) and include `template`/`submissionId:null` in the call; **union legacy `rerun_status` reruns** into the digest during transition; empty-week subject shows `(0)`; DST note (arrives 7–8am ET); config'd base URL. **Retire the `rerun-nudges` cron** (remove from vercel.json / keep `RERUN_NUDGES_ENABLED` off) so Sree isn't double-emailed.

**Task 6 (series record UI):** give reorder its **own dedicated drag handle** (vertical-only) distinct from the legacy cross-series move; drop indicator + on-drop toast naming the new order. Distinct save toasts ("Wave 3 updated" vs "Future-wave defaults updated — affects new waves") + scope microcopy. Waves list: **reduced column set** in the narrow project-page rail, full 7-col only on the record (or wrap in `overflow-x` thin-scroll); N via `fmtNum`. Add empty ("No waves yet — Create the next wave"), loading (skeleton), and error states. Add the project-page **"Put into rerun service"** action (Actions menu, near Clone) + dialog (cadence, Auto/Manual [default Auto], captain=Sree, and a "Defaults for future waves — this project stays as Wave 1" block with a computed first-auto-wave-date preview). Hide the legacy `rerun_meta` Paused control for seeded series. Implement the **pause/end pending-wave prompt** (cancel-or-leave the already-spawned un-fielded wave).

**Task 7 (type split):** remove `Rerun` from every **editable** type selector (`OverviewFieldGrid` TYPE_OPTIONS, the `EditableType` dropdown) — render-only for legacy rows. Dedicated **teal-outline `↻ Rerun` chip** (no color collision); for legacy `project_type='Rerun'` rows with no base type, keep the historical badge so they're never badge-less, and keep the Money "show both" fallback. Extend the split to the **Calendar** filter (`CalendarFilters` + `lib/calendar/events`) — Sree's tool — as the same all/reruns-only/non-reruns dimension. "reruns only" matches `series_id IS NOT NULL OR rerun_number>1 OR project_type='Rerun'`; add its Chip + activeCount + clearAll; migrate any saved view storing `Type='Rerun'`.

**Task 8 (connector/AI):** reports/`rerun_calendar`/`search_reruns`/updated `rerun_radar` count reruns by the **rerun dimension** (series membership OR legacy), not `project_type`; `rerun_radar` unions legacy + new and de-dupes on client+survey. Settle the lexicon: "Create next wave" (new project) / "Link existing wave" / rename legacy "Log wave collected" → "Mark wave collected"; put these exact phrasings in `MCP_INSTRUCTIONS`.

**Task 9 (seed):** unique upsert key `(client_id, survey_name)` so the script is re-runnable; normalize names with `baseRerunName()` before the dedup compare and include existing `rerun_series` in the match; resolve `base_type` and `service_mode` from the Rerun_DS columns, routing ambiguous/blank/`Rerun` rows into the **per-item David decision** flow (don't guess/error on the check constraint); **migrate the whole legacy series** (set `series_id` on every existing wave, set `next_wave_no = max(existing)+1`); set `auto_armed=false` on seeded series and clear/reconcile `longitudinal` so the legacy spawn path won't fire.

**Task 10 (visibility/ship):** month view pins a persistent **"Overdue / needs action"** strip above the grid (never hidden) + prev/next-month + today controls. Page IA: new series/month view is primary; the legacy sheet Radar is labelled "legacy (migrating), read-only" and a seeded study is de-duped/badged to its series. **Guide update is NOT here** — it's the gated post-ship task (#60) after David plays + signs off. Note the RLS dependency: reruns visibility assumes the analyst role; a read policy is needed before any future non-analyst (sales) role.
