-- New project fields: longitudinal, salesperson, voter survey QA, citation language, N actual
alter table public.survey_projects
  add column if not exists longitudinal boolean not null default false,
  add column if not exists salesperson text,
  add column if not exists voter_survey_qa boolean,
  add column if not exists citation_language_needed boolean,
  add column if not exists n_actual integer;

-- Auto-derive voter flags on insert when not explicitly provided:
-- Yes if salesperson is Jenna, or project name / client contains "vote"
create or replace function public.set_voter_flags()
returns trigger as $$
declare
  is_vote boolean;
begin
  is_vote := coalesce(new.salesperson, '') ilike '%jenna%'
    or new.project_name ilike '%vote%'
    or new.client ilike '%vote%';
  if new.voter_survey_qa is null then
    new.voter_survey_qa := is_vote;
  end if;
  if new.citation_language_needed is null then
    new.citation_language_needed := is_vote;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists survey_projects_voter_flags on public.survey_projects;
create trigger survey_projects_voter_flags
  before insert on public.survey_projects
  for each row execute function public.set_voter_flags();

-- Backfill existing rows with the same logic
update public.survey_projects
set voter_survey_qa = (
      coalesce(salesperson, '') ilike '%jenna%'
      or project_name ilike '%vote%'
      or client ilike '%vote%')
where voter_survey_qa is null;

update public.survey_projects
set citation_language_needed = (
      coalesce(salesperson, '') ilike '%jenna%'
      or project_name ilike '%vote%'
      or client ilike '%vote%')
where citation_language_needed is null;
