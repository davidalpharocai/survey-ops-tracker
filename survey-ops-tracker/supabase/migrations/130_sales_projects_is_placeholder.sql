-- 130: the three columns the shared classifier and the cycle-time clock need,
-- added to sales_projects.
--
-- ── READ THIS BEFORE EDITING A sales_* VIEW ─────────────────────────────────
-- The first draft of this file was DROP + CREATE with a column list copied from
-- 102, and it was wrong twice over. Both mistakes are worth keeping on the page
-- because the next person will be tempted by exactly the same shortcut.
--
--   1. 102 IS NOT THE CURRENT DEFINITION. 118 redefined this view and appended
--      captain_name, captain_initials and captain_former. Recreating it from
--      102's list would have silently DROPPED all three — and app/(sales)/
--      sales/surveys/[id]/page.tsx:136 selects them by name, so the Captain
--      field on every sales study page would have started failing. Nothing in
--      the drop would have warned about it. Always build the list from the
--      LATEST migration that creates the view, not from the one that named it.
--
--   2. OTHER VIEWS DEPEND ON THIS ONE. sales_n_collected_freshness (111) and
--      sales_deliverables (118) both build on sales_projects, so a bare DROP is
--      refused (2BP01) and DROP ... CASCADE would take them with it, leaving
--      two views to recreate and two more ACLs to restore.
--
-- Both problems disappear with CREATE OR REPLACE. Postgres accepts a replace
-- that APPENDS columns to the end of the select list — it refuses only a
-- rename, a retype, a reorder or a removal — and that is exactly what this is.
-- The dependents are untouched, and the ACL is not reset, so nothing here is
-- load-bearing on the grants at the bottom (they are repeated anyway: harmless,
-- idempotent, and correct if someone ever turns this back into a DROP).
--
-- ── WHY THESE THREE COLUMNS ─────────────────────────────────────────────────
-- lib/finance/lifecycle.ts `classify` is the one definition of what a study IS.
-- Two of its seven lines read columns this view did not carry:
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
-- (An earlier draft said 65. That was the wrong population: 65 is the count of
-- delivered-and-empty studies generally, and 113 delivered rows have no
-- recorded N today. The classifier only excludes the 20 the spawner FLAGGED;
-- the other 93 are real work whose count was never entered, and they stay
-- counted as delivered — correctly.)
--
-- cancelled_at is here for the line below it: the classifier reads the status
-- AND the stamp "so a future path that sets only one cannot drop a survey out
-- of the money", and half a test is not the test.
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
-- IS THIS SAFE TO SHOW. Yes, and it is a disclosure decision, per 102's own
-- rule ("adding a column here makes it visible to every salesperson"). One
-- boolean meaning "this row is an empty shell we created in advance", and two
-- dates: when the questions were approved, and when the study was called off.
-- No money, no internal target, no compliance posture, no tooling handle.
--
-- SCOPING IS UNCHANGED. Everything above the three new lines is 118's view
-- reproduced exactly — the same columns in the same order, the same LEFT JOIN,
-- the same WHERE. Row counts must not move: a view that changes what it shows
-- AND who it shows it to in one migration is impossible to check afterwards.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable, no data change.
--
-- ORDERING. The page needs this FIRST. /sales/insights reads the view with
-- select('*') and, finding no is_placeholder, refuses to draw any figure and
-- says which change is missing — it does not draw the overstated one behind a
-- warning. A count a salesperson reads to a client is not a good place to put
-- an asterisk. Nothing else in the app touches these three columns, so applying
-- this is safe at any time and breaks nothing if the page is not deployed yet.
begin;

create or replace view public.sales_projects
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
  -- 118, reproduced verbatim. Name and initials only; team_members.email stays
  -- out, and the "(former employee)" parenthetical two rows carry in their name
  -- field is stripped rather than shown to a salesperson. The FACT is still
  -- exposed as its own boolean — it answers "can I still ask this person?" —
  -- so what is removed is the leak of our annotation format, not information.
  -- A REPLACE cannot rename or reorder an existing column, so these three must
  -- stay exactly here, exactly like this.
  nullif(btrim(regexp_replace(tm.name, '\s*\([^)]*\)\s*$', '')), '') as captain_name,
  tm.initials as captain_initials,
  (tm.name ~* '\(former') as captain_former,
  -- 130. The only three lines this migration adds, appended at the END, which
  -- is the whole reason CREATE OR REPLACE is allowed to do this at all.
  p.is_placeholder,
  p.greenlit_at,
  p.cancelled_at
from public.survey_projects p
-- LEFT join: 118 must not change which ROWS a salesperson sees, only which
-- columns. An inner join would silently drop every survey with no captain
-- assigned, which is a scoping change wearing a join's clothes.
left join public.team_members tm on tm.id = p.captain_id
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
  'Column-restricted, self-scoped projection of survey_projects for the sales tier. A definer view (NOT security_invoker) so it reads past the base table RLS, with security_barrier so a caller-supplied qual cannot be pushed below its scoping. This is the ONLY path a sales session has to project rows: migration 102 dropped both survey_projects sales policies. 118 added captain_name/captain_initials/captain_former (never the captain''s email). 130 added is_placeholder, cancelled_at and greenlit_at so the sales Insights page can use the same lifecycle classifier and the same cycle-time clock as the analyst one, rather than a second set that disagrees with it. Adding a column here makes it visible to every salesperson — treat it as a disclosure decision, not a convenience. sales_n_collected_freshness (111) and sales_deliverables (118) depend on this view: replace it, never drop it.';

-- CREATE OR REPLACE does NOT reset the ACL, so unlike 118 these two lines are
-- belt and braces rather than repair. They are idempotent, and they keep the
-- file correct if it is ever turned back into a DROP + CREATE.
grant select on public.sales_projects to authenticated;
revoke all on public.sales_projects from anon;

commit;

-- VERIFY. The view is gated on my_role() = 'sales', so it returns nothing to an
-- analyst session or to service_role — the column list, however, is visible to
-- anyone:
--
--   select column_name, ordinal_position
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'sales_projects'
--    order by ordinal_position;
--     -> captain_name / captain_initials / captain_former must still be there,
--        with is_placeholder, greenlit_at and cancelled_at after them.
--
--   select count(*) from pg_views where viewname in
--     ('sales_n_collected_freshness', 'sales_deliverables');
--     -> 2. Both dependents survive a REPLACE; this is here because they would
--        NOT survive a DROP ... CASCADE.
--
-- As a sales user:
--   select count(*) from public.sales_projects;
--     -> must equal the count from before this migration. Scoping did not
--        change; only the column list grew.
