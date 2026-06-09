alter table public.survey_projects
  add column if not exists budget numeric(10,2),
  add column if not exists actual_spend numeric(10,2);
