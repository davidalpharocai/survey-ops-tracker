-- 130: put is_placeholder back on sales_projects.
--
-- 102 left it out under BOOKKEEPING, alongside sort_order and sheet_synced_hash,
-- and at the time that was right: nothing sales could open cared whether a row
-- was an auto-spawned shell. A sales Insights dashboard does, and gets the
-- headline wrong without it.
--
-- WHY. lib/finance/lifecycle.ts `classify` is the one definition of what a
-- study IS — delivered, live, scoping, cancelled, or a placeholder. Its first
-- line reads is_placeholder:
--
--     if (p.is_placeholder === true && !anyRows && !hasN(p)) return 'placeholder'
--     if (p.board_column === 'Delivery')                     return 'delivered'
--
-- With the column absent the first test can never fire, so every empty rerun
-- shell sitting in the Delivery column classifies as DELIVERED. Those shells
-- are not rare and they are not a hypothetical: auto-spawn creates a wave
-- ahead of time, and 65 of them are delivered-and-empty today. A salesperson's
-- "delivered this quarter" would count work that does not exist, on their own
-- book, in a number they would repeat to a client.
--
-- The analyst Insights page has excluded them since it shipped. This migration
-- is what lets the sales page use the SAME classifier rather than grow a second
-- one that disagrees with it — the failure lib/finance/revenue.ts was written
-- to end.
--
-- IS THIS SAFE TO SHOW. Yes, and it is a disclosure decision, per 102's own
-- rule ("adding a column here makes it visible to every salesperson"). The
-- column is a boolean meaning "this row is an empty shell we created in
-- advance". It carries no money, no internal target, no compliance posture and
-- no tooling handle. A salesperson seeing that a study on their book is a shell
-- is an improvement, not a leak.
--
-- SCOPING IS UNCHANGED. The WHERE is copied from 102 character for character —
-- both arms, OR'd. Row counts must not move: a view that changes what it shows
-- AND who it shows it to in one migration is impossible to check afterwards.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable, no data change.
--
-- ORDERING. Safe in either order. The page reads the view with select('*') and
-- treats a missing is_placeholder as "not known", so it works before this
-- lands — it simply cannot exclude shells yet, and says so on screen.
begin;

-- DROP + CREATE, not CREATE OR REPLACE: adding a column in the middle of the
-- select list is not a "replace" Postgres will accept. That resets the view's
-- ACL, so the grants below are part of the migration, not decoration — see the
-- same note in 102 and 105.
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
  p.longitudinal, p.rerun_date, p.rerun_number, p.series_id, p.wave_order,
  -- 130. The only line this migration adds.
  p.is_placeholder
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
  'Column-restricted, self-scoped projection of survey_projects for the sales tier. A definer view (NOT security_invoker) so it reads past the base table RLS, with security_barrier so a caller-supplied qual cannot be pushed below its scoping. This is the ONLY path a sales session has to project rows: migration 102 dropped both survey_projects sales policies. Adding a column here makes it visible to every salesperson — treat it as a disclosure decision, not a convenience. 130 added is_placeholder so the sales Insights page can use the same lifecycle classifier as the analyst one and exclude empty auto-spawned rerun shells.';

grant select on public.sales_projects to authenticated;
revoke all on public.sales_projects from anon;

commit;

-- VERIFY (as a sales user, not as service_role — the view is gated on
-- my_role() and returns nothing to anyone else):
--
--   select count(*) from public.sales_projects;
--     -> must equal the count from before this migration. Scoping did not
--        change; only the column list did.
--
--   select count(*) filter (where is_placeholder) as shells,
--          count(*)                               as all_rows
--     from public.sales_projects;
--     -> shells is the number of rows the Insights page will now exclude from
--        delivered work.
