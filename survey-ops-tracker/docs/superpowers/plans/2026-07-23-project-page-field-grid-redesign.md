# Project Detail Page — Field-Grid Redesign + ✦ Summary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the SOCC project detail page Overview as a Salesforce-style **field grid** (aligned label→value sections + a slim related rail), add per-segment N with roll-up, an `=` auto-sum on number fields, date/datetime pickers with validation, a B2B-only clickable Slack row, per-stage timing on the Insights tab, and a top-of-Overview **✦ Summary** (hybrid: numbers computed in code, Haiku writes the narrative).

**Architecture:** The current Overview (`app/(app)/projects/[id]/page.tsx`, ~1624 lines) renders a hero stat strip + a two-column grid with a right rail of `SidebarCard` sections. We replace the Overview body with a new `components/project/OverviewFieldGrid.tsx` (main field grid) + keep a slim rail. DB rollups stay trigger-computed on `survey_projects` (extend `sync_segment_totals`); stage timing is greenfield (new `project_stage_history` table + trigger). The ✦ Summary reuses the existing Anthropic infra (`ANTHROPIC_API_KEY`, `logAiUsage`, `getAiBudget`) with a new single-shot endpoint modeled on `app/api/parse-project/route.ts`.

**Tech Stack:** Next.js 15 App Router, Supabase (RLS, hand-applied SQL migrations + manually-maintained `lib/supabase/types.ts`), React Query, TypeScript, Tailwind, `@anthropic-ai/sdk`. Reference design = the interactive POC `socc_project_details_grid_poc` and memory `project-page-ux-redesign`.

**Operational notes (do not skip):**
- Migrations are **hand-applied by David in the Supabase SQL editor** — do NOT assume a CLI push. Each new migration file must be paired with a matching manual edit to `lib/supabase/types.ts`. Next number = **062**.
- Trigger-computed columns on `survey_projects`: `sync_segment_totals()` (039), `recompute_project_spend()` (060). App code reads single numbers off the project row.
- Enum `public.board_column` values (002/033): `'Submitted','Doc Programming','Survey Programming','EdWin QA','Fielding','Data QA','Delivery'`. **Note the real enum says "Survey Programming"** — the POC label "Survey Builder" is display-only; keep the enum value, relabel in `lib/utils/stage.ts` only if David confirms. Ship with the existing enum labels unless told otherwise.
- Keep all writes going through `useUpdateProject` / existing mutation hooks so RLS + audit triggers fire.

---

## File Structure

**New files**
- `supabase/migrations/062_project_page_redesign.sql` — per-segment N columns, stage-history table + trigger, rollup extension.
- `lib/utils/formula.ts` (+ `formula.test.ts`) — `=a+b` auto-sum parser.
- `lib/utils/dateInput.ts` (+ `dateInput.test.ts`) — parse/validate typed dates & datetimes (rejects impossible dates).
- `lib/utils/stageTiming.ts` (+ `stageTiming.test.ts`) — per-stage durations from history rows (clock starts at Doc Programming).
- `lib/hooks/useStageHistory.ts` — query stage-history rows.
- `components/project/fields/FieldGrid.tsx`, `FieldCell.tsx`, `DateCell.tsx`, `NumberCell.tsx`, `SelectCell.tsx` — shared field-grid primitives (lift the local editors out of page.tsx).
- `components/project/OverviewFieldGrid.tsx` — the Details / N&Audience / Money / Flags body.
- `components/project/NSegmentsEditor.tsx` — per-segment N blocks with add/remove + session undo.
- `components/project/summary/ProjectSummaryStrip.tsx` — the ✦ Summary strip.
- `components/project/StageTimePanel.tsx` — Insights "Time in each stage".
- `lib/server/projectSummary.ts` — compute the deterministic metrics payload (reuse `lib/utils/insights.ts`).
- `app/api/project-summary/route.ts` — Haiku narrative endpoint (hybrid).
- `lib/hooks/useProjectSummary.ts` — client hook (fetch + cache + regenerate).

