-- 129: guidance on a rerun series, and the notes that were already there,
-- 2026-09-29.
--
-- WHAT DAVID ASKED FOR. "for rerun series records, we should add two text
-- fields. 1) Rerun/Series Guidance, and 2) Notes".
--
-- ONE OF THE TWO ALREADY EXISTS. `rerun_series.notes` has been on the table
-- since migration 073, and `data_qa_note` since the same day. Both are
-- editable in the series record's Edit form. NEITHER IS EVER DISPLAYED — the
-- "Series details" grid shows cadence, delivery cadence, template, owner,
-- anchor, next due, in-service and mode, and stops. So you can type a note,
-- save it, and never see it again without clicking Edit, which is
-- indistinguishable from the field not existing. That half of the ask is a UI
-- fix and needs no SQL; it ships in the same change.
--
-- THE OTHER HALF IS THIS COLUMN. Guidance is not the same thing as a note and
-- not the same thing as the data/QA note either:
--
--   guidance      how to RUN this series - the standing instruction that
--                 should survive whoever happens to pick up the next wave
--   notes         whatever is worth recording about the series right now
--   data_qa_note  a known quirk in this study's DATA (073) - narrower, and
--                 deliberately left alone
--
-- Text, not jsonb and not a separate table: there is exactly one of each per
-- series, nobody needs to query inside them, and a per-series text column is
-- what every neighbouring field already is.
--
-- WHY THE VIEW HAS TO BE REBUILT. `rerun_series_status` is built from
-- `select s.*`, and Postgres expands that star ONCE, when the view is created.
-- A column added to the table afterwards is simply not in the view, so the app
-- - which reads the view, never the table - would never see it. 125 had to do
-- the same thing for next_due_override. The body below is 125's, unchanged
-- apart from carrying the new column through the star.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable.
begin;

alter table public.rerun_series
  add column if not exists guidance text;

comment on column public.rerun_series.guidance is
  'Standing instructions for running this rerun series - how it is fielded, who is asked, what must not '
  'change between waves. Distinct from `notes` (whatever is worth recording right now) and from '
  '`data_qa_note` (a known quirk in this study''s data).';

-- ---------------------------------------------------------------------------
-- The status view, rebuilt so `guidance` reaches the app. Identical to 125
-- other than that: the due-date computation still lives in its own CTE so
-- effective_next, days_to_next and is_overdue cannot drift apart.
-- ---------------------------------------------------------------------------
drop view if exists public.rerun_series_status;
create view public.rerun_series_status with (security_invoker = true) as
with last_wave as (
  select p.series_id,
         max(coalesce(p.launch_date, p.rerun_date, p.deliver_date)) as last_on
  from public.survey_projects p
  where p.series_id is not null and p.deleted_at is null
  group by p.series_id
),
anchored as (
  select s.*,
         lw.last_on,
         greatest(coalesce(lw.last_on, s.anchor_date), s.resume_anchor) as cadence_anchor
  from public.rerun_series s
  left join last_wave lw on lw.series_id = s.id
),
due as (
  select a.*,
         case
           when a.paused or not a.in_service then null
           -- The override, while it is still ahead of the newest wave.
           when a.next_due_override is not null
                and (a.last_on is null or a.next_due_override > a.last_on)
             then a.next_due_override
           when a.cadence_months is not null and a.cadence_anchor is not null
             then (a.cadence_anchor + make_interval(months => a.cadence_months))::date
           else null
         end as effective_next
  from anchored a
)
select d.*,
       (d.effective_next - (now() at time zone 'America/New_York')::date) as days_to_next,
       (d.effective_next is not null
         and d.effective_next < (now() at time zone 'America/New_York')::date) as is_overdue
from due d;

-- Supabase default privileges hand every new object in `public` to anon as
-- well, and a DROP + CREATE resets the ACL - so both of these lines are
-- load-bearing, not ceremony.
revoke all on public.rerun_series_status from anon, authenticated, public;
grant select on public.rerun_series_status to authenticated, service_role;

commit;

-- VERIFY:
--
--   -- The column is there, and nothing is set yet.
--   select count(*) filter (where guidance is not null) as with_guidance,
--          count(*) filter (where notes is not null)    as with_notes,
--          count(*) as series
--     from public.rerun_series;
--
--   -- The view carries it, and still returns every series with its due dates.
--   select count(*) as series,
--          count(guidance) as with_guidance,
--          count(effective_next) as with_a_due_date,
--          count(*) filter (where is_overdue) as overdue
--     from public.rerun_series_status;
--
--   -- Round-trip one, then decide whether to keep it:
--   --   update public.rerun_series set guidance = 'Field Mon-Thu only.'
--   --    where survey_name = 'Spirits';
--   --   select survey_name, guidance from public.rerun_series_status
--   --    where survey_name = 'Spirits';
--
-- TO UNDO:
--   Restore the view from supabase/migrations/125_rerun_next_due_override.sql,
--   then alter table public.rerun_series drop column guidance;
