-- Flag set by the scheduled Edwin sync when the Edwin link's survey ID
-- disagrees with the Survey IDs field — surfaced in the UI for review
alter table public.survey_projects
  add column if not exists survey_id_discrepancy text;