**Modified files**
- `app/(app)/projects/[id]/page.tsx` — swap Overview body for `<OverviewFieldGrid>` + slim rail + `<ProjectSummaryStrip>`; move Slack into People; drop Status field; reorder date fields; delete dead `HeroWaitingOn`.
- `lib/hooks/useProjectSegments.ts` — extend `ProjectSegment`/`SegmentInput` with `n_internal_target`, `audience`, `audience_size`.
- `components/project/ProjectInsights.tsx` — add `<StageTimePanel>`.
- `components/project/PipelineProgress.tsx` + `lib/mcp/writes.ts` (`stageColumnsFor`) — ensure stage-history logging fires (via DB trigger, so ideally no app change; verify).
- `lib/supabase/types.ts` — new columns/tables.
- `lib/utils/aiCost.ts` — already knows `claude-haiku-4-5`; no change unless model differs.

---

## Phase A — Schema & pure logic (no UI)

### Task A1: Migration 062 — per-segment N, stage history, rollup

**Files:** Create `supabase/migrations/062_project_page_redesign.sql`; modify `lib/supabase/types.ts`.

- [ ] **Step 1: Write the migration SQL**

```sql
-- 062_project_page_redesign.sql
-- Redesigned project page: per-segment N model + per-stage timing history.
-- HAND-APPLY in Supabase SQL editor, then update lib/supabase/types.ts.

-- 1) Per-segment N fields. project_segments already has: label, n_target,
--    n_collected, n_actual, sort_order (039). Add the rest so each segment
--    carries its own full N + audience.
alter table public.project_segments
  add column if not exists n_internal_target integer,
  add column if not exists audience text,
  add column if not exists audience_size integer;

-- 2) Extend the rollup to also sum n_internal_target onto the parent project
--    (mirrors n_target/n_collected/n_actual from 039). MUST preserve 039's
--    if/else: reset segment_count to 0 when the last segment is removed
--    (manual single-N mode) — a single count(*)>0-gated UPDATE would leave
--    segment_count stale. Keep `security definer set search_path` like siblings.
create or replace function public.sync_segment_totals() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
  cnt int;
begin
  pid := coalesce(new.project_id, old.project_id);
  select count(*) into cnt from public.project_segments where project_id = pid;
  if cnt > 0 then
    update public.survey_projects s set
      segment_count     = cnt,
      n_target          = (select sum(n_target) from public.project_segments where project_id = pid),
      n_internal_target = (select sum(n_internal_target) from public.project_segments where project_id = pid),
      n_collected       = (select coalesce(sum(coalesce(n_collected,0)),0) from public.project_segments where project_id = pid),
      n_actual          = (select case when count(n_actual) > 0 then sum(n_actual) end from public.project_segments where project_id = pid)
    where s.id = pid;
  else
    update public.survey_projects s set segment_count = 0 where s.id = pid;
  end if;
  return null;
end $$;
-- (trigger project_segments_sync already exists from 039 and calls this fn)

-- 3) Stage-timing history. Clock starts at Doc Programming; Submitted->Doc is
--    intentionally NOT tracked.
create table if not exists public.project_stage_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.survey_projects(id) on delete cascade,
  stage public.board_column not null,
  entered_at timestamptz not null default now(),
  created_by text
);
create index if not exists project_stage_history_pid_idx
  on public.project_stage_history(project_id, entered_at);

-- 4) Log a row whenever board_column advances into Doc Programming or later.
create or replace function public.log_stage_entry() returns trigger
language plpgsql as $$
begin
  if new.board_column is distinct from old.board_column
     and new.board_column in ('Doc Programming','Survey Programming','EdWin QA','Fielding','Data QA','Delivery')
  then
    insert into public.project_stage_history(project_id, stage, entered_at)
    values (new.id, new.board_column, now());
  end if;
  return new;
end $$;

drop trigger if exists survey_projects_stage_history on public.survey_projects;
create trigger survey_projects_stage_history
  after update of board_column on public.survey_projects
  for each row execute function public.log_stage_entry();

-- 5) Backfill: seed a Doc-Programming entry for in-flight projects that are
--    already past Submitted but have no history, using created_at as a floor,
--    and a Delivery entry from delivered_at where present. (Approximate; real
--    timing accrues from go-live forward.)
insert into public.project_stage_history(project_id, stage, entered_at)
select id, 'Doc Programming', coalesce(submitted_date::timestamptz, created_at)
from public.survey_projects
where board_column not in ('Submitted') and phase = 'Active'
  and not exists (select 1 from public.project_stage_history h where h.project_id = survey_projects.id);
```

