-- Extend the audit log to the project's child tables. Next Steps and Bids live
-- in their own tables (project_steps, project_bids), so the survey_projects
-- trigger never saw them — adding a next step wasn't being captured. These
-- triggers funnel that activity into the same project_audit feed.

-- ---- Next steps ----
create or replace function public.audit_project_step()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text := coalesce(nullif(auth.email(), ''), 'system');
begin
  if (TG_OP = 'INSERT') then
    insert into public.project_audit(project_id, field, new_value, changed_by)
    values (NEW.project_id, 'next_step_added', NEW.text, actor);
  elsif (TG_OP = 'DELETE') then
    insert into public.project_audit(project_id, field, old_value, changed_by)
    values (OLD.project_id, 'next_step_removed', OLD.text, actor);
    return OLD;
  elsif (TG_OP = 'UPDATE') then
    if NEW.done and not OLD.done then
      insert into public.project_audit(project_id, field, new_value, changed_by)
      values (NEW.project_id, 'next_step_completed', NEW.text, actor);
    elsif OLD.done and not NEW.done then
      insert into public.project_audit(project_id, field, new_value, changed_by)
      values (NEW.project_id, 'next_step_reopened', NEW.text, actor);
    elsif NEW.text is distinct from OLD.text then
      insert into public.project_audit(project_id, field, old_value, new_value, changed_by)
      values (NEW.project_id, 'next_step_edited', OLD.text, NEW.text, actor);
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists project_steps_audit on public.project_steps;
create trigger project_steps_audit
  after insert or update or delete on public.project_steps
  for each row execute function public.audit_project_step();

-- ---- Bids ----
create or replace function public.audit_project_bid()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text := coalesce(nullif(auth.email(), ''), 'system');
begin
  if (TG_OP = 'INSERT') then
    insert into public.project_audit(project_id, field, new_value, changed_by)
    values (NEW.project_id, 'bid_added', NEW.amount::text, actor);
  elsif (TG_OP = 'DELETE') then
    insert into public.project_audit(project_id, field, old_value, changed_by)
    values (OLD.project_id, 'bid_removed', OLD.amount::text, actor);
    return OLD;
  elsif (TG_OP = 'UPDATE') then
    if NEW.amount is distinct from OLD.amount then
      insert into public.project_audit(project_id, field, old_value, new_value, changed_by)
      values (NEW.project_id, 'bid_changed', OLD.amount::text, NEW.amount::text, actor);
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists project_bids_audit on public.project_bids;
create trigger project_bids_audit
  after insert or update or delete on public.project_bids
  for each row execute function public.audit_project_bid();
