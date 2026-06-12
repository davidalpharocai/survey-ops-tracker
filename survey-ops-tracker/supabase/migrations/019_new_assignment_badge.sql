-- "NEW!" badge support: stamp when a captain is (re)assigned, and track
-- per-user acknowledgement (clearing happens when they open the project)
alter table public.survey_projects
  add column if not exists captain_assigned_at timestamptz;

create or replace function public.stamp_captain_assignment()
returns trigger as $$
begin
  if (tg_op = 'INSERT' and new.captain_id is not null)
     or (tg_op = 'UPDATE' and new.captain_id is distinct from old.captain_id and new.captain_id is not null) then
    new.captain_assigned_at := now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists captain_assignment_stamp on public.survey_projects;
create trigger captain_assignment_stamp
  before insert or update on public.survey_projects
  for each row execute function public.stamp_captain_assignment();

create table if not exists public.project_seen (
  project_id uuid not null references public.survey_projects(id) on delete cascade,
  user_email text not null,
  seen_at timestamptz not null default now(),
  primary key (project_id, user_email)
);

alter table public.project_seen enable row level security;

drop policy if exists "authenticated full access seen" on public.project_seen;
create policy "authenticated full access seen"
  on public.project_seen for all to authenticated
  using (true) with check (true);