- [ ] **Step 2: Update `lib/supabase/types.ts`** — add `n_internal_target: number | null`, `audience: string | null`, `audience_size: number | null` to `project_segments` Row/Insert/Update; add a `project_stage_history` table type (id, project_id, stage, entered_at, created_by). Match the existing hand-maintained style.

- [ ] **Step 3: Note for David** — add a header comment in the SQL and flag in the PR that 062 must be hand-applied. Do NOT mark done until confirmed applied (mirrors the 053 "shipped dark, pending apply" pattern).

### Task A2: `=` auto-sum formula parser

**Files:** Create `lib/utils/formula.ts`, `lib/utils/formula.test.ts`.

- [ ] **Step 1: Write failing tests**

```ts
import { evalSum, commitNumber } from './formula'
test('sums a +/- expression', () => { expect(evalSum('=4200+800')).toBe(5000) })
test('supports subtraction', () => { expect(evalSum('=1000+1000-250')).toBe(1750) })
test('strips commas', () => { expect(evalSum('=4,200+800')).toBe(5000) })
test('rejects non-formula', () => { expect(evalSum('4200')).toBeNull() })
test('rejects garbage', () => { expect(evalSum('=4200+abc')).toBeNull() })
test('commitNumber formats a plain int', () => { expect(commitNumber('4200')).toBe('4,200') })
test('commitNumber evaluates a formula', () => { expect(commitNumber('=4200+800')).toBe('5,000') })
test('commitNumber passes through em-dash', () => { expect(commitNumber('—')).toBe('—') })
```

