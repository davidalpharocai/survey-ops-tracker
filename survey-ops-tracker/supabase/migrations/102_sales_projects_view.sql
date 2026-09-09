-- 102: close the sales column leak with a security_barrier view.
--
-- WHY — THIS IS A LIVE LEAK, MEASURED, NOT A THEORETICAL ONE.
--
-- On 2026-09-09 I minted a magic link for alex@alpharoc.ai (the only sales-tier
-- account), exchanged it for a real access_token, and queried PostgREST with the
-- anon key exactly as his browser can:
--
--     survey_projects rows visible: 241
--       budget             READABLE — $124,375 across 26 projects
--       actual_spend       READABLE — $27,176.31 across 17 projects
--       n_internal_target  READABLE — 84 projects
--
--   e.g. PR00261 DE Shaw, budget $9,375, internal target 150 (client-facing 100)
--        PR00253 Berkshire Partners, budget $7,500, internal target 200 (150)
--
-- The internal target is the number David asked to remove outright — "they dont
-- need to see the internal target" — and the pairs above are precisely the
-- we-field-more-than-we-quote gap.
--
-- WHY IT LEAKS. Postgres RLS is ROW-level and CANNOT hide a column. 093's
-- survey_projects_sales_read and 100's survey_projects_sales_account_read each
-- grant a sales user the ROW; once the row is granted every one of its 81
-- columns is readable. app/(sales)/sales/page.tsx carefully omits the three
-- sensitive ones from its select, and that is COSMETIC — one fetch away from
-- being bypassed. A page is not a boundary.
--
-- THE FIX, and both halves are required or it achieves nothing:
--   1. a view owned by the table owner, so it reads survey_projects with the
--      OWNER's privileges and therefore past RLS, exposing an allowlist of
--      columns and doing the scoping in its own WHERE; and
--   2. DROPPING BOTH underlying policies, so the view becomes the only path a
--      sales session has to this table. Dropping one leaves the leak wide open
--      through the other.
--
-- NOT `security_invoker = true`. That flag makes a view read as the CALLER,
-- which re-applies survey_projects RLS and defeats the entire mechanism. The
-- house pattern is migration 008's portal_projects — a plain definer view with
-- (security_barrier) — and it is proven in this database.
--
-- `security_barrier` is a separate guarantee from the ownership one: it stops
-- the planner pushing a caller-supplied qual (a leaky function in a WHERE) below
-- the view's own scoping quals, which is how a filtered view can be made to
-- reveal rows it excluded.
--
-- Safe because no table in this database sets `force row level security`, so the
-- owner genuinely bypasses its own RLS. Verified: no migration issues it.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable.
--
-- SHIPS WITH THE PAGE CHANGE. app/(sales)/sales/page.tsx moves from
-- survey_projects to sales_projects in the same commit — applying this migration
-- without that deploy blanks Alex's pipeline, because dropping the policies
-- leaves him no access to the base table at all. Apply, then deploy, in that
-- order, and the gap is a blank page rather than a leak.
begin;

