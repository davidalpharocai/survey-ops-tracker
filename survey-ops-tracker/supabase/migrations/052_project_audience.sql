-- 052_project_audience.sql — free-text "Audience" descriptor on a project.
-- Distinct from audience_size (the numeric panel/universe size): this captures
-- WHO the survey is fielded to (e.g. "US adults 18+, likely voters"). Additive.
-- Applied manually by David in the Supabase SQL editor.
alter table public.survey_projects add column if not exists audience text;
