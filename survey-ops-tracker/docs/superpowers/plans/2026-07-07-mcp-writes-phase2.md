# Claude Connector Phase 2 (Writes, History & Suggestions) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add create/update tools, history/suggestion reads, and explicit-preference learning to the shipped `/api/mcp` connector — every mutation preview-then-confirm, rule-enforced, attributed "<user> via Claude," and unable to bypass a compliance gate, clobber a concurrent edit, or double-count money.

**Architecture:** Writes run server-side under the existing analyst-gated `withMcpAuth`. Business rules the DB doesn't enforce (compliance gate, stage coupling) are re-run in TS reusing the app's pure helpers; the actual persistence goes through `SECURITY DEFINER` RPCs that set a txn-local `app.actor` GUC so the existing audit triggers attribute the user. A `mcp_tool_calls.detail` log captures every write (incl. client tables that have no audit trigger).

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres + triggers), `mcp-handler` + `@modelcontextprotocol/sdk` + `zod@^3`. Spec: `docs/superpowers/specs/2026-07-07-mcp-writes-phase2-design.md` (**authoritative** — when this plan and the spec disagree, the spec wins).

**Conventions:** Run `npx next build` / `npx vitest run` **from `survey-ops-tracker/`**. David applies SQL migrations manually (the app must degrade gracefully until 046 runs — no import/build-time throws; missing-table errors surface as clean tool errors). Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Repo bans `any` (build error). Use the **Bash tool** for git with two `-m` flags. Commit-only — **do not push** (the controller pushes after the final review).

**Third-party caveat:** verify `mcp-handler` / SDK signatures against the installed `node_modules` before writing tool registrations; preserve the CONTRACTS (endpoint `/api/mcp`, `server.tool(name, desc, zodShape, handler)`, `experimental_withMcpAuth`, server `instructions` via the **2nd** `createMcpHandler` arg).

---

## File structure

- `supabase/migrations/046_mcp_writes.sql` — **new**: column adds + idem index; amend audit actor in 4 functions; the write RPCs.
- `lib/supabase/types.ts` — **modify**: new columns (`client_contacts.created_by`, `mcp_tool_calls.detail/project_id/client_id/error_code/error_message`, `project_blasts.idem_key`, `project_bids.idem_key`) + the new RPC signatures in `Functions`.
- `lib/mcp/writes.ts` — **new**: pure helpers (`pickPatch`/whitelist, `buildProjectPreview`, `stageColumnsFor`, dup-detection) + server helpers (`loadGateInput`, `resolveProjectWritable`, `resolveStep`, `resolveContact`, `runWrite` calling the RPCs + detail-logging).
- `lib/mcp/writes.test.ts` — **new**: TDD for the pure helpers.
- `lib/mcp/data.ts` — **modify**: add `getMe`, `getClientHistory`, `getProjectHistory`; surface `linked_documents` + step ids in `getProjectDetail`.
- `app/api/mcp/route.ts` — **modify**: register the ~22 write tools + 3 read tools; enhance `logged()` to record `detail`/target/error; move server `instructions` into the 2nd `createMcpHandler` arg.
- `USER_GUIDE.md` + `app/(app)/connect/page.tsx` — **modify**: "what you can ask Claude to do & recall."

---

## Task 1: Migration 046 — columns + idempotency index

**Files:** Create `supabase/migrations/046_mcp_writes.sql` (David runs it later — do NOT run SQL).

- [ ] **Step 1: Write the column-adds + index section** at the top of the file:

```sql
-- Phase 2 connector writes: attribution GUC, write audit substrate, idempotency,
-- contact attribution, and SECURITY DEFINER write RPCs.

-- 1) Contact attribution (client_contacts had no created_by).
alter table public.client_contacts add column if not exists created_by text;

-- 2) Queryable write-audit substrate on the existing tool-call log.
alter table public.mcp_tool_calls
  add column if not exists detail jsonb,
  add column if not exists project_id uuid,
  add column if not exists client_id uuid,
  add column if not exists error_code text,
  add column if not exists error_message text;
create index if not exists mcp_tool_calls_project_idx on public.mcp_tool_calls(project_id);
create index if not exists mcp_tool_calls_client_idx  on public.mcp_tool_calls(client_id);

-- 3) Race-safe idempotency for money appends.
alter table public.project_blasts add column if not exists idem_key text;
alter table public.project_bids   add column if not exists idem_key text;
create unique index if not exists project_blasts_idem_uq
  on public.project_blasts(project_id, idem_key) where idem_key is not null;
create unique index if not exists project_bids_idem_uq
  on public.project_bids(project_id, idem_key) where idem_key is not null;
```

- [ ] **Step 2: Commit** (the file will grow in Tasks 2–3; commit incrementally):

