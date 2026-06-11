-- Per-project log of manual data changes made by engineers/users
create table if not exists public.project_data_changes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.survey_projects(id) on delete cascade,
  text text not null,
  created_by text,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create index if not exists project_data_changes_project_idx
  on public.project_data_changes (project_id, created_at desc);

alter table public.project_data_changes enable row level security;

drop policy if exists "authenticated full access data changes" on public.project_data_changes;
create policy "authenticated full access data changes"
  on public.project_data_changes for all to authenticated
  using (true) with check (true);
