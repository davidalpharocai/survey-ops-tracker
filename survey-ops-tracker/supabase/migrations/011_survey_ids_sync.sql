-- Track what the attached Google Sheet last reported for survey IDs,
-- so the sync workflow can tell "manually edited" apart from "sheet changed"
alter table public.survey_projects
  add column if not exists survey_ids_from_sheet text,
  add column if not exists survey_ids_synced_at timestamptz;