```bash
git add survey-ops-tracker/supabase/migrations/046_mcp_writes.sql
git commit -m "feat(mcp): migration 046 part 1 — write-audit columns, contact attribution, idempotency index" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

## Task 2: Migration 046 — amend audit actor to prefer the `app.actor` GUC

**Files:** Modify `supabase/migrations/046_mcp_writes.sql` (append).

The four connector-reachable audit trigger functions currently compute the actor as `coalesce(nullif(auth.email(),''),'system')`. We make them prefer a transaction-local GUC so an attributed RPC can stamp "<user> via Claude". **Backward-compatible:** an unset GUC returns null (via `current_setting(...,true)`) and falls through to `auth.email()`.

- [ ] **Step 1: Read the current bodies** of these functions so you reproduce them faithfully with only the actor expression changed:
  - `supabase/migrations/028_audit_log.sql` — `audit_survey_project_insert()` (the `(created)` marker).
  - `supabase/migrations/035_audit_coverage_and_internal_client_fix.sql` — `audit_survey_project()` (the update diff).
  - `supabase/migrations/029_audit_children.sql` — `audit_project_step()` and `audit_project_bid()`.
  - `supabase/migrations/043_blasts_and_budget.sql` — `audit_project_blast()`.

- [ ] **Step 2: Append `create or replace function` for each**, copied verbatim from the current definition EXCEPT the actor expression, which changes from:

```sql
coalesce(nullif(auth.email(),''),'system')
```

to:

```sql
coalesce(nullif(current_setting('app.actor', true), ''), nullif(auth.email(), ''), 'system')
```

Keep every other line (loop, skip-set, jsonb diff, inserts) identical. Do not change signatures, triggers, or the skip-set. If a function stores the actor in a local variable, change only that assignment.

- [ ] **Step 3: Commit**

```bash
git add survey-ops-tracker/supabase/migrations/046_mcp_writes.sql
git commit -m "feat(mcp): migration 046 part 2 — audit actor prefers app.actor GUC (backward-compatible)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

## Task 3: Migration 046 — the write RPCs

**Files:** Modify `supabase/migrations/046_mcp_writes.sql` (append). All RPCs: `security definer`, `set search_path = public`, `set_config('app.actor', p_actor, true)` first, **no `my_role()` check**, granted to the service role.

- [ ] **Step 1: `mcp_write_project`** — present-key whitelisted update with optimistic lock. Append:

```sql
create or replace function public.mcp_write_project(
  p_id uuid, p_patch jsonb, p_actor text, p_expected_updated_at timestamptz default null
) returns public.survey_projects language plpgsql security definer set search_path = public as $$
declare r public.survey_projects;
begin
  perform set_config('app.actor', p_actor, true);
  select * into r from survey_projects where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Project not found'; end if;
  if p_expected_updated_at is not null and r.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_write: project changed since preview';
  end if;

  -- Whitelisted columns; only keys present in the patch are written; JSON null clears.
  update survey_projects set
    project_name       = case when p_patch ? 'project_name'       then p_patch->>'project_name' else project_name end,
    client             = case when p_patch ? 'client'             then p_patch->>'client' else client end,
    project_type       = case when p_patch ? 'project_type'       then (p_patch->>'project_type')::project_type else project_type end,
    captain_id         = case when p_patch ? 'captain_id'         then nullif(p_patch->>'captain_id','')::uuid else captain_id end,
    co_captain_ids     = case when p_patch ? 'co_captain_ids'     then (select array_agg(x)::uuid[] from jsonb_array_elements_text(p_patch->'co_captain_ids') x) else co_captain_ids end,
    salesperson        = case when p_patch ? 'salesperson'        then p_patch->>'salesperson' else salesperson end,
    priority           = case when p_patch ? 'priority'           then p_patch->>'priority' else priority end,
    blocked_by         = case when p_patch ? 'blocked_by'         then p_patch->>'blocked_by' else blocked_by end,
    status             = case when p_patch ? 'status'             then (p_patch->>'status')::project_status else status end,
    phase              = case when p_patch ? 'phase'              then (p_patch->>'phase')::project_phase else phase end,
    scoping_stage      = case when p_patch ? 'scoping_stage'      then (p_patch->>'scoping_stage')::scoping_stage else scoping_stage end,
    board_column       = case when p_patch ? 'board_column'       then (p_patch->>'board_column')::board_column else board_column end,
    stage_doc_programming    = case when p_patch ? 'stage_doc_programming'    then (p_patch->>'stage_doc_programming')::boolean else stage_doc_programming end,
    stage_survey_programming = case when p_patch ? 'stage_survey_programming' then (p_patch->>'stage_survey_programming')::boolean else stage_survey_programming end,
    stage_edwin_qa           = case when p_patch ? 'stage_edwin_qa'           then (p_patch->>'stage_edwin_qa')::boolean else stage_edwin_qa end,
    stage_fielding           = case when p_patch ? 'stage_fielding'           then (p_patch->>'stage_fielding')::boolean else stage_fielding end,
    stage_data_qa            = case when p_patch ? 'stage_data_qa'            then (p_patch->>'stage_data_qa')::boolean else stage_data_qa end,
    stage_delivery           = case when p_patch ? 'stage_delivery'           then (p_patch->>'stage_delivery')::boolean else stage_delivery end,
    submitted_date     = case when p_patch ? 'submitted_date'     then nullif(p_patch->>'submitted_date','')::date else submitted_date end,
    launch_date        = case when p_patch ? 'launch_date'        then nullif(p_patch->>'launch_date','')::date else launch_date end,
    due_date           = case when p_patch ? 'due_date'           then nullif(p_patch->>'due_date','')::date else due_date end,
    deliver_date       = case when p_patch ? 'deliver_date'       then nullif(p_patch->>'deliver_date','')::date else deliver_date end,
    rerun_date         = case when p_patch ? 'rerun_date'         then nullif(p_patch->>'rerun_date','')::date else rerun_date end,
    n_target           = case when p_patch ? 'n_target'           then nullif(p_patch->>'n_target','')::int else n_target end,
    n_collected        = case when p_patch ? 'n_collected'        then nullif(p_patch->>'n_collected','')::int else n_collected end,
    n_actual           = case when p_patch ? 'n_actual'           then nullif(p_patch->>'n_actual','')::int else n_actual end,
    n_internal_target  = case when p_patch ? 'n_internal_target'  then nullif(p_patch->>'n_internal_target','')::int else n_internal_target end,
    audience_size      = case when p_patch ? 'audience_size'      then nullif(p_patch->>'audience_size','')::int else audience_size end,
    budget             = case when p_patch ? 'budget'             then nullif(p_patch->>'budget','')::numeric else budget end,
    longitudinal       = case when p_patch ? 'longitudinal'       then (p_patch->>'longitudinal')::boolean else longitudinal end,
    voter_survey_qa    = case when p_patch ? 'voter_survey_qa'    then (p_patch->>'voter_survey_qa')::boolean else voter_survey_qa end,
    citation_language_needed = case when p_patch ? 'citation_language_needed' then (p_patch->>'citation_language_needed')::boolean else citation_language_needed end,
    row_level_data     = case when p_patch ? 'row_level_data'     then (p_patch->>'row_level_data')::boolean else row_level_data end,
    terminations       = case when p_patch ? 'terminations'       then (p_patch->>'terminations')::boolean else terminations end,
    survey_tool_id     = case when p_patch ? 'survey_tool_id'     then p_patch->>'survey_tool_id' else survey_tool_id end,
    slack_channel_url  = case when p_patch ? 'slack_channel_url'  then p_patch->>'slack_channel_url' else slack_channel_url end,
    compliance_override= case when p_patch ? 'compliance_override' then (p_patch->>'compliance_override')::boolean else compliance_override end,
    requested_by_contact_id = case when p_patch ? 'requested_by_contact_id' then nullif(p_patch->>'requested_by_contact_id','')::uuid else requested_by_contact_id end,
    requested_by_name  = case when p_patch ? 'requested_by_name'  then p_patch->>'requested_by_name' else requested_by_name end,
    latest_next_steps  = case when p_patch ? 'latest_next_steps'  then p_patch->>'latest_next_steps' else latest_next_steps end,
    linked_documents   = case when p_patch ? 'linked_documents'   then (select array_agg(x) from jsonb_array_elements_text(p_patch->'linked_documents') x) else linked_documents end
  where id = p_id
  returning * into r;
  return r;
end $$;
```

