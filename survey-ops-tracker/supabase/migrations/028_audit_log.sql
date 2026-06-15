-- Field-level audit: every meaningful change to a project, captured by the
-- database itself (a trigger) so it's comprehensive — app edits, AI edits,
-- nightly Edwin sync, and manual SQL all get logged. Who: the signed-in
-- user's email from the JWT, or 'system' for service-role writes (sync/scripts).
create table if not exists public.project_audit (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.survey_projects(id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  changed_by text not null default 'system',
  changed_at timestamptz not null default now()
);
create index if not exists project_audit_project_idx on public.project_audit (project_id, changed_at desc);
create index if not exists project_audit_recent_idx on public.project_audit (changed_at desc);

alter table public.project_audit enable row level security;
create policy "authenticated read audit" on public.project_audit
  for select to authenticated using (true);
create policy "service role full audit" on public.project_audit
  for all to service_role using (true);

-- record one field when it actually changed
create or replace function public.audit_field(pid uuid, fname text, oldv text, newv text, actor text)
returns void language plpgsql as $$
begin
  if oldv is distinct from newv then
    insert into public.project_audit(project_id, field, old_value, new_value, changed_by)
    values (pid, fname, oldv, newv, actor);
  end if;
end $$;

create or replace function public.audit_survey_project()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor text := coalesce(nullif(auth.email(), ''), 'system');
  old_cap text;
  new_cap text;
begin
  perform audit_field(NEW.id, 'project_name', OLD.project_name, NEW.project_name, actor);
  perform audit_field(NEW.id, 'client', OLD.client, NEW.client, actor);
  perform audit_field(NEW.id, 'project_type', OLD.project_type::text, NEW.project_type::text, actor);
  perform audit_field(NEW.id, 'status', OLD.status::text, NEW.status::text, actor);
  perform audit_field(NEW.id, 'phase', OLD.phase::text, NEW.phase::text, actor);
  perform audit_field(NEW.id, 'scoping_stage', OLD.scoping_stage::text, NEW.scoping_stage::text, actor);
  perform audit_field(NEW.id, 'board_column', OLD.board_column::text, NEW.board_column::text, actor);
  perform audit_field(NEW.id, 'salesperson', OLD.salesperson, NEW.salesperson, actor);
  perform audit_field(NEW.id, 'priority', OLD.priority, NEW.priority, actor);
  perform audit_field(NEW.id, 'blocked_by', OLD.blocked_by, NEW.blocked_by, actor);
  perform audit_field(NEW.id, 'submitted_date', OLD.submitted_date::text, NEW.submitted_date::text, actor);
  perform audit_field(NEW.id, 'launch_date', OLD.launch_date::text, NEW.launch_date::text, actor);
  perform audit_field(NEW.id, 'due_date', OLD.due_date::text, NEW.due_date::text, actor);
  perform audit_field(NEW.id, 'deliver_date', OLD.deliver_date::text, NEW.deliver_date::text, actor);
  perform audit_field(NEW.id, 'n_target', OLD.n_target::text, NEW.n_target::text, actor);
  perform audit_field(NEW.id, 'n_collected', OLD.n_collected::text, NEW.n_collected::text, actor);
  perform audit_field(NEW.id, 'n_actual', OLD.n_actual::text, NEW.n_actual::text, actor);
  perform audit_field(NEW.id, 'audience_size', OLD.audience_size::text, NEW.audience_size::text, actor);
  perform audit_field(NEW.id, 'budget', OLD.budget::text, NEW.budget::text, actor);
  perform audit_field(NEW.id, 'actual_spend', OLD.actual_spend::text, NEW.actual_spend::text, actor);
  perform audit_field(NEW.id, 'longitudinal', OLD.longitudinal::text, NEW.longitudinal::text, actor);
  perform audit_field(NEW.id, 'voter_survey_qa', OLD.voter_survey_qa::text, NEW.voter_survey_qa::text, actor);
  perform audit_field(NEW.id, 'citation_language_needed', OLD.citation_language_needed::text, NEW.citation_language_needed::text, actor);
  perform audit_field(NEW.id, 'row_level_data', OLD.row_level_data::text, NEW.row_level_data::text, actor);
  perform audit_field(NEW.id, 'terminations', OLD.terminations::text, NEW.terminations::text, actor);
  perform audit_field(NEW.id, 'survey_tool_id', OLD.survey_tool_id, NEW.survey_tool_id, actor);
  perform audit_field(NEW.id, 'slack_channel_url', OLD.slack_channel_url, NEW.slack_channel_url, actor);
  perform audit_field(NEW.id, 'latest_next_steps', OLD.latest_next_steps, NEW.latest_next_steps, actor);

  -- captain resolved to names so the log reads cleanly
  if OLD.captain_id is distinct from NEW.captain_id then
    select name into old_cap from public.team_members where id = OLD.captain_id;
    select name into new_cap from public.team_members where id = NEW.captain_id;
    perform audit_field(NEW.id, 'captain', coalesce(old_cap, '—'), coalesce(new_cap, '—'), actor);
  end if;

  return NEW;
end $$;

drop trigger if exists survey_projects_audit on public.survey_projects;
create trigger survey_projects_audit
  after update on public.survey_projects
  for each row execute function public.audit_survey_project();

-- log creation as a single marker row
create or replace function public.audit_survey_project_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_audit(project_id, field, old_value, new_value, changed_by)
  values (NEW.id, '(created)', null, NEW.project_name,
          coalesce(nullif(auth.email(), ''), 'system'));
  return NEW;
end $$;

drop trigger if exists survey_projects_audit_insert on public.survey_projects;
create trigger survey_projects_audit_insert
  after insert on public.survey_projects
  for each row execute function public.audit_survey_project_insert();
