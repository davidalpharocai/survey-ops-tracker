-- 062_project_page_redesign.sql
-- Redesigned project page: per-segment N model + per-stage timing history.
-- HAND-APPLY in the Supabase SQL editor, then this file's companion type edits
-- in lib/supabase/types.ts are already committed alongside.

-- 1) Per-segment N fields. project_segments already has label, n_target,
--    n_collected, n_actual, sort_order (039). Add the rest so each segment
--    carries its own full N + audience.
alter table public.project_segments
  add column if not exists n_internal_target integer,
  add column if not exists audience text,
  add column if not exists audience_size integer;

-- 2) Extend the rollup to also sum n_internal_target onto the parent project
--    (mirrors n_target / n_collected / n_actual from 039). Preserves 039's
--    behavior of resetting segment_count to 0 when the last segment is removed
--    (manual single-N mode), leaving the n_* totals as-is.
create or replace function public.sync_segment_totals() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
  cnt int;
begin
  pid := coalesce(new.project_id, old.project_id);
  select count(*) into cnt from public.project_segments where project_id = pid;
  if cnt > 0 then
    update public.survey_projects s set
      segment_count     = cnt,
      n_target          = (select sum(n_target) from public.project_segments where project_id = pid),
      n_internal_target = (select sum(n_internal_target) from public.project_segments where project_id = pid),
      n_collected       = (select coalesce(sum(coalesce(n_collected,0)),0) from public.project_segments where project_id = pid),
      n_actual          = (select case when count(n_actual) > 0 then sum(n_actual) end from public.project_segments where project_id = pid)
    where s.id = pid;
  else
    update public.survey_projects s set segment_count = 0 where s.id = pid;
  end if;
  return null;
end $$;

-- 3) Stage-timing history. Clock starts at Doc Programming; Submitted->Doc is
--    intentionally NOT tracked.
create table if not exists public.project_stage_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.survey_projects(id) on delete cascade,
  stage public.board_column not null,
  entered_at timestamptz not null default now(),
  created_by text
);
create index if not exists project_stage_history_pid_idx
  on public.project_stage_history(project_id, entered_at);

-- 4) Log a row whenever board_column advances into Doc Programming or later.
create or replace function public.log_stage_entry() returns trigger
language plpgsql as $$
begin
  if new.board_column is distinct from old.board_column
     and new.board_column in ('Doc Programming','Survey Programming','EdWin QA','Fielding','Data QA','Delivery')
  then
    insert into public.project_stage_history(project_id, stage, entered_at)
    values (new.id, new.board_column, now());
  end if;
  return new;
end $$;

drop trigger if exists survey_projects_stage_history on public.survey_projects;
create trigger survey_projects_stage_history
  after update of board_column on public.survey_projects
  for each row execute function public.log_stage_entry();

-- 5) Backfill: seed a Doc-Programming entry for in-flight active projects that
--    are past Submitted and have no history yet (approximate; real timing
--    accrues from go-live forward).
insert into public.project_stage_history(project_id, stage, entered_at)
select id, 'Doc Programming', coalesce(submitted_date::timestamptz, created_at)
from public.survey_projects
where board_column <> 'Submitted' and phase = 'Active'
  and not exists (select 1 from public.project_stage_history h where h.project_id = survey_projects.id);