*(Verify each column name/type against `002_survey_projects.sql` + later migrations while reading in Task 2; adjust casts if a column type differs. `co_captain_ids`/`linked_documents` array element types must match the actual column types.)*

- [ ] **Step 2: `mcp_create_project`** — insert inside the RPC so the `(created)` trigger reads the GUC:

```sql
create or replace function public.mcp_create_project(p_patch jsonb, p_actor text)
returns public.survey_projects language plpgsql security definer set search_path = public as $$
declare r public.survey_projects;
begin
  perform set_config('app.actor', p_actor, true);
  insert into survey_projects (project_name, client, project_type, captain_id, salesperson, due_date, n_target, phase, board_column, scoping_stage, submitted_date)
  values (
    p_patch->>'project_name',
    p_patch->>'client',
    nullif(p_patch->>'project_type','')::project_type,
    nullif(p_patch->>'captain_id','')::uuid,
    p_patch->>'salesperson',
    nullif(p_patch->>'due_date','')::date,
    nullif(p_patch->>'n_target','')::int,
    coalesce(nullif(p_patch->>'phase','')::project_phase, 'Scoping'),
    coalesce(nullif(p_patch->>'board_column','')::board_column, 'Submitted'),
    case when (p_patch->>'phase') = 'Active' then null else coalesce(nullif(p_patch->>'scoping_stage','')::scoping_stage, 'New Inquiry') end,
    nullif(p_patch->>'submitted_date','')::date
  ) returning * into r;
  return r;
end $$;
```

- [ ] **Step 3: Attributed child-write RPCs.** Append:

