-- 063: HOTFIX for migration 062 — advancing a project to "Doc Programming" fails.
--
-- 062 added project_stage_history + the log_stage_entry() trigger that inserts a
-- row when a project advances into Doc Programming or later. Two problems make
-- that INSERT fail for a normal signed-in user, which aborts the whole stage
-- move ("can't move to Doc Programming"):
--   1. log_stage_entry() is NOT `security definer` (its sibling sync_segment_totals
--      in the same migration IS) — so it runs as the calling `authenticated` role.
--   2. project_stage_history has RLS enabled but NO policy — so authenticated
--      can neither INSERT (trigger fails → whole update rolls back) nor SELECT
--      (the Insights "Time in each stage" panel is silently empty).
--
-- Fix: run the trigger function as owner (bypasses RLS for the insert, matching
-- sync_segment_totals) and add the standard authenticated-read / service-role-all
-- policies (mirrors the project_audit table in 028). Idempotent.

-- 1) Re-declare the trigger function as security definer. The existing
--    `survey_projects_stage_history` trigger (from 062) keeps pointing at it.
create or replace function public.log_stage_entry() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.board_column is distinct from old.board_column
     and new.board_column in ('Doc Programming','Survey Programming','EdWin QA','Fielding','Data QA','Delivery')
  then
    insert into public.project_stage_history(project_id, stage, entered_at)
    values (new.id, new.board_column, now());
  end if;
  return new;
end $$;

-- 2) RLS policies so the stage-timing panel can read the history (the insert
--    now runs as owner via the definer function above, so no INSERT policy is
--    required for the trigger to work).
alter table public.project_stage_history enable row level security;

drop policy if exists "authenticated read stage history" on public.project_stage_history;
create policy "authenticated read stage history" on public.project_stage_history
  for select to authenticated using (true);

drop policy if exists "service role full stage history" on public.project_stage_history;
create policy "service role full stage history" on public.project_stage_history
  for all to service_role using (true) with check (true);
