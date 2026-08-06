-- Auto-capture the fielding start date. When a project first advances INTO the
-- Fielding stage FROM an earlier stage (Submitted / Doc Programming / Survey
-- Programming / EdWin QA), stamp launch_date (the "Launch date" = fielding date)
-- with the day it happened — but ONLY if launch_date is still blank, so a date
-- someone deliberately entered is never clobbered. It stays editable in the app.
--
-- A BEFORE trigger so it can set NEW.launch_date before the row is written; fires
-- for EVERY path that moves the stage (checkbox, dot-spine, board drag, the
-- connector's advance_project, manual SQL). The change is picked up by the audit
-- trigger, so it shows in the project's change history. Only forward entry from a
-- pre-fielding stage counts — moving backward into Fielding (from Data QA/Delivery)
-- does not reset the date. Uses the team's timezone for "today", matching the app.
create or replace function public.set_launch_date_on_fielding()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.board_column = 'Fielding'
     and old.board_column is distinct from new.board_column
     and old.board_column in ('Submitted', 'Doc Programming', 'Survey Programming', 'EdWin QA')
     and new.launch_date is null
  then
    new.launch_date := (now() at time zone 'America/New_York')::date;
  end if;
  return new;
end $$;

drop trigger if exists survey_projects_fielding_launch_date on public.survey_projects;
create trigger survey_projects_fielding_launch_date
  before update of board_column on public.survey_projects
  for each row execute function public.set_launch_date_on_fielding();