```sql
create or replace function public.mcp_add_step(p_project uuid, p_text text, p_created_by text, p_actor text)
returns public.project_steps language plpgsql security definer set search_path = public as $$
declare r public.project_steps;
begin
  perform set_config('app.actor', p_actor, true);
  insert into project_steps (project_id, text, created_by) values (p_project, p_text, p_created_by) returning * into r;
  return r;
end $$;

create or replace function public.mcp_complete_step(p_step uuid, p_done boolean, p_by text, p_actor text)
returns public.project_steps language plpgsql security definer set search_path = public as $$
declare r public.project_steps;
begin
  perform set_config('app.actor', p_actor, true);
  update project_steps set done = p_done,
    completed_at = case when p_done then now() else null end,
    completed_by = case when p_done then p_by else null end
  where id = p_step returning * into r;
  if not found then raise exception 'Step not found'; end if;
  return r;
end $$;

create or replace function public.mcp_edit_step(p_step uuid, p_text text, p_actor text)
returns public.project_steps language plpgsql security definer set search_path = public as $$
declare r public.project_steps;
begin
  perform set_config('app.actor', p_actor, true);
  update project_steps set text = p_text where id = p_step returning * into r;
  if not found then raise exception 'Step not found'; end if;
  return r;
end $$;

create or replace function public.mcp_set_bid_budget(p_project uuid, p_amount numeric, p_note text, p_created_by text, p_idem text, p_actor text)
returns public.project_bids language plpgsql security definer set search_path = public as $$
declare r public.project_bids;
begin
  perform set_config('app.actor', p_actor, true);
  insert into project_bids (project_id, amount, note, created_by, idem_key)
    values (p_project, p_amount, p_note, p_created_by, p_idem) returning * into r;
  return r;
exception when unique_violation then
  select * into r from project_bids where project_id = p_project and idem_key = p_idem; -- idempotent no-op
  return r;
end $$;

create or replace function public.mcp_log_blast(p_project uuid, p_delivered int, p_bid numeric, p_blast_cost numeric, p_note text, p_created_by text, p_idem text, p_actor text)
returns public.project_blasts language plpgsql security definer set search_path = public as $$
declare r public.project_blasts;
begin
  perform set_config('app.actor', p_actor, true);
  insert into project_blasts (project_id, delivered, bid, blast_cost, note, created_by, idem_key)
    values (p_project, p_delivered, p_bid, p_blast_cost, p_note, p_created_by, p_idem) returning * into r;
  return r;
exception when unique_violation then
  select * into r from project_blasts where project_id = p_project and idem_key = p_idem; -- idempotent no-op
  return r;
end $$;

create or replace function public.mcp_rename_client(p_id uuid, p_new_name text, p_actor text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.actor', p_actor, true);
  update clients set name = p_new_name where id = p_id;
  -- rewrite the denormalized firm text on this client's projects, preserving any " - Contact" suffix
  update survey_projects set client = p_new_name ||
    (case when position(' - ' in coalesce(client,'')) > 0 then substring(client from position(' - ' in client)) else '' end)
  where client_id = p_id and deleted_at is null;
end $$;
```

*(Confirm the exact column lists on `project_bids`/`project_blasts` against `043_blasts_and_budget.sql` while reading in Task 2 — the `amount`/`delivered`/`bid`/`blast_cost`/`note`/`created_by` names must match.)*

- [ ] **Step 4: Grants + commit.** Append `grant execute on function ... to authenticated, service_role;` for each new function, then:

```bash
git add survey-ops-tracker/supabase/migrations/046_mcp_writes.sql
git commit -m "feat(mcp): migration 046 part 3 — SECURITY DEFINER write RPCs (attributed, optimistic-locked, idempotent)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Surface the full 046 SQL to the controller** (David runs it in Supabase; the code tasks build without it applied).

## Task 4: DB types

**Files:** Modify `lib/supabase/types.ts`.

- [ ] **Step 1:** Add the new columns to the relevant `Row`/`Insert`/`Update`:
  - `client_contacts`: `created_by: string | null`.
  - `mcp_tool_calls`: `detail: Json | null`, `project_id: string | null`, `client_id: string | null`, `error_code: string | null`, `error_message: string | null`.
  - `project_blasts` + `project_bids`: `idem_key: string | null`.
- [ ] **Step 2:** Under `public.Functions`, add signatures for `mcp_write_project`, `mcp_create_project`, `mcp_add_step`, `mcp_complete_step`, `mcp_edit_step`, `mcp_set_bid_budget`, `mcp_log_blast`, `mcp_rename_client` (Args objects matching the SQL params; `Returns: unknown` is acceptable — the tools cast the return). Match the existing generated style.
- [ ] **Step 3: Verify build.** Run `npx next build` — expect clean. Commit `feat(mcp): types for 046 columns + write RPCs`.

## Task 5: Pure write helpers (TDD)

**Files:** Create `lib/mcp/writes.ts` + `lib/mcp/writes.test.ts`.

- [ ] **Step 1: Write the failing test** `lib/mcp/writes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pickProjectPatch, stageColumnsFor, diffSummary, PROJECT_WRITE_FIELDS } from './writes'

describe('pickProjectPatch', () => {
  it('keeps only whitelisted, present keys and rejects forbidden ones', () => {
    const { patch, rejected } = pickProjectPatch({ n_target: 900, actual_spend: 5, compliance_override: false, id: 'x' })
    expect(patch).toEqual({ n_target: 900 })
    expect(rejected.sort()).toEqual(['actual_spend', 'compliance_override', 'id'])
  })
  it('allows explicit null for a whitelisted field', () => {
    const { patch } = pickProjectPatch({ due_date: null })
    expect(patch).toEqual({ due_date: null })
  })
})

