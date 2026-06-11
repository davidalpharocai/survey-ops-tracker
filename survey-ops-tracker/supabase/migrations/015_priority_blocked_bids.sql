-- Priority flag (default none), blocked-by override for Waiting On,
-- and bid history with optional blast counts for weighted averages
alter table public.survey_projects
  add column if not exists priority text not null default 'none'
    check (priority in ('none', 'high', 'urgent')),
  add column if not exists blocked_by text not null default 'none'
    check (blocked_by in ('none', 'client', 'internal'));

create table if not exists public.project_bids (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.survey_projects(id) on delete cascade,
  amount numeric(10,2) not null,
  blasts integer,           -- optional: how many blasts went out at this rate
  note text,
  created_at timestamptz not null default now()
);

create index if not exists project_bids_project_idx
  on public.project_bids (project_id, created_at desc);

alter table public.project_bids enable row level security;

drop policy if exists "authenticated full access bids" on public.project_bids;
create policy "authenticated full access bids"
  on public.project_bids for all to authenticated
  using (true) with check (true);
