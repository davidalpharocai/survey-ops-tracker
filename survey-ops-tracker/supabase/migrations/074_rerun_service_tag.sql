-- 074: Rerun-service tag + optional base type.
-- Claude cannot run DDL — David runs this in the Supabase SQL editor.
--
-- Some seeded series (from the legacy "Rerun_DS" sheet) came in tagged only as
-- "Rerun Service" with no PS/B2B base type recorded yet. Per David: leave those
-- base types BLANK for now and mark them with a rerun_service flag, to be
-- classified PS/B2B later. So:
--   1) base_type becomes NULLABLE (the check still permits NULL — `null in (...)`
--      is UNKNOWN, which a CHECK treats as passing — so only the NOT NULL is dropped).
--   2) add rerun_service boolean flag (default false).
--   3) refresh the rerun_series_status view so it exposes the new column.

alter table public.rerun_series
  alter column base_type drop not null;

alter table public.rerun_series
  add column if not exists rerun_service boolean not null default false;

-- Recreate the read model so `a.*` picks up rerun_service (view columns are
-- frozen at creation, so drop + recreate rather than create-or-replace).
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
)
select a.*,
       case
         when a.paused or not a.in_service then null
         when a.cadence_months is not null and a.cadence_anchor is not null
           then (a.cadence_anchor + make_interval(months => a.cadence_months))::date
         else null
       end as effective_next,
       (case
          when a.paused or not a.in_service then null
          when a.cadence_months is not null and a.cadence_anchor is not null
            then ((a.cadence_anchor + make_interval(months => a.cadence_months))::date
                  - (now() at time zone 'America/New_York')::date)
          else null
        end) as days_to_next,
       (not a.paused and a.in_service
         and a.cadence_months is not null and a.cadence_anchor is not null
         and (a.cadence_anchor + make_interval(months => a.cadence_months))::date
             < (now() at time zone 'America/New_York')::date) as is_overdue
from anchored a;
grant select on public.rerun_series_status to authenticated, service_role;
