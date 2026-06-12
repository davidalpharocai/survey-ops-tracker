-- Co-captains: a project usually has one captain, but can share extras.
-- captain_id stays the primary captain (drives the NEW! badge and filters);
-- co_captain_ids holds any additional team_members ids.
alter table public.survey_projects
  add column if not exists co_captain_ids uuid[] not null default '{}';
