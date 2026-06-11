-- Generic per-project activity log.
-- type='email' today; designed to also hold slack messages, call notes,
-- and system events (e.g. stage-change automations) later.
create table if not exists public.project_activity (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.survey_projects(id) on delete cascade,
  type text not null default 'email',
  direction text,            -- inbound | outbound
  sender text,
  recipients text,
  subject text,
  snippet text,              -- short preview for compact display
  body text,                 -- full content (expandable in UI, searchable by the assistant)
  occurred_at timestamptz not null default now(),
  source text,               -- 'make.com' | 'manual' | ...
  external_id text,          -- e.g. gmail message id, for dedup
  created_at timestamptz default now()
);

create index if not exists project_activity_project_idx
  on public.project_activity (project_id, occurred_at desc);

-- dedup: never log the same external message twice
create unique index if not exists project_activity_external_idx
  on public.project_activity (external_id) where external_id is not null;

alter table public.project_activity enable row level security;

drop policy if exists "authenticated can read activity" on public.project_activity;
create policy "authenticated can read activity"
  on public.project_activity for select to authenticated using (true);

drop policy if exists "authenticated can insert activity" on public.project_activity;
create policy "authenticated can insert activity"
  on public.project_activity for insert to authenticated with check (true);
