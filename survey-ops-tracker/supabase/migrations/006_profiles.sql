create type public.profile_role as enum ('analyst', 'compliance');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role public.profile_role not null default 'analyst',
  client_id uuid references public.clients(id),
  created_at timestamptz default now(),
  constraint compliance_needs_client check (role <> 'compliance' or client_id is not null)
);

alter table public.profiles enable row level security;
revoke all on public.profiles from anon;

-- Backfill: every existing auth user is an internal analyst
insert into public.profiles (id, email, role)
select id, email, 'analyst' from auth.users where email is not null
on conflict (id) do nothing;

-- Security-definer helpers so RLS policies can check role/client
-- without recursive RLS lookups
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as
$$ select role::text from public.profiles where id = auth.uid() $$;

create or replace function public.my_client_id()
returns uuid language sql stable security definer set search_path = public as
$$ select client_id from public.profiles where id = auth.uid() $$;

create or replace function public.project_client_id(pid uuid)
returns uuid language sql stable security definer set search_path = public as
$$ select client_id from public.survey_projects where id = pid $$;

-- Helpers are for authenticated policy evaluation only — not anon RPC
revoke execute on function public.my_role() from anon, public;
revoke execute on function public.my_client_id() from anon, public;
revoke execute on function public.project_client_id(uuid) from anon, public;
grant execute on function public.my_role() to authenticated;
grant execute on function public.my_client_id() to authenticated;
grant execute on function public.project_client_id(uuid) to authenticated;