describe('stageColumnsFor', () => {
  it('mark_delivered sets all six stage booleans true + Delivery', () => {
    const s = stageColumnsFor({ markDelivered: true })
    expect(s.board_column).toBe('Delivery')
    expect(s.stage_delivery).toBe(true)
    expect(s.stage_fielding).toBe(true)
  })
})

describe('diffSummary', () => {
  it('reports only changed fields as [old,new]', () => {
    expect(diffSummary({ n_target: 500, due_date: '2026-07-20' }, { n_target: 900 }))
      .toEqual({ n_target: [500, 900] })
  })
})
```

- [ ] **Step 2: Run → FAIL** (`npx vitest run lib/mcp/writes.test.ts`).
- [ ] **Step 3: Implement** the pure parts of `lib/mcp/writes.ts`:

```ts
import 'server-only'
import { getCheckboxesForColumn, type BoardColumn } from '@/lib/utils/stage'

// Whitelisted editable fields for update_project (the tool-facing subset).
export const PROJECT_WRITE_FIELDS = [
  'project_name','client','project_type','captain_id','co_captain_ids','salesperson','priority','blocked_by',
  'submitted_date','launch_date','due_date','deliver_date','rerun_date',
  'n_target','n_collected','n_actual','n_internal_target','audience_size','budget',
  'longitudinal','voter_survey_qa','citation_language_needed','row_level_data','terminations',
  'survey_tool_id','slack_channel_url','latest_next_steps',
] as const

type Patch = Record<string, unknown>

/** Keep only whitelisted keys actually present; report everything else the caller tried to set. */
export function pickProjectPatch(input: Patch): { patch: Patch; rejected: string[] } {
  const allow = new Set<string>(PROJECT_WRITE_FIELDS)
  const patch: Patch = {}
  const rejected: string[] = []
  for (const k of Object.keys(input)) {
    if (allow.has(k)) patch[k] = input[k]
    else rejected.push(k)
  }
  return { patch, rejected }
}

/** Coupled stage columns. For a normal advance use getCheckboxesForColumn; for delivery set all six true. */
export function stageColumnsFor(opts: { toColumn?: BoardColumn; markDelivered?: boolean }) {
  if (opts.markDelivered) {
    return {
      board_column: 'Delivery' as const,
      stage_doc_programming: true, stage_survey_programming: true, stage_edwin_qa: true,
      stage_fielding: true, stage_data_qa: true, stage_delivery: true,
    }
  }
  const col = opts.toColumn as BoardColumn
  return { board_column: col, ...getCheckboxesForColumn(col) }
}

/** {field:[old,new]} for only the fields whose value changed. */
export function diffSummary(before: Patch, patch: Patch): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {}
  for (const k of Object.keys(patch)) {
    if ((before[k] ?? null) !== (patch[k] ?? null)) out[k] = [before[k] ?? null, patch[k] ?? null]
  }
  return out
}
```

- [ ] **Step 4: Run → PASS.** **Step 5: Commit** `feat(mcp): pure write helpers (whitelist, stage coupling, diff summary)`.

*(Verify `getCheckboxesForColumn`'s return shape + `BoardColumn` export in `lib/utils/stage.ts` before implementing; adapt names if different.)*

## Task 6: Server write helpers (gate input, resolvers, runners)

**Files:** Modify `lib/mcp/writes.ts` (append server-only helpers) + `lib/mcp/data.ts` if a resolver is shared.

- [ ] **Step 1:** Add `loadGateInput(projectId)` — fetch the raw pieces `complianceGate` needs (mirroring the client-side `useComplianceState`): the project's `compliance_override`, the client's `compliance_before_fielding`/`compliance_after_fielding`, and `question_submissions {phase,status}` for the project. Return `{ client, override, submissions }` ready to merge with `{targetColumn, willMarkDelivered}`.
- [ ] **Step 2:** Add `resolveProjectWritable(ref)` — like `resolveProject` but also rejects `project_type='Internal'` (return a clear "internal projects can't be changed via the connector"). Add `resolveStep(projectId, stepRef)` and `resolveContact(clientId, contactRef)` (match by id, else by a human label; ambiguous → return candidates).
- [ ] **Step 3:** Add `runProjectWrite(supabase, {id, patch, actor, expectedUpdatedAt})` → calls `mcp_write_project` rpc, maps a `stale_write` error to a clean "changed since you looked" result. Add thin wrappers `runCreateProject`, `runAddStep`, `runCompleteStep`, `runEditStep`, `runSetBidBudget`, `runLogBlast`, `runRenameClient` calling their RPCs. Each returns the row or throws a clean Error.
- [ ] **Step 4: Verify build** (`npx next build`) + commit `feat(mcp): server write helpers — gate input, writable resolver, RPC runners`.

*(No new test file required — these are thin DB wrappers; Task 5 covers the pure logic. The tools' behavior is exercised in the rollout smoke test.)*

---

## Task 7: Tool plumbing — logged() detail, confirm helper, server instructions slot

**Files:** Modify `app/api/mcp/route.ts`.

- [ ] **Step 1:** Enhance `logged(extra, tool, fn)` to also accept an optional `{ project_id?, client_id?, detail? }` and write them (plus `error_code`/`error_message` on throw) into the `mcp_tool_calls` insert. Keep it fire-and-forget + never breaking the response.
- [ ] **Step 2:** Add a small `confirmable(args, previewFn, commitFn)` helper: if `args.confirm !== true`, return `{ preview: await previewFn() }` (no write); else return `await commitFn()`. Preview objects include a human-readable `summary` string + the structured change.
- [ ] **Step 3:** Move server `instructions` (Task 14 content) into the **2nd** `createMcpHandler` argument (`serverOptions`), which currently is `{}`. Confirm via `node_modules/@modelcontextprotocol/sdk` types that `ServerOptions.instructions` is the field.
- [ ] **Step 4:** Build + commit `feat(mcp): tool plumbing — detail logging, confirm helper, server-instructions slot`.

## Task 8: Append tools (no confirm)

**Files:** Modify `app/api/mcp/route.ts`.

Worked example (`add_next_step`) — the pattern every append follows:

```ts
server.tool('add_next_step', 'Add a to-do/next step to a project.',
  { project: z.string(), text: z.string().min(1).max(1000) },
  async (args, extra) => json(await logged(extra, 'add_next_step', async () => {
    const { userId, userEmail } = authIdentity(extra)
    const p = await resolveProjectWritable(args.project)
    if (!p || 'ambiguous' in p) return p ?? { error: 'Project not found.' }
    const row = await runAddStep(p.id, args.text, userEmail.split('@')[0], `${userEmail} via Claude`)
    return { ok: true, step: { id: row.id, text: row.text } }
  }, { project_id: /* p.id */ undefined })))
