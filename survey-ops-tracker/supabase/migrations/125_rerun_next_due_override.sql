-- 125: let a person state when the next wave is due, 2026-09-28.
--
-- WHY. Every date on a rerun series is currently derived. `effective_next` is
-- `greatest(last wave date, anchor_date, resume_anchor) + cadence_months`, so
-- the ONLY way to move it is to change the cadence or back-date the anchor —
-- both of which lie about something else in order to fix the due date.
--
-- That is bad enough on a normal series. It is a dead end on the 16 series
-- migration 124 created yesterday: their cadence is deliberately NULL, because
-- it could not be honestly derived from the data. With a null cadence
-- `effective_next` is null, so those series can never show a due date and can
-- never spawn, and the only way out today would be to invent a cadence.
--
-- So: an explicit override. Set it and that IS the next due date, cadence or no
-- cadence. Leave it null and nothing changes.
--
-- HOW IT EXPIRES, which is the part worth reading. The override applies only
-- while it is still AHEAD of the newest wave:
--
--   when next_due_override is not null and (last_on is null or override > last_on)
--
-- Once a wave actually lands on or after the overridden date, the override is
-- spent and the cadence takes over again. That is deliberate and it is the
-- reason nothing has to remember to clear this column. The alternative —
-- honouring it unconditionally and clearing it in the spawn path — puts a
-- forever-due series one missed write away from spawning a wave every night,
-- and app/api/cron/spawn-reruns has already manufactured 65 delivered-but-empty
-- shells without any help from me.
--
-- WHAT ELSE MOVES. `effective_next` feeds the spawn cron, the weekly digest,
-- the rerun calendar and whats_at_risk, so an overridden date drives all of
-- them. That is the point: a due date nobody acts on is a label, not a date.
-- The spawn cron additionally requires service_mode='auto' AND auto_armed AND
-- in_service, so setting this on one of 124's series does NOT put it on the
-- cron — they are all manual, unarmed and out of service until somebody changes
-- that deliberately.
--
-- `is_overdue` now also fires for a series with an override and no cadence,
-- which it could not before. That is the intended new behaviour, not a side
-- effect: those series are exactly the ones nobody can currently see slipping.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable.
begin;

alter table public.rerun_series
  add column if not exists next_due_override date;

comment on column public.rerun_series.next_due_override is
  'An explicit date for the next wave, overriding the cadence arithmetic. Applies only while it is later '
  'than the newest wave date, so it expires by itself once that wave lands and never needs clearing. Null '
  'means the usual computation (last wave or anchor, plus cadence_months).';

-- ---------------------------------------------------------------------------
-- The status view, rebuilt. Same columns in the same order as 074, with the
-- due-date computation lifted into its own CTE so effective_next, days_to_next
-- and is_overdue cannot drift apart - they were three copies of one expression
-- and this migration would have made it three copies of a longer one.
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

-- Supabase default privileges hand every new object in `public` to anon as well,
-- and a DROP + CREATE resets the ACL - so both of these lines are load-bearing,
-- not ceremony. 074 granted without revoking; the revoke is added here.
revoke all on public.rerun_series_status from anon, authenticated, public;
grant select on public.rerun_series_status to authenticated, service_role;

commit;

-- VERIFY:
--
--   -- The column is there and nothing is set yet.
--   select count(*) filter (where next_due_override is not null) as overridden,
--          count(*) as series
--     from public.rerun_series;
--
--   -- The view still returns every series, and the three due columns agree.
--   select count(*) as series,
--          count(effective_next) as with_a_due_date,
--          count(*) filter (where is_overdue) as overdue
--     from public.rerun_series_status;
--
--   -- A backfilled series from 124 can now be given a due date despite having
--   -- no cadence. Pick one, set it, read it back, then decide whether to keep it:
--   --   update public.rerun_series set next_due_override = '2026-10-15'
--   --    where survey_name = 'Spirits';
--   --   select survey_name, cadence_months, next_due_override, effective_next, is_overdue
--   --     from public.rerun_series_status where survey_name = 'Spirits';
--
-- TO UNDO:
--   Restore the view from supabase/migrations/074_rerun_service_tag.sql, then
--   alter table public.rerun_series drop column next_due_override;
