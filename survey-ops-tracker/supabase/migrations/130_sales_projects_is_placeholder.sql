-- 130: the three columns the shared classifier needs, back on sales_projects.
--
-- 102 left is_placeholder out under BOOKKEEPING, alongside sort_order and
-- sheet_synced_hash, and at the time that was right: nothing sales could open
-- cared whether a row was an auto-spawned shell. A sales Insights dashboard
-- does, and gets the headline wrong without it.
--
-- WHY. lib/finance/lifecycle.ts `classify` is the one definition of what a
-- study IS — delivered, live, scoping, cancelled, or a placeholder. Two of its
-- seven lines read columns the sales view does not carry:
--
--     if (p.is_placeholder === true && !anyRows && !hasN(p)) return 'placeholder'
--     if (p.board_column === 'Delivery')                     return 'delivered'
--     if (p.status === 'Cancelled' || p.cancelled_at != null) return 'cancelled'
--
-- With is_placeholder absent the first test can never fire, so every empty
-- rerun shell sitting in the Delivery column classifies as DELIVERED. MEASURED
-- 2026-09-30 on live data: 22 studies carry the flag, 20 of them sit in
-- Delivery with no respondents, and 18 of those 20 fall on a salesperson's
-- book — Alex 7, Jenna 8, Shanu 2, Vineet 1. On Jenna's 134 delivered studies
-- that is a 6% overstatement of her own delivered work, in a number she would
-- repeat to a client.
--
-- (An earlier draft of this file said 65. That was the wrong population: 65 is
-- the count of delivered-and-empty studies generally, and 113 delivered rows
-- have no recorded N today. The classifier only excludes the 20 the spawner
-- FLAGGED; the other 93 are real work whose count was never entered, and they
-- stay counted as delivered — correctly.)
--
-- cancelled_at is here for the same reason, one line further down: the
-- classifier reads status AND the stamp "so a future path that sets only one
-- cannot drop a survey out of the money", and half a test is not the test.
--
-- greenlit_at is not the classifier, it is cycle time. Migration 128 moved the
-- start of the clock from "the day it reached us" to "the day the client
-- approved the questions" (lib/insights/model.ts cycleStartOf, which falls back
-- to submitted_date where the stamp is absent). Without the column here the
-- sales page would silently measure from the OLDER definition, so the same
-- study would show one cycle time to a salesperson and a shorter one to an
-- analyst, with nothing on either screen to say why. Only 3 rows carry a
-- greenlit_at today, so this costs nothing now and prevents the two pages
-- drifting apart as the stage fills in.
--
-- The analyst Insights page has excluded shells since it shipped. This
-- migration is what lets the sales page use the SAME classifier and the SAME
-- clock rather than grow a second set that disagrees with it — the failure
-- lib/finance/revenue.ts was written to end.
--
-- IS THIS SAFE TO SHOW. Yes, and it is a disclosure decision, per 102's own
-- rule ("adding a column here makes it visible to every salesperson"). One
-- boolean meaning "this row is an empty shell we created in advance", and two
-- dates: when the questions were approved, and when the study was called off.
-- No money, no internal target, no compliance posture, no tooling handle. A
-- salesperson seeing that a study on their book is a shell is an improvement,
-- not a leak.
--
-- SCOPING IS UNCHANGED. The WHERE is copied from 102 character for character —
-- both arms, OR'd. Row counts must not move: a view that changes what it shows
-- AND who it shows it to in one migration is impossible to check afterwards.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable, no data change.
--
-- ORDERING. The page needs this FIRST. /sales/insights reads the view with
-- select('*') and, finding no is_placeholder, refuses to draw any figure and
-- says which change is missing — it does not draw the overstated one behind a
-- warning. A count a salesperson reads to a client is not a good place to put
-- an asterisk. Nothing else in the app touches these columns, so applying this
-- is safe at any time and breaks nothing if the page is not deployed yet.
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
  -- 130. The only three lines this migration adds.
  p.is_placeholder,
  p.greenlit_at,
  p.cancelled_at
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
  'Column-restricted, self-scoped projection of survey_projects for the sales tier. A definer view (NOT security_invoker) so it reads past the base table RLS, with security_barrier so a caller-supplied qual cannot be pushed below its scoping. This is the ONLY path a sales session has to project rows: migration 102 dropped both survey_projects sales policies. Adding a column here makes it visible to every salesperson — treat it as a disclosure decision, not a convenience. 130 added is_placeholder, cancelled_at and greenlit_at so the sales Insights page can use the same lifecycle classifier and the same cycle-time clock as the analyst one, rather than a second set that disagrees with it.';

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
--        delivered work. Expect a single-digit number on one book.