```

- [ ] **Step 1:** Implement `add_next_step` (above), `complete_next_step(project, step_ref, done)` → `resolveStep` + `runCompleteStep`, `edit_next_step(project, step_ref, text, confirm)` → `runEditStep` (confirm: preview old→new text), `add_note(project, text)` → insert `project_data_changes {project_id, text, created_by: local-part}` (plain service-role; detail-logged), `add_client_note(client, text)` → insert `client_notes {client_id, body, created_by}`, `link_document(project, url, name?, confirm)` → best-effort title via `/api/doc-title`, then `mcp_write_project` patch appending `{name,url}` JSON to `linked_documents` (read current array first; never overwrite).
- [ ] **Step 2:** Build clean; commit `feat(mcp): append tools — steps, notes, client notes, link document`.

## Task 9: Field-edit tools (preview-then-confirm)

**Files:** Modify `app/api/mcp/route.ts`.

Worked example (`update_project`) — the meatiest handler:

```ts
server.tool('update_project', 'Update a project\'s fields (preview first; confirm to apply).',
  { project: z.string(), fields: z.record(z.any()), confirm: z.boolean().optional(), expected_updated_at: z.string().optional() },
  async (args, extra) => json(await logged(extra, 'update_project', async () => {
    const { userEmail } = authIdentity(extra)
    const p = await resolveProjectWritable(args.project)
    if (!p || 'ambiguous' in p) return p ?? { error: 'Project not found.' }
    const { patch, rejected } = pickProjectPatch(args.fields)
    if (rejected.length) return { error: `These fields can't be set here: ${rejected.join(', ')}. (Use the dedicated tools for status, stage, compliance override, requested-by, or linked docs.)` }
    if (('n_target' in patch || 'n_collected' in patch || 'n_actual' in patch) && p.segment_count > 0)
      return { error: 'This project\'s N is segmented — edit the segments in the app.' }
    if ('client' in patch) patch.client = normalizeClientText(String(patch.client))
    const changed = diffSummary(p, patch)
    if (args.confirm !== true) return { preview: { project_code: p.project_code, changed, summary: describeChanges(changed) }, updated_at: p.updated_at }
    const row = await runProjectWrite(supabase, { id: p.id, patch, actor: `${userEmail} via Claude`, expectedUpdatedAt: args.expected_updated_at })
    return { ok: true, project_code: row.project_code, changed }
  })))
