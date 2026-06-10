create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz default now()
);

alter table public.clients enable row level security;
revoke all on public.clients from anon;

alter table public.survey_projects
  add column client_id uuid references public.clients(id);

-- Backfill from the existing free-text client column
insert into public.clients (name)
select distinct trim(client) from public.survey_projects
where client is not null and trim(client) <> ''
on conflict (name) do nothing;

update public.survey_projects sp
set client_id = c.id
from public.clients c
where trim(sp.client) = c.name;

-- Keep client_id in sync for projects created/renamed after this migration.
-- Security definer: runs as owner so the upsert bypasses clients RLS.
create or replace function public.sync_project_client()
returns trigger language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if new.client is null or trim(new.client) = '' then
    return new;
  end if;
  insert into public.clients (name) values (trim(new.client))
  on conflict (name) do update set name = excluded.name
  returning id into cid;
  new.client_id = cid;
  return new;
end $$;

create trigger survey_projects_sync_client
  before insert or update of client on public.survey_projects
  for each row execute function public.sync_project_client();