-- ---------------------------------------------------------------------------
-- 1) The view: an ALLOWLIST of columns.
--
--    Deliberately an allowlist and not `select * except (...)`, because a column
--    added by a future migration must be INVISIBLE until somebody decides it is
--    safe. A denylist leaks every field nobody remembered to add to it — which
--    is exactly how n_internal_target (added long after 093) ended up readable.
--
--    Every one of the 81 columns is accounted for. What is IN, and why:
--      identity        id, project_code, project_name, client, client_id
--      shape           project_type, category, objective
--      where it is     phase, status, scoping_stage, board_column
--      dates           submitted_date, launch_date, due_date, deliver_date,
--                      delivered_at, created_at, updated_at
--      client-facing N n_target, n_target_max, n_collected, n_actual
--      commercials     credits, term_id  (the consumption rollup David asked for)
--      relationships   requested_by_name, requested_by_contact_id, salesperson
--      repeat business longitudinal, rerun_date, rerun_number, series_id,
--                      wave_order
--
--    What is OUT, by group, because a salesperson has no call on it:
--      MONEY WE SPEND     budget, actual_spend — cost, not revenue. NOTE: my own
--                         notes conflict on whether sales should see cost-to-run,
--                         so these are excluded pending David's answer. Widening
--                         a view later is one additive migration; un-leaking a
--                         column is not. Asymmetry decides it.
--      THE INTERNAL GAP   n_internal_target, n_floor_override,
--                         n_floor_override_reason
--      CANDID INTERNAL    latest_next_steps, blocked_by, priority, cancel_reason
--                         TEXT — free-form notes an analyst writes for analysts.
--                         This is the group most likely to embarrass somebody.
--      FEASIBILITY        audience, audience_size, audience_used
--      STAFFING           captain_id, captain_assigned_at, captain_assigned_by,
--                         co_captain_ids
--      STAGE MECHANICS    the six stage_* booleans — board_column already says
--                         where the project is, so these are redundant as well
--                         as internal
--      COMPLIANCE/QA      row_level_data, terminations, occam, voter_survey_qa,
--                         citation_language_needed, compliance_override,
--                         compliance_required_override
--      TOOLING HANDLES    survey_tool_id, survey_ids_from_sheet,
--                         survey_ids_synced_at, survey_id_discrepancy,
--                         n_last_synced, sheet_synced_at, sheet_synced_hash,
--                         calendar_event_id, drive_folder_id, slack_channel_url,
--                         linked_documents
--      BOOKKEEPING        deleted_at (the view guarantees it is null),
--                         cancelled_at, rerun_series_id, rerun_spawned_at,
--                         sprint_number, sort_order, segment_count,
--                         is_placeholder
--
--    The WHERE reproduces 093 + 100 EXACTLY — the same two arms, OR'd, since two
--    additive policies are a union. Scoping must not change in the same
--    migration that changes the mechanism, or a row count that moves is
--    impossible to attribute. Alex sees 241 rows today; he must see 241 after.
-- ---------------------------------------------------------------------------
drop view if exists public.sales_projects;
create view public.sales_projects
with (security_barrier) as
select
  p.id, p.project_code, p.project_name, p.client, p.client_id,
  p.project_type, p.category, p.objective,
  p.phase, p.status, p.scoping_stage, p.board_column,
  p.submitted_date, p.launch_date, p.due_date, p.deliver_date, p.delivered_at,
  p.created_at, p.updated_at,
  p.n_target, p.n_target_max, p.n_collected, p.n_actual,
  p.credits, p.term_id,
  p.requested_by_name, p.requested_by_contact_id, p.salesperson,
  p.longitudinal, p.rerun_date, p.rerun_number, p.series_id, p.wave_order
from public.survey_projects p
where public.my_role() = 'sales'
  and p.deleted_at is null
  and (
    -- 093's arm: the project names me as its salesperson.
    (p.salesperson is not null and p.salesperson = public.my_salesperson_name())
    -- 100's arm: I own the account the project belongs to.
    or exists (
      select 1 from public.clients c
       where c.id = p.client_id
         and c.deleted_at is null
         and c.salesperson = public.my_salesperson_name()
    )
  );

comment on view public.sales_projects is
  'Column-restricted, self-scoped projection of survey_projects for the sales tier. A definer view (NOT security_invoker) so it reads past the base table RLS, with security_barrier so a caller-supplied qual cannot be pushed below its scoping. This is the ONLY path a sales session has to project rows: migration 102 dropped both survey_projects sales policies. Adding a column here makes it visible to every salesperson — treat it as a disclosure decision, not a convenience.';

grant select on public.sales_projects to authenticated;
revoke all on public.sales_projects from anon;

-- ---------------------------------------------------------------------------
-- 2) Drop BOTH sales policies on the base table.
--
--    After this a sales-tier session has NO access to survey_projects: the ~73
--    remaining policies all test my_role() = 'analyst' for exact equality, so
--    they grant a sales user nothing, and the service_role policy is a different
--    role entirely. Server paths are unaffected — they use createAdminClient().
--
--    THIS IS THE HALF THAT ACTUALLY CLOSES THE LEAK. The view alone adds a safe
--    door beside an open window.
-- ---------------------------------------------------------------------------
drop policy if exists survey_projects_sales_read on public.survey_projects;
drop policy if exists survey_projects_sales_account_read on public.survey_projects;

commit;

-- VERIFY AS ALEX, with a real user JWT — the only way to actually test a policy.
-- Do not read the absence of an error as proof of anything.
--
--   1. The base table must now be EMPTY for him, not merely missing columns:
--        GET /rest/v1/survey_projects?select=id            -> []
--      Anything other than [] means a policy still grants rows.
--
--   2. The withheld columns must be GONE, not null:
--        GET /rest/v1/sales_projects?select=budget         -> 42703 does not exist
--        GET /rest/v1/sales_projects?select=n_internal_target -> 42703
--
--   3. The row count must be UNCHANGED at 241, and every row his:
--        GET /rest/v1/sales_projects?select=id             -> 241 rows
--      A different number means the WHERE above does not reproduce 093 + 100 and
--      this migration changed who-sees-what while claiming only to change how.
--
-- scripts/_sales-column-probe.mjs does 1 and 2; run it before and after.