```

- [ ] **Step 1:** Implement `update_project` (above; `describeChanges` = a tiny formatter turning `{field:[old,new]}` into "N target 500 → 900" lines).
- [ ] **Step 2:** `set_requested_by(project, contact_ref, confirm)` — resolve the contact **within the project's client** (`resolveContact`), reject a contact from another client, patch `{requested_by_contact_id, requested_by_name}` via `mcp_write_project`.
- [ ] **Step 3:** `set_bid_budget(project, amount, note?, confirm, idem_key?)` → `runSetBidBudget`; `log_blast(project, delivered, bid, blast_cost, note?, confirm, idem_key?)` → `runLogBlast`. Preview shows the values + (for blast) the projected new spend.
- [ ] **Step 4:** Build clean; commit `feat(mcp): field-edit tools — update_project, requested_by, bid budget, blast`.

## Task 10: Status / stage tools (preview-then-confirm + compliance gate)

**Files:** Modify `app/api/mcp/route.ts`.

Worked example (`advance_project`) — carries the gate:

```ts
server.tool('advance_project', 'Move a project to a pipeline column, or mark it delivered (preview first).',
  { project: z.string(), to_column: z.string().optional(), mark_delivered: z.boolean().optional(),
    override_reason: z.string().optional(), confirm: z.boolean().optional() },
  async (args, extra) => json(await logged(extra, 'advance_project', async () => {
    const { userEmail } = authIdentity(extra)
    const p = await resolveProjectWritable(args.project)
    if (!p || 'ambiguous' in p) return p ?? { error: 'Project not found.' }
    if (p.phase !== 'Active') return { error: 'This project is still in Scoping — approve it first (approve_scoping).' }
    const stage = stageColumnsFor({ toColumn: args.to_column as BoardColumn, markDelivered: args.mark_delivered })
    const willMarkDelivered = !!args.mark_delivered && !p.stage_delivery
    const gi = await loadGateInput(p.id)
    const gate = complianceGate({ targetColumn: stage.board_column, willMarkDelivered, client: gi.client, override: gi.override, submissions: gi.submissions })
    if (gate.blocked && !args.override_reason) return { blocked: true, reason: gate.message }
    const patch: Record<string, unknown> = { ...stage }
    if (gate.blocked && args.override_reason) patch.latest_next_steps = autoStamp(p.latest_next_steps, `⚠ Compliance override (${gate.phase}): ${args.override_reason}`, userEmail.split('@')[0])
    if (args.confirm !== true) return { preview: { project_code: p.project_code, to: stage.board_column, delivered: willMarkDelivered, override: gate.blocked ? args.override_reason : null } }
    const row = await runProjectWrite(supabase, { id: p.id, patch, actor: `${userEmail} via Claude` })
    return { ok: true, project_code: row.project_code, board_column: row.board_column }
  })))
