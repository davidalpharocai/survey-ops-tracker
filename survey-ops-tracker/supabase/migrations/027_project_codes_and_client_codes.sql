-- Project IDs: permanent "PR00000"-style codes, mirroring the sheet's Cl##### client ids.
-- The database assigns them (sequence + trigger), so new projects get the next
-- code automatically forever — no app logic to maintain.
create sequence if not exists public.project_code_seq minvalue 0 start 0;

alter table public.survey_projects
  add column if not exists project_code text unique;

create or replace function public.assign_project_code()
returns trigger as $$
begin
  if new.project_code is null then
    new.project_code := 'PR' || lpad(nextval('public.project_code_seq')::text, 5, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists survey_projects_project_code on public.survey_projects;
create trigger survey_projects_project_code
  before insert on public.survey_projects
  for each row execute function public.assign_project_code();

-- Backfill, oldest project first: submitted date when known, else creation time.
with ordered as (
  select id,
         row_number() over (
           order by coalesce(submitted_date, created_at::date), created_at, id
         ) - 1 as rn
  from public.survey_projects
  where project_code is null
)
update public.survey_projects p
set project_code = 'PR' || lpad(o.rn::text, 5, '0')
from ordered o
where p.id = o.id;

-- Continue numbering after the highest assigned code
select setval('public.project_code_seq',
  (select coalesce(max(substring(project_code from 3)::int), 0) from public.survey_projects),
  true);

-- Client codes: the sheet's "Cl00001" ids from the Unique Clients tab
alter table public.clients
  add column if not exists code text unique;
