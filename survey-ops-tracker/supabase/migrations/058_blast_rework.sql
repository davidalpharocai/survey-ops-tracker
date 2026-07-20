-- 058: rework B2B blasts to the simpler model — a blast is $/bid, the date/time
-- it went out, the # of people it went to, and an optional description (the
-- existing `note`). Spend = sum(bid * people). This replaces the
-- delivered/blast_cost/reward/queued-sent-status model in the compute; the old
-- columns are LEFT IN PLACE (unused) because project_blasts is empty — there is
-- no data to migrate, and leaving them avoids a destructive drop.
-- Applied manually in the Supabase SQL editor (David).

alter table public.project_blasts add column if not exists people   integer not null default 0;
alter table public.project_blasts add column if not exists blast_at timestamptz;

-- Spend = $/bid × # of people, summed across all blasts (no lifecycle/status).
create or replace function public.sync_blast_spend()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(NEW.project_id, OLD.project_id);
begin
  update public.survey_projects set actual_spend = coalesce((
    select sum(bid * people) from public.project_blasts where project_id = pid
  ), 0) where id = pid;
  return null;
end $$;

-- Audit-feed text uses the new fields (attributed to the connector actor too).
create or replace function public.audit_project_blast()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text := coalesce(nullif(auth.email(), ''), nullif(current_setting('app.actor', true), ''), 'system');
begin
  if (TG_OP = 'INSERT') then
    insert into public.project_audit(project_id, field, new_value, changed_by)
    values (NEW.project_id, 'blast_added', NEW.people::text || ' people @ $' || NEW.bid::text, actor);
  elsif (TG_OP = 'DELETE') then
    insert into public.project_audit(project_id, field, old_value, changed_by)
    values (OLD.project_id, 'blast_removed', OLD.people::text || ' people @ $' || OLD.bid::text, actor);
    return OLD;
  elsif (TG_OP = 'UPDATE') then
    if (NEW.people, NEW.bid, NEW.blast_at) is distinct from (OLD.people, OLD.bid, OLD.blast_at) then
      insert into public.project_audit(project_id, field, old_value, new_value, changed_by)
      values (NEW.project_id, 'blast_changed',
        OLD.people::text || ' people @ $' || OLD.bid::text,
        NEW.people::text || ' people @ $' || NEW.bid::text, actor);
    end if;
  end if;
  return NEW;
end $$;

-- New log_blast RPC signature (drop the old delivered/blast_cost one first).
drop function if exists public.mcp_log_blast(uuid, int, numeric, numeric, text, text, text, text);
create or replace function public.mcp_log_blast(
  p_project uuid, p_bid numeric, p_people int, p_blast_at timestamptz,
  p_note text, p_created_by text, p_idem text, p_actor text
) returns public.project_blasts language plpgsql security definer set search_path = public as $$
declare r public.project_blasts;
begin
  perform set_config('app.actor', p_actor, true);
  insert into project_blasts (project_id, bid, people, blast_at, note, created_by, idem_key)
    values (p_project, p_bid, p_people, p_blast_at, p_note, p_created_by, p_idem) returning * into r;
  return r;
exception when unique_violation then
  select * into r from project_blasts where project_id = p_project and idem_key = p_idem; -- idempotent no-op
  return r;
end $$;
revoke execute on function public.mcp_log_blast(uuid, numeric, int, timestamptz, text, text, text, text) from public, anon, authenticated;
grant  execute on function public.mcp_log_blast(uuid, numeric, int, timestamptz, text, text, text, text) to service_role;
