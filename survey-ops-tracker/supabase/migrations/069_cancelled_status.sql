-- 069: add a "Cancelled" project status — for when a client cancels at any stage.
-- A cancel records a reason (so it's documented), shows a Cancelled pill, and the
-- project drops off the active board into the Archived section (reversible).
--
-- NOTE: the enum ADD VALUE is its own statement. We never USE 'Cancelled' at
-- execution time in this migration (the trigger bodies reference it as a runtime
-- string-cast, not evaluated at CREATE), so this is safe to run as one script.
-- If the SQL editor ever objects to the ADD VALUE, run that first line alone,
-- then the rest.

alter type public.project_status add value if not exists 'Cancelled';

alter table public.survey_projects
  add column if not exists cancel_reason text,
  add column if not exists cancelled_at timestamptz;

-- Delivered⇒Closed coupling (064) must NOT clobber a Cancelled status: a client
-- can cancel at any stage, including while the project sits in the Delivery
-- column. Only force Closed when it isn't already Cancelled.
create or replace function public.couple_delivered_status()
returns trigger as $$
begin
  if new.board_column = 'Delivery' and new.status <> 'Cancelled' then
    new.status := 'Closed';
  elsif old.board_column = 'Delivery' and new.board_column is distinct from 'Delivery' then
    if old.status = 'Closed' then
      new.status := 'Open';
    end if;
    new.delivered_at := null;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Log cancel_reason changes in the field-change audit (068 version + one line),
-- so the cancellation reason lands in the Logs tab too.
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
  perform audit_field(NEW.id, 'occam', OLD.occam::text, NEW.occam::text, actor);
  perform audit_field(NEW.id, 'cancel_reason', OLD.cancel_reason, NEW.cancel_reason, actor);
  perform audit_field(NEW.id, 'survey_tool_id', OLD.survey_tool_id, NEW.survey_tool_id, actor);
  perform audit_field(NEW.id, 'slack_channel_url', OLD.slack_channel_url, NEW.slack_channel_url, actor);
  perform audit_field(NEW.id, 'latest_next_steps', OLD.latest_next_steps, NEW.latest_next_steps, actor);

  if OLD.captain_id is distinct from NEW.captain_id then
    select name into old_cap from public.team_members where id = OLD.captain_id;
    select name into new_cap from public.team_members where id = NEW.captain_id;
    perform audit_field(NEW.id, 'captain', coalesce(old_cap, '—'), coalesce(new_cap, '—'), actor);
  end if;

  return NEW;
end $$;
