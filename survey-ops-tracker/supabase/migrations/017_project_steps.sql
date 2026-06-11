-- Structured next steps: checkable items that move to a completed log
create table if not exists public.project_steps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.survey_projects(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by text
);

create index if not exists project_steps_project_idx
  on public.project_steps (project_id, done, created_at);

alter table public.project_steps enable row level security;

drop policy if exists "authenticated full access steps" on public.project_steps;
create policy "authenticated full access steps"
  on public.project_steps for all to authenticated
  using (true) with check (true);
