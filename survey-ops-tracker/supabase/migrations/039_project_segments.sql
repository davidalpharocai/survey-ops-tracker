-- Segmented N: a survey can optionally split its N into labeled segments
-- (e.g. Buyers / Sellers), each with its own target/collected/actual. The
-- project-level n_target/n_collected/n_actual stay as the SUM of the segments
-- (kept current by a trigger), so the board/list/pace/gate keep reading one
-- number. segment_count lets dense surfaces show a "N segments" hint cheaply.

create table if not exists public.project_segments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.survey_projects(id) on delete cascade,
  label text not null,
  n_target integer,
  n_collected integer not null default 0,
  n_actual integer,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists project_segments_project_idx on public.project_segments (project_id, sort_order);

alter table public.survey_projects
  add column if not exists segment_count integer not null default 0;

alter table public.project_segments enable row level security;
revoke all on public.project_segments from anon;
drop policy if exists "analyst all project_segments" on public.project_segments;
create policy "analyst all project_segments" on public.project_segments
  for all using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');
drop policy if exists "service role full project_segments" on public.project_segments;
create policy "service role full project_segments" on public.project_segments
  for all to service_role using (true) with check (true);

-- Keep the parent project's totals + segment_count in sync with its segments.
create or replace function public.sync_segment_totals()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pid uuid := coalesce(NEW.project_id, OLD.project_id);
  cnt int;
  tgt int;
  col int;
  act int;
begin
  select
    count(*),
    sum(n_target),
    coalesce(sum(coalesce(n_collected, 0)), 0),
    case when count(*) filter (where n_actual is not null) = 0
         then null else sum(coalesce(n_actual, 0)) end
  into cnt, tgt, col, act
  from public.project_segments where project_id = pid;

  if cnt > 0 then
    update public.survey_projects
      set segment_count = cnt, n_target = tgt, n_collected = col, n_actual = act
      where id = pid;
  else
    -- last segment removed: project reverts to manual single-N (totals left as-is)
    update public.survey_projects set segment_count = 0 where id = pid;
  end if;
  return null;
end $$;

drop trigger if exists project_segments_sync on public.project_segments;
create trigger project_segments_sync
  after insert or update or delete on public.project_segments
  for each row execute function public.sync_segment_totals();
