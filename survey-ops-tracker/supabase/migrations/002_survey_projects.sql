create type public.project_type as enum ('PS', 'B2B', 'Rerun');
create type public.project_status as enum ('Open', 'Closed');
create type public.project_phase as enum ('Scoping', 'Active');
create type public.board_column as enum (
  'Submitted', 'Doc Programming', 'Survey Programming',
  'EdWin QA', 'Fielding', 'Data QA', 'Delivery'
);
create type public.scoping_stage as enum (
  'New Inquiry', 'Proposal Sent', 'Pricing Discussion',
  'Awaiting Approval', 'Closed'
);

create table public.survey_projects (
  id uuid primary key default gen_random_uuid(),
  project_name text not null,
  client text not null,
  type public.project_type,
  captain_id uuid references public.team_members(id),
  phase public.project_phase not null default 'Scoping',
  status public.project_status not null default 'Open',
  scoping_stage public.scoping_stage default 'New Inquiry',
  submitted_date date,
  launch_date date,
  due_date date,
  deliver_date date,
  n_target integer,
  n_collected integer default 0,
  n_last_synced timestamptz,
  audience_size integer,
  row_level_data boolean default false,
  terminations boolean default false,
  stage_doc_programming boolean default false,
  stage_survey_programming boolean default false,
  stage_edwin_qa boolean default false,
  stage_fielding boolean default false,
  stage_data_qa boolean default false,
  stage_delivery boolean default false,
  board_column public.board_column not null default 'Submitted',
  latest_next_steps text,
  linked_documents text[] default '{}',
  calendar_event_id text,
  survey_tool_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function public.set_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger survey_projects_updated_at
  before update on public.survey_projects
  for each row execute function public.set_updated_at();
