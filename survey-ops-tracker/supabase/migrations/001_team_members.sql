create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  initials text not null,
  email text not null unique,
  created_at timestamptz default now()
);