```

- [ ] **Step 1:** Implement `advance_project` (above). **Step 2:** `set_project_status(project, status, confirm)` → patch `{status}`. **Step 3:** `approve_scoping(project, confirm)` → patch `{ phase:'Active', board_column:'Submitted', submitted_date: today, ...getCheckboxesForColumn('Submitted') }`. **Step 4:** `move_to_scoping(project, confirm)` → patch `{ phase:'Scoping', scoping_stage: p.scoping_stage ?? 'Awaiting Approval' }` (do NOT touch board_column/stage_*). **Step 5:** `set_compliance_override(project, value, reason, confirm)` → patch `{ compliance_override: value==='on'?true:value==='off'?false:null, latest_next_steps: autoStamp(...,`Compliance override → ${value}: ${reason}`) }`.
- [ ] **Step 6:** Build clean; commit `feat(mcp): status/stage tools with compliance-gate enforcement`.

## Task 11: Client & contact tools

**Files:** Modify `app/api/mcp/route.ts`.

- [ ] **Step 1:** `update_client(client, fields{compliance_*, compliance_contact, compliance_notes}, confirm)` → plain `clients` update (detail-logged; whitelist these fields; reject `name` → tell user to use `rename_client`). `rename_client(client, new_name, confirm)` → `runRenameClient` (atomic RPC). `create_client(name, compliance_*, confirm)` → normalize `name` via `client_firm_name` (strip ' - Contact'), insert `clients` (on unique conflict return existing).
- [ ] **Step 2:** `add_contact` / `edit_contact` / `archive_contact` — resolve contact within the client; require first+last on add; `created_by` local-part on add. `set_client_preference(client, preference, reason?, confirm)` → insert a tagged `client_notes` row `body = "PREF: " + preference + (reason ? ` — ${reason}` : '')`.
- [ ] **Step 3:** Build clean; commit `feat(mcp): client + contact tools + client preference`.

## Task 12: create_project (conversational duplicate check)

**Files:** Modify `app/api/mcp/route.ts`.

- [ ] **Step 1:** Implement `create_project(project_name, client, project_type?, captain?, salesperson?, due_date?, n_target?, skip_scoping?, confirm?, proceed_despite_duplicate?)`:
  1. Validate required `project_name`/`client`; validate `due_date` format; resolve `captain` → `captain_id` via `team_members` (name/initials).
  2. **Dup check:** query non-deleted `survey_projects` where the same client firm OR `project_name ilike %name%` (sanitized). If any and not `proceed_despite_duplicate` → return `{ possible_duplicates: [{project_code, project_name, client}], needs: 'proceed_despite_duplicate', message: 'There\'s already a project under this client that looks like a possible duplicate.' }` (no write).
  3. Build patch (`normalizeClientText(client)`; `skip_scoping` → `phase:'Active', board_column:'Submitted', submitted_date: today`).
  4. If `confirm !== true` → return a preview (the fields + any dup warning). Else `runCreateProject(patch, `${userEmail} via Claude`)` and return `{ ok:true, project_code, id, client, client_id, phase }`.
- [ ] **Step 2:** Build clean; commit `feat(mcp): create_project with conversational duplicate handling`.

## Task 13: History & suggestion reads

**Files:** Modify `lib/mcp/data.ts` + register the tools in `app/api/mcp/route.ts`.

- [ ] **Step 1:** `getMe(userId)` — `profiles.email` → `team_members` by matching email → return `{ name, initials, role }` (role from profiles). Register `get_me` tool. Add optional `mine:boolean` to the existing `search_projects`/`pipeline_summary` that, when set, resolves the caller's initials via `getMe` and filters by captain.
- [ ] **Step 2:** `getClientHistory(clientRef)` — resolve client; return its non-deleted projects (capped to most-recent 50) each with `{ project_code, project_name, project_type, status, phase, objective, category, n_target, n_collected, n_actual, budget, actual_spend, launch_date, deliver_date, due_date, captain, salesperson, linked_documents, deliverables_count }`, plus `patterns` (typical n_target [median], most-common project_type, avg fielding days [launch→deliver], count/year cadence, recurring contacts from `client_contacts`) and `stated_preferences` (client_notes whose body starts with `PREF:`). Register `get_client_history`.
- [ ] **Step 3:** `getProjectHistory(projectRef)` — resolve project; if it has a `rerun_series_id`, return sibling waves' key stats ordered by date. Register `get_project_history`.
- [ ] **Step 4:** In `getProjectDetail`, add `linked_documents` (parsed) and each next-step's `id` to the returned shape (so `link_document`/`complete_next_step` refs work). 
- [ ] **Step 5:** Build clean; commit `feat(mcp): history & suggestion reads (get_me, client/project history) + get_project ids`.

## Task 14: Server instructions + prompts

**Files:** Modify `app/api/mcp/route.ts`.

- [ ] **Step 1:** Set `instructions` (2nd `createMcpHandler` arg) to the guidance from the spec's "Teaching Claude" section (preview before mutating; ask before proceeding on a possible duplicate; use `get_client_history`/`get_project_history` for "what did we do last time" and hand questionnaire URLs to the user's Drive connector; offer client defaults on create; resolve "me" via `get_me`; use `add_note` to record an interaction; corrections to a logged blast/bid happen in the app; if a tool says N is segmented, don't fight it; offer to save a `set_client_preference` when the user overrides a suggestion going forward).
- [ ] **Step 2:** Register the best-effort prompts (`server.prompt`) "morning-pipeline-review", "log-blast", "create-from-brief" if the installed SDK exposes `server.prompt`; otherwise skip and note it.
- [ ] **Step 3:** Build clean; commit `feat(mcp): server instructions + workflow prompts`.

## Task 15: User guide + Connect page

**Files:** Modify `USER_GUIDE.md` (§10) + `app/(app)/connect/page.tsx`.

- [ ] **Step 1:** Add a "what you can ask Claude to *do* and *recall*" subsection: example write asks ("log a 500-count blast on PR00123", "push PR00119's due date to next Friday", "mark the questionnaire step done", "create a B2B for Coatue, 500N, due July 20"), example recall asks ("what did we do last time for Coatue", "what's overdue for me"), and a note that **corrections to logged blasts/bids happen in the app**. Reinforce the analyst-account requirement.
- [ ] **Step 2:** Build clean; commit `docs(mcp): document connector write + recall capabilities`.

## Task 16: Final verification + ship gate

- [ ] **Step 1:** From `survey-ops-tracker/`: `npx vitest run` (all green incl. the new `writes.test.ts`) and `npx next build` (clean; route list still shows `/api/mcp`).
- [ ] **Step 2:** STOP — do not push. Hand to the controller: (a) migration 046 SQL for David to run; (b) after "success", push; (c) the rollout smoke test from the spec via a connected Claude.

---

## Notes / decisions carried from the spec

- The spec (`2026-07-07-mcp-writes-phase2-design.md`) is authoritative. Key invariants the implementer must not break: **every audit-firing write goes through a GUC-setting RPC** (never a bare service-role insert/update to survey_projects/steps/bids/blasts or a client rename); **`mark_delivered` sets `stage_delivery=true` and passes `willMarkDelivered=true` to the gate**; **`mcp_write_project` only writes present keys**; **write tools reject Internal projects and never touch computed/system columns**; **`compliance_override` only via `set_compliance_override` with a reason**.
- Degrade-gracefully: nothing throws at import/build time if 046 isn't applied; tool calls surface clean errors (the existing `logged`/`cleanErrorMessage` path, extended for `stale_write` → "changed since you looked").
- Reuse the app's pure helpers directly (`complianceGate`, `getCheckboxesForColumn`, `normalizeClientText`, `client_firm_name` equivalent, `autoStamp`) — do not re-implement them, so the connector and UI can't drift.
- Out of scope (do NOT add): delete/merge/restore, role changes, Internal-project writes, bulk writes, editing/deleting logged blasts/bids, a manual project_activity writer.

## Self-review (author checklist — completed)

- **Spec coverage:** every tool + migration item + read tool + server-instructions + docs in the spec maps to a task (1–15). ✓
- **Placeholders:** migration/helper/worked-example code is complete; repetitive sibling tools are specified by exact args + RPC + validation (a complete build spec, not "TODO"). Implementer reproduces the worked example's shape per sibling. ✓
- **Type consistency:** RPC names (`mcp_write_project`, `mcp_create_project`, `mcp_add_step`, `mcp_complete_step`, `mcp_edit_step`, `mcp_set_bid_budget`, `mcp_log_blast`, `mcp_rename_client`) + helper names (`pickProjectPatch`, `stageColumnsFor`, `diffSummary`, `loadGateInput`, `resolveProjectWritable`, `resolveStep`, `resolveContact`, `runProjectWrite`/`runCreateProject`/`run*`) are used identically across tasks. ✓

