-- Gen-pop N-floor SOFT validation: a per-project override so the warning
-- (salesperson Jenna + general-population audience + N below the expected floor:
-- national 1,350 / state-level 500) can be dismissed with an optional reason.
--
-- Nullable / defaulted so the app degrades gracefully until this is applied:
-- the warning still computes client-side; only persisting an override needs
-- these columns. Applied manually in the Supabase SQL editor.
alter table public.survey_projects
  add column if not exists n_floor_override boolean not null default false;

alter table public.survey_projects
  add column if not exists n_floor_override_reason text;
