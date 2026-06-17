-- Compliance guardrails: per-client requirement flags, a per-project override,
-- and a phase + results link on submissions so the existing reviewer portal can
-- handle both the before-fielding (questions) and after-fielding (results) reviews.

alter table public.clients
  add column if not exists compliance_before_fielding boolean not null default false,
  add column if not exists compliance_after_fielding  boolean not null default false,
  add column if not exists compliance_contact text,
  add column if not exists compliance_notes text;

-- Per-project override: null = follow the client; true = force compliance; false = skip.
alter table public.survey_projects
  add column if not exists compliance_override boolean;

-- Reuse question_submissions for both reviews.
alter table public.question_submissions
  add column if not exists phase text not null default 'before_fielding',
  add column if not exists results_url text;

alter table public.question_submissions
  drop constraint if exists question_submissions_phase_check;
alter table public.question_submissions
  add constraint question_submissions_phase_check check (phase in ('before_fielding','after_fielding'));

create index if not exists submissions_project_phase_idx
  on public.question_submissions (project_id, phase, version desc);
