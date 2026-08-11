-- 075: Placeholder wave records.
-- Claude cannot run DDL — David runs this in the Supabase SQL editor.
--
-- When a rerun series was seeded from an old fielding-start with no waves in
-- between, its next-due computes into the PAST (reads as "overdue" for a survey
-- that actually already ran). Fix: fabricate the missed waves as delivered
-- PLACEHOLDER records on the cadence, so the last wave is recent and next-due
-- rolls forward. Placeholders carry no real N/data yet — Sree (or a bulk upload)
-- fills them in later, so they need to be findable: this flag marks them.

alter table public.survey_projects
  add column if not exists is_placeholder boolean not null default false;

create index if not exists survey_projects_placeholder_idx
  on public.survey_projects(is_placeholder) where is_placeholder;