- [ ] **Step 2: Implement** (mirror the POC's `evalFormula`/`commitNum`; only `+`/`-`, no `eval`):

```ts
export function evalSum(s: string): number | null {
  const t = String(s).trim()
  if (t[0] !== '=') return null
  const expr = t.slice(1).replace(/,/g, '').replace(/\s+/g, '')
  if (!/^[-+]?\d*\.?\d+([-+]\d*\.?\d+)*$/.test(expr)) return null
  const m = expr.match(/[+-]?\d*\.?\d+/g)
  if (!m) return null
  return m.reduce((a, x) => a + parseFloat(x), 0)
}
export function commitNumber(raw: string): string {
  const s = String(raw).trim()
  if (s === '' || s === '—') return '—'
  if (s[0] === '=') { const r = evalSum(s); return r == null ? s : Math.round(r).toLocaleString() }
  const n = s.replace(/,/g, '')
  return /^-?\d+(\.\d+)?$/.test(n) ? Math.round(parseFloat(n)).toLocaleString() : raw
}
```

- [ ] **Step 3: Run tests, commit.**

### Task A3: Date & datetime input validation

**Files:** Create `lib/utils/dateInput.ts`, `lib/utils/dateInput.test.ts`.

- [ ] **Step 1: Failing tests** — `parseDateInput('7/23/2026')` → `{y:2026,m:7,d:23}`; `parseDateInput('7/23/0202')` → `null`; `parseDateInput('2/30/2026')` → `null` (Feb 30); `parseDateInput('Jul 6, 2026')` → valid; `toISODate(...)`/`fromISODate(...)` round-trip; `parseDateTimeInput('7/14/2026 2:00pm')` → hour 14; `parseDateTimeInput('7/14/2026 13:99')` → `null`.
- [ ] **Step 2: Implement** — port the POC's `parseDate`/`parseDateTime`/`fmt*`/`toIso*` (month 1–12, day ≤ days-in-month w/ leap years, year 1900–2100). Export helpers the cells use: `parseDateInput`, `parseDateTimeInput`, `formatDate`, `formatDateTime`, `toISODate`, `toISODateTime`.
- [ ] **Step 3: Run tests, commit.**

### Task A4: Stage-timing computation

**Files:** Create `lib/utils/stageTiming.ts`, `lib/utils/stageTiming.test.ts`.

- [ ] **Step 1: Failing tests** — given ordered history rows `[{stage:'Doc Programming',entered_at},{stage:'Survey Programming',...},…]` and a `now`, `stageDurations(rows, now)` returns `[{stage, days, ongoing}]` where each duration = nextEntry − thisEntry (last = now − entry, `ongoing:true`); Submitted is never included; out-of-order rows are sorted.
- [ ] **Step 2: Implement** pure fn (no `Date.now()` inside — take `now` as an arg for testability).
- [ ] **Step 3: Run tests, commit.**

---

## Phase B — Field-grid primitives & Overview body

### Task B1: Shared field-grid primitives

**Files:** Create `components/project/fields/{FieldGrid,FieldCell,DateCell,NumberCell,SelectCell}.tsx`.

- [ ] Lift the inline-edit pattern out of `page.tsx` into reusable cells matching the POC: hover-pencil → inline editor → save on blur/Enter with a "Saved ✓" flash; Escape cancels.
  - `FieldCell` — label + (i) `InfoTooltip` + value + pencil; `onSave(value)`.
  - `NumberCell` — uses `commitNumber` (A2); placeholder `e.g. 4200 or =4200+800`.
  - `DateCell` — text input + calendar button (`<input type="date">` overlay); typed entry validated via `parseDateInput` (A3); inline error on invalid; also supports `datetime` mode for blasts via `parseDateTimeInput`.
  - `SelectCell` — `<select>` (Type, etc.).
  - `FieldGrid` — 2-col responsive grid wrapper + section header (`InfoTooltip`).
- [ ] Every cell renders an `InfoTooltip` from a tips map (tooltips-everywhere).
- [ ] Unit-test `NumberCell`/`DateCell` commit logic via the A2/A3 utils (logic already covered; add a light render test if the harness supports it).

### Task B2: N Segments editor (per-segment full N + audience, add/remove + undo)

**Files:** Create `components/project/NSegmentsEditor.tsx`; modify `lib/hooks/useProjectSegments.ts`.

- [ ] Extend `ProjectSegment`/`SegmentInput` with `n_internal_target`, `audience`, `audience_size`; thread them through `useAddSegment`/`useUpdateSegment`.
- [ ] Render each segment as a block: Segment name; N target / N internal target; N collected / N actual; Audience / Audience size (audience + size on one row). All cells use B1 primitives (numbers via `commitNumber`).
- [ ] Top-level N fields (N target / internal / collected / actual) render **read-only sums** when `segment_count > 0` (values already summed on the project row by the trigger), with a "· Σ N segments" note; when `segment_count === 0` they're directly editable on `survey_projects` (existing `EditableNumberRow` behavior).
- [ ] `+ Add segment` (`useAddSegment`), `✕` remove (`useRemoveSegment`) with a **session-level Undo** (keep last-removed segment payload in component state; Undo re-adds via `useAddSegment` with preserved fields + `sort_order`).
- [ ] Collapse/expand the segment list (local state).

### Task B3: OverviewFieldGrid (Details / N&Audience / Money / Flags)

**Files:** Create `components/project/OverviewFieldGrid.tsx`; modify `app/(app)/projects/[id]/page.tsx`.

- [ ] **Details** section grid (order per POC): Submitted date / Launch date; Due date / Delivery date; **Type / Survey IDs**. Type = `SelectCell` bound to `project_type` (reuse `EditableType` logic). NO Status field. `DateCell`s bound to `submitted_date`/`launch_date`/`due_date`/`deliver_date`. Survey IDs = text (`survey_tool_id`, CSV — keep comma-separated).
- [ ] **N & Audience** — top sum row + `<NSegmentsEditor>` (B2).
- [ ] **Money** — render existing `<BlastConfigWidget>` (B2B) / `<SuppliersWidget>` (PS) FIRST (they already do add/edit/remove + datetime), then a compact **Budget & spend** summary below (Budget `NumberCell` on `budget`; Actual spend + Cost/complete read-only from `project.actual_spend`/computed; budget bar). *Do not rebuild the blast widget — reuse it, just reorder.*
- [ ] **Flags** — five color-coded, click-to-toggle chips (~10px) with icons + `InfoTooltip`, bound to `longitudinal`/`voter_survey_qa`/`citation_language_needed`/`row_level_data`/`terminations` via `useUpdateProject` (reuse `FlagChip` logic; restyle to the POC chip).
- [ ] In `page.tsx`: replace the hero strip + right-rail Sample-N/Flags/Money sections with `<OverviewFieldGrid>`. Keep the left-column Pipeline card, Latest/Next steps, Linked docs, Compliance panel — but relocate them per the POC (see B4). Delete dead `HeroWaitingOn`.

### Task B4: Slim related rail (People + Slack, Rerun, Compliance, Next steps)

**Files:** modify `app/(app)/projects/[id]/page.tsx`.

- [ ] **People** tile: Client link; `<RequestedByRow>` (link to contact — already contact-backed via `requested_by_contact_id`); Captain (full name via `team_members`); Salesperson; **Slack** row (B2B only) — clickable link that opens `slack://channel?team=…&id=…` when `slack_channel_url` encodes a channel, else falls back to the stored URL. Add a small `slackDeepLink(url)` helper.
- [ ] **Rerun series** tile — compact one-liner with ▸ expand to the existing `<WaveSeriesView>` (reuse `components/reruns/WaveSeriesView.tsx`, `compact`).
- [ ] **Compliance** tile — status glance + ▸ expand to reviewer/date/requirement/notes (from `<CompliancePanel>` data).
- [ ] **Latest / next steps** tile — reuse `<LatestNextSteps>`.
- [ ] Relocate the floating Survey IDs card content into Details (already covered in B3); remove the floating card + fix the broken `NewProjectSetupBanner` "✦ Edit by description" pointer (QuickEdit exists at `components/project/QuickEdit.tsx` — point at it, or drop the line).

---

## Phase C — ✦ Summary (hybrid, Haiku)

### Task C1: Deterministic metrics payload

**Files:** Create `lib/server/projectSummary.ts` (+ test).

- [ ] Build `buildSummaryFacts(project, blasts, suppliers, segments, stageHistory, now)` returning a typed object of **exact** figures: stage + days-in-stage (via A4), N collected/target/%, spend/budget/%, cost-per-complete, pace + projected finish vs due (reuse `lib/utils/insights.ts`), overdue days, compliance status, ON flags, rerun wave, open next-steps, blast-completion trend. Plus a computed `watchouts: string[]` (past-due, spend-ahead-of-collection, completion dip) — deterministic, so they never depend on the model.
- [ ] Test the watch-out logic (past-due true/false, dip true/false).

### Task C2: Summary endpoint (Haiku narrative)

**Files:** Create `app/api/project-summary/route.ts`.

- [ ] Model on `app/api/parse-project/route.ts`: `isAllowedEmail` gate, `getAiBudget()`/`logAiUsage`, `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })`, **model `claude-haiku-4-5`**, prompt-cache the system prompt (`withCacheBreakpoint`).
- [ ] System prompt: "You write a terse project status brief. You are GIVEN exact figures — never invent or alter numbers; only phrase them. Output JSON: `{ oneLine, status, progress, money, next }`. Do not restate watch-outs (computed separately)." Input = the C1 facts JSON.
- [ ] Return `{ narrative, facts, watchouts, generated_at }`. Numbers in the response come from `facts`/`watchouts` (code), not the model — the UI renders those; the model only fills prose slots.
- [ ] Add a light cache: store the last result on the project (either a `project_summaries` row or a jsonb column `ai_summary`/`ai_summary_at` — prefer a small column pair added in a follow-up micro-migration 063 if we want persistence; for pass 1, client-side React Query cache keyed by a facts hash is acceptable — decide at build, default to client cache to avoid another migration).

### Task C3: Summary strip UI

**Files:** Create `components/project/summary/ProjectSummaryStrip.tsx`, `lib/hooks/useProjectSummary.ts`; mount in `page.tsx` Overview (top).

- [ ] Collapsible strip (default expanded) matching the POC: header (✦ Summary · AI·Beta chip · "as of" stamp · ↻ regenerate · chevron); one-line takeaway; expanded brief (Status/Progress/Money/Watch-outs/Next) + "AI-generated · verify specifics" footnote; a "Regenerating…" state.
- [ ] `useProjectSummary(projectId)` — fetch/generate; ↻ forces regenerate; auto-invalidate when key fields change (subscribe to the same query keys that stage/N/blast writes invalidate). Show relative "as of" from `generated_at`.

---

## Phase D — Insights stage-time panel

### Task D1: StageTimePanel

**Files:** Create `components/project/StageTimePanel.tsx`, `lib/hooks/useStageHistory.ts`; modify `components/project/ProjectInsights.tsx`.

- [ ] `useStageHistory(projectId)` — query `project_stage_history` ordered by `entered_at`.
- [ ] `<StageTimePanel>` — day-count bars via `stageDurations` (A4); header note "Submitted → Doc Programming · not tracked"; current stage marked "· now". Empty state when no history yet ("timing accrues from the next advance").
- [ ] Insert into `ProjectInsights` **between the KPI row and the performance zone** (additive — keep everything that's there).

---

## Phase E — Verify & ship

### Task E1: Verify
- [ ] `npm run test` (formula, dateInput, stageTiming, projectSummary suites green).
- [ ] `npx tsc --noEmit` and `next build` pass (eslint warnings OK, errors not).
- [ ] Manual: on a B2B project (e.g. PR00259) confirm — field grid renders; date typed-invalid rejected + picker works; `=` auto-sum on a segment/audience size; segment add/remove + undo; Type dropdown (in-field + top badge); Slack row B2B-only + deep link; flags toggle; blast add/edit/remove reorders correctly; ✦ Summary generates, ↻ restamps, watch-outs correct; Insights shows stage bars after an advance. Confirm a PS project shows suppliers (not blasts) and no Slack row.

### Task E2: Ship
- [ ] Update `USER_GUIDE.md` (user-guide-maintenance) with the new Overview, `=` formulas, ✦ Summary, stage timing.
- [ ] Commit on the working branch; open PR to `main`; **flag migration 062 for hand-apply** and keep stage-timing/summary features behind graceful empty-states so the page works before 062 is applied.
- [ ] Final code review (superpowers:requesting-code-review) before merge.

---

## Self-review notes
- **Spec coverage:** every POC element maps to a task — command bar/type chip (existing `EditableType`; B3 in-field + note the header badge already a select), dot pipeline (existing `PipelineProgress`), tabs (existing), ✦ Summary (C), Details/N/Money/Flags (B3), People/Slack/Rerun/Compliance/Next (B4), dates (A3+B1), `=` sums (A2+B1/B2), per-segment N (A1+B2), stage timing (A1+A4+D). 
- **Open decisions for David at build time:** (1) "Survey Programming" enum label vs POC "Survey Builder" — default keep enum, relabel display only if asked. (2) ✦ Summary persistence — client cache (no migration) vs a 063 column pair; default client cache for pass 1. (3) whether Slack shows for Rerun-type B2B trackers or strictly `project_type==='B2B'` — default strict B2B.
- **Risk:** the biggest change is swapping the Overview body in a 1600-line client component — do B3/B4 incrementally, keeping the page compiling after each section moves.
