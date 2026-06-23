-- Longitudinal auto-rerun: a daily job spawns the next wave of a longitudinal
-- survey a week before its rerun_date. These columns drive it.
alter table public.survey_projects
  add column if not exists rerun_date date,
  add column if not exists rerun_number integer not null default 1,
  add column if not exists rerun_series_id uuid,
  add column if not exists rerun_spawned_at timestamptz;

-- Fast lookup for the cron: projects with a rerun armed and not yet spawned.
create index if not exists survey_projects_rerun_due_idx
  on public.survey_projects (rerun_date)
  where rerun_date is not null and rerun_spawned_at is null;
