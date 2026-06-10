create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz default now()
);

alter table public.survey_projects
  add column client_id uuid references public.clients(id);

-- Backfill from the existing free-text client column
insert into public.clients (name)
select distinct client from public.survey_projects
where client is not null and client <> ''
on conflict (name) do nothing;

update public.survey_projects sp
set client_id = c.id
from public.clients c
where sp.client = c.name;
