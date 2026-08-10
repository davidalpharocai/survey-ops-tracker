-- 073: Rerun series — first-class recurring-survey record + wave links.
-- Design: docs/superpowers/specs/2026-08-10-rerun-update-design.md (v2, 5-lens reviewed).
-- Claude cannot run DDL — David runs this in the Supabase SQL editor.
--
-- Model: a rerun_series is one recurring survey. Each wave is a normal
-- survey_projects row linked by the NEW column survey_projects.series_id.
-- The pre-existing survey_projects.rerun_series_id keeps its legacy
-- root-project-pointer meaning until the Phase-2 backfill. The wave number is
-- the existing survey_projects.rerun_number (no new wave_no column);
-- wave_order is only the manual drag override.

create table if not exists public.rerun_series (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid references public.clients(id),
  client             text not null,                       -- denormalized for display parity
  survey_name        text not null,
  base_type          text not null check (base_type in ('B2B','PS')),
  origin_project_id  uuid references public.survey_projects(id),   -- wave 1
  cadence_months     integer,                             -- 1/3/6/12; null = ad-hoc
  delivery_cadence   text,                                -- e.g. "Beginning of month"
  in_service         boolean not null default true,
  service_mode       text not null default 'auto' check (service_mode in ('auto','manual')),
  auto_armed         boolean not null default true,       -- seed sets FALSE → first post-load wave is manual
  paused             boolean not null default false,
  template_id        text,
  owner_email        text,                                -- defaults to the rerun captain (Sree)
  next_wave_no       integer not null default 2,
  future_defaults    jsonb not null default '{}'::jsonb,
  anchor_date        date,                                -- fallback "last collection" for seed-only series (no wave linked yet)
  resume_anchor      date,                                -- set on Resume/Re-activate so cadence rebases from now, not the stale last wave
  notes              text,
  data_qa_note       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         text
);
create index if not exists rerun_series_client_idx on public.rerun_series(client_id);
-- Re-runnable seed / no duplicate series per recurring survey.
create unique index if not exists rerun_series_client_survey_uidx
  on public.rerun_series(client_id, lower(survey_name));

alter table public.survey_projects
  add column if not exists series_id uuid references public.rerun_series(id),
  add column if not exists wave_order integer,
  add column if not exists compliance_required_override boolean;
create index if not exists survey_projects_series_idx on public.survey_projects(series_id);
-- Hard idempotency guard: no two live waves share a number within a series.
create unique index if not exists survey_projects_series_wave_uidx
  on public.survey_projects(series_id, rerun_number)
  where series_id is not null and deleted_at is null;

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

-- Read model. All dates computed in America/New_York (not UTC). The cadence
-- anchor is the latest of (last wave's date | seed anchor_date) and resume_anchor,
-- so a resumed / re-activated series does not land instantly "overdue".
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
