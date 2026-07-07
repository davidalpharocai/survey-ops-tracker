-- Phase 2 connector writes: attribution GUC, write audit substrate, idempotency,
-- contact attribution, and SECURITY DEFINER write RPCs.

-- 1) Contact attribution (client_contacts had no created_by).
alter table public.client_contacts add column if not exists created_by text;

-- 2) Queryable write-audit substrate on the existing tool-call log.
alter table public.mcp_tool_calls
  add column if not exists detail jsonb,
  add column if not exists project_id uuid,
  add column if not exists client_id uuid,
  add column if not exists error_code text,
  add column if not exists error_message text;
create index if not exists mcp_tool_calls_project_idx on public.mcp_tool_calls(project_id);
create index if not exists mcp_tool_calls_client_idx  on public.mcp_tool_calls(client_id);

-- 3) Race-safe idempotency for money appends.
alter table public.project_blasts add column if not exists idem_key text;
alter table public.project_bids   add column if not exists idem_key text;
create unique index if not exists project_blasts_idem_uq
  on public.project_blasts(project_id, idem_key) where idem_key is not null;
create unique index if not exists project_bids_idem_uq
  on public.project_bids(project_id, idem_key) where idem_key is not null;

-- 4) Amend the audit actor to prefer a transaction-local GUC, so an attributed
-- RPC can stamp "<user> via Claude". Backward-compatible: an unset GUC returns
-- null (via current_setting(...,true)) and falls through to auth.email().
-- Reproduced verbatim from the current bodies (028/035/029/043) except the
-- actor expression.

-- log creation as a single marker row (028: audit_survey_project_insert)
create or replace function public.audit_survey_project_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_audit(project_id, field, old_value, new_value, changed_by)
  values (NEW.id, '(created)', null, NEW.project_name,
          coalesce(nullif(current_setting('app.actor', true), ''), nullif(auth.email(), ''), 'system'));
  return NEW;
end $$;

-- generic, drift-proof update-diff trigger (035: audit_survey_project)
create or replace function public.audit_survey_project()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor text := coalesce(nullif(current_setting('app.actor', true), ''), nullif(auth.email(), ''), 'system');
  -- Columns we deliberately never audit: identity/timestamps, drag mechanics,
  -- sync bookkeeping, the per-stage checkboxes (board_column already captures
  -- stage moves; logging the 6 booleans too would spam the log on every drag),
  -- large JSON blobs, and fields handled specially below (captain_id, deleted_at).
  skip text[] := array[
    'id','created_at','updated_at','sort_order',
    'client_id',  -- raw uuid; the human-readable 'client' text is audited instead
    'captain_id','captain_assigned_at','captain_assigned_by','co_captain_ids',
    'survey_ids_synced_at','n_last_synced','survey_ids_from_sheet','survey_id_discrepancy',
    'stage_doc_programming','stage_survey_programming','stage_edwin_qa',
    'stage_fielding','stage_data_qa','stage_delivery',
    'linked_documents','deleted_at'
  ];
  old_json jsonb := to_jsonb(OLD);
  new_json jsonb := to_jsonb(NEW);
  k text;
  oldv text;
  newv text;
  old_cap text;
  new_cap text;
begin
  for k in select jsonb_object_keys(new_json)
  loop
    if k = any(skip) then continue; end if;
    oldv := old_json ->> k;
    newv := new_json ->> k;
    if oldv is distinct from newv then
      insert into public.project_audit(project_id, field, old_value, new_value, changed_by)
      values (NEW.id, k, oldv, newv, actor);
    end if;
  end loop;

  -- Captain resolved to names so the log reads cleanly.
  if OLD.captain_id is distinct from NEW.captain_id then
    select name into old_cap from public.team_members where id = OLD.captain_id;
    select name into new_cap from public.team_members where id = NEW.captain_id;
    perform audit_field(NEW.id, 'captain', coalesce(old_cap, '—'), coalesce(new_cap, '—'), actor);
  end if;

  -- Soft delete / restore as readable markers.
  if OLD.deleted_at is null and NEW.deleted_at is not null then
    insert into public.project_audit(project_id, field, old_value, new_value, changed_by)
    values (NEW.id, '(deleted)', null, 'Moved to Recently Deleted', actor);
  elsif OLD.deleted_at is not null and NEW.deleted_at is null then
    insert into public.project_audit(project_id, field, old_value, new_value, changed_by)
    values (NEW.id, '(restored)', 'Recently Deleted', 'Restored to board', actor);
  end if;

  return NEW;
end $$;

-- ---- Next steps (029: audit_project_step) ----
create or replace function public.audit_project_step()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text := coalesce(nullif(current_setting('app.actor', true), ''), nullif(auth.email(), ''), 'system');
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

-- ---- Bids (029: audit_project_bid) ----
create or replace function public.audit_project_bid()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text := coalesce(nullif(current_setting('app.actor', true), ''), nullif(auth.email(), ''), 'system');
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

-- ---- Blasts (043: audit_project_blast) ----
create or replace function public.audit_project_blast()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text := coalesce(nullif(current_setting('app.actor', true), ''), nullif(auth.email(), ''), 'system');
begin
  if (TG_OP = 'INSERT') then
    insert into public.project_audit(project_id, field, new_value, changed_by)
    values (NEW.project_id, 'blast_added', NEW.delivered::text || ' @ $' || NEW.bid::text || ' + $' || NEW.blast_cost::text, actor);
  elsif (TG_OP = 'DELETE') then
    insert into public.project_audit(project_id, field, old_value, changed_by)
    values (OLD.project_id, 'blast_removed', OLD.delivered::text || ' @ $' || OLD.bid::text || ' + $' || OLD.blast_cost::text, actor);
    return OLD;
  elsif (TG_OP = 'UPDATE') then
    if (NEW.delivered, NEW.bid, NEW.blast_cost) is distinct from (OLD.delivered, OLD.bid, OLD.blast_cost) then
      insert into public.project_audit(project_id, field, old_value, new_value, changed_by)
      values (NEW.project_id, 'blast_changed',
        OLD.delivered::text || ' @ $' || OLD.bid::text || ' + $' || OLD.blast_cost::text,
        NEW.delivered::text || ' @ $' || NEW.bid::text || ' + $' || NEW.blast_cost::text, actor);
    end if;
  end if;
  return NEW;
end $$;

-- 5) SECURITY DEFINER write RPCs. Each sets the app.actor GUC first (so the
-- audit triggers above attribute the connector-driven change to "<user> via
-- Claude"), then performs the write. No my_role() check (that GUC is null
-- under service-role, which is how these are invoked). Column names/types
-- verified against 002_survey_projects.sql + 009/012/015/026/033/037/039/
-- 040/041/043_*.sql and lib/supabase/types.ts.

create or replace function public.mcp_write_project(
  p_id uuid, p_patch jsonb, p_actor text, p_expected_updated_at timestamptz default null
) returns public.survey_projects language plpgsql security definer set search_path = public as $$
declare r public.survey_projects;
begin
  perform set_config('app.actor', p_actor, true);
  select * into r from survey_projects where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Project not found'; end if;
  if p_expected_updated_at is not null and r.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_write: project changed since preview';
  end if;

  -- Whitelisted columns; only keys present in the patch are written; JSON null clears.
  update survey_projects set
    project_name       = case when p_patch ? 'project_name'       then p_patch->>'project_name' else project_name end,
    client             = case when p_patch ? 'client'             then p_patch->>'client' else client end,
    project_type       = case when p_patch ? 'project_type'       then (p_patch->>'project_type')::project_type else project_type end,
    captain_id         = case when p_patch ? 'captain_id'         then nullif(p_patch->>'captain_id','')::uuid else captain_id end,
    co_captain_ids     = case when p_patch ? 'co_captain_ids'     then (select array_agg(x)::uuid[] from jsonb_array_elements_text(p_patch->'co_captain_ids') x) else co_captain_ids end,
    salesperson        = case when p_patch ? 'salesperson'        then p_patch->>'salesperson' else salesperson end,
    priority           = case when p_patch ? 'priority'           then p_patch->>'priority' else priority end,
    blocked_by         = case when p_patch ? 'blocked_by'         then p_patch->>'blocked_by' else blocked_by end,
    status             = case when p_patch ? 'status'             then (p_patch->>'status')::project_status else status end,
    phase              = case when p_patch ? 'phase'              then (p_patch->>'phase')::project_phase else phase end,
    scoping_stage      = case when p_patch ? 'scoping_stage'      then (p_patch->>'scoping_stage')::scoping_stage else scoping_stage end,
    board_column       = case when p_patch ? 'board_column'       then (p_patch->>'board_column')::board_column else board_column end,
    stage_doc_programming    = case when p_patch ? 'stage_doc_programming'    then (p_patch->>'stage_doc_programming')::boolean else stage_doc_programming end,
    stage_survey_programming = case when p_patch ? 'stage_survey_programming' then (p_patch->>'stage_survey_programming')::boolean else stage_survey_programming end,
    stage_edwin_qa           = case when p_patch ? 'stage_edwin_qa'           then (p_patch->>'stage_edwin_qa')::boolean else stage_edwin_qa end,
    stage_fielding           = case when p_patch ? 'stage_fielding'           then (p_patch->>'stage_fielding')::boolean else stage_fielding end,
    stage_data_qa            = case when p_patch ? 'stage_data_qa'            then (p_patch->>'stage_data_qa')::boolean else stage_data_qa end,
    stage_delivery           = case when p_patch ? 'stage_delivery'           then (p_patch->>'stage_delivery')::boolean else stage_delivery end,
    submitted_date     = case when p_patch ? 'submitted_date'     then nullif(p_patch->>'submitted_date','')::date else submitted_date end,
    launch_date        = case when p_patch ? 'launch_date'        then nullif(p_patch->>'launch_date','')::date else launch_date end,
    due_date           = case when p_patch ? 'due_date'           then nullif(p_patch->>'due_date','')::date else due_date end,
    deliver_date       = case when p_patch ? 'deliver_date'       then nullif(p_patch->>'deliver_date','')::date else deliver_date end,
    rerun_date         = case when p_patch ? 'rerun_date'         then nullif(p_patch->>'rerun_date','')::date else rerun_date end,
    n_target           = case when p_patch ? 'n_target'           then nullif(p_patch->>'n_target','')::int else n_target end,
    n_collected        = case when p_patch ? 'n_collected'        then nullif(p_patch->>'n_collected','')::int else n_collected end,
    n_actual           = case when p_patch ? 'n_actual'           then nullif(p_patch->>'n_actual','')::int else n_actual end,
    n_internal_target  = case when p_patch ? 'n_internal_target'  then nullif(p_patch->>'n_internal_target','')::int else n_internal_target end,
    audience_size      = case when p_patch ? 'audience_size'      then nullif(p_patch->>'audience_size','')::int else audience_size end,
    budget             = case when p_patch ? 'budget'             then nullif(p_patch->>'budget','')::numeric else budget end,
    longitudinal       = case when p_patch ? 'longitudinal'       then (p_patch->>'longitudinal')::boolean else longitudinal end,
    voter_survey_qa    = case when p_patch ? 'voter_survey_qa'    then (p_patch->>'voter_survey_qa')::boolean else voter_survey_qa end,
    citation_language_needed = case when p_patch ? 'citation_language_needed' then (p_patch->>'citation_language_needed')::boolean else citation_language_needed end,
    row_level_data     = case when p_patch ? 'row_level_data'     then (p_patch->>'row_level_data')::boolean else row_level_data end,
    terminations       = case when p_patch ? 'terminations'       then (p_patch->>'terminations')::boolean else terminations end,
    survey_tool_id     = case when p_patch ? 'survey_tool_id'     then p_patch->>'survey_tool_id' else survey_tool_id end,
    slack_channel_url  = case when p_patch ? 'slack_channel_url'  then p_patch->>'slack_channel_url' else slack_channel_url end,
    compliance_override= case when p_patch ? 'compliance_override' then (p_patch->>'compliance_override')::boolean else compliance_override end,
    requested_by_contact_id = case when p_patch ? 'requested_by_contact_id' then nullif(p_patch->>'requested_by_contact_id','')::uuid else requested_by_contact_id end,
    requested_by_name  = case when p_patch ? 'requested_by_name'  then p_patch->>'requested_by_name' else requested_by_name end,
    latest_next_steps  = case when p_patch ? 'latest_next_steps'  then p_patch->>'latest_next_steps' else latest_next_steps end,
    linked_documents   = case when p_patch ? 'linked_documents'   then (select array_agg(x) from jsonb_array_elements_text(p_patch->'linked_documents') x) else linked_documents end
  where id = p_id
  returning * into r;
  return r;
end $$;

create or replace function public.mcp_create_project(p_patch jsonb, p_actor text)
returns public.survey_projects language plpgsql security definer set search_path = public as $$
declare r public.survey_projects;
begin
  perform set_config('app.actor', p_actor, true);
  insert into survey_projects (project_name, client, project_type, captain_id, salesperson, due_date, n_target, phase, board_column, scoping_stage, submitted_date)
  values (
    p_patch->>'project_name',
    p_patch->>'client',
    nullif(p_patch->>'project_type','')::project_type,
    nullif(p_patch->>'captain_id','')::uuid,
    p_patch->>'salesperson',
    nullif(p_patch->>'due_date','')::date,
    nullif(p_patch->>'n_target','')::int,
    coalesce(nullif(p_patch->>'phase','')::project_phase, 'Scoping'),
    coalesce(nullif(p_patch->>'board_column','')::board_column, 'Submitted'),
    case when (p_patch->>'phase') = 'Active' then null else coalesce(nullif(p_patch->>'scoping_stage','')::scoping_stage, 'New Inquiry') end,
    nullif(p_patch->>'submitted_date','')::date
  ) returning * into r;
  return r;
end $$;

create or replace function public.mcp_add_step(p_project uuid, p_text text, p_created_by text, p_actor text)
returns public.project_steps language plpgsql security definer set search_path = public as $$
declare r public.project_steps;
begin
  perform set_config('app.actor', p_actor, true);
  insert into project_steps (project_id, text, created_by) values (p_project, p_text, p_created_by) returning * into r;
  return r;
end $$;

create or replace function public.mcp_complete_step(p_step uuid, p_done boolean, p_by text, p_actor text)
returns public.project_steps language plpgsql security definer set search_path = public as $$
declare r public.project_steps;
begin
  perform set_config('app.actor', p_actor, true);
  update project_steps set done = p_done,
    completed_at = case when p_done then now() else null end,
    completed_by = case when p_done then p_by else null end
  where id = p_step returning * into r;
  if not found then raise exception 'Step not found'; end if;
  return r;
end $$;

create or replace function public.mcp_edit_step(p_step uuid, p_text text, p_actor text)
returns public.project_steps language plpgsql security definer set search_path = public as $$
declare r public.project_steps;
begin
  perform set_config('app.actor', p_actor, true);
  update project_steps set text = p_text where id = p_step returning * into r;
  if not found then raise exception 'Step not found'; end if;
  return r;
end $$;

create or replace function public.mcp_set_bid_budget(p_project uuid, p_amount numeric, p_note text, p_created_by text, p_idem text, p_actor text)
returns public.project_bids language plpgsql security definer set search_path = public as $$
declare r public.project_bids;
begin
  perform set_config('app.actor', p_actor, true);
  insert into project_bids (project_id, amount, note, created_by, idem_key)
    values (p_project, p_amount, p_note, p_created_by, p_idem) returning * into r;
  return r;
exception when unique_violation then
  select * into r from project_bids where project_id = p_project and idem_key = p_idem; -- idempotent no-op
  return r;
end $$;

create or replace function public.mcp_log_blast(p_project uuid, p_delivered int, p_bid numeric, p_blast_cost numeric, p_note text, p_created_by text, p_idem text, p_actor text)
returns public.project_blasts language plpgsql security definer set search_path = public as $$
declare r public.project_blasts;
begin
  perform set_config('app.actor', p_actor, true);
  insert into project_blasts (project_id, delivered, bid, blast_cost, note, created_by, idem_key)
    values (p_project, p_delivered, p_bid, p_blast_cost, p_note, p_created_by, p_idem) returning * into r;
  return r;
exception when unique_violation then
  select * into r from project_blasts where project_id = p_project and idem_key = p_idem; -- idempotent no-op
  return r;
end $$;

create or replace function public.mcp_rename_client(p_id uuid, p_new_name text, p_actor text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.actor', p_actor, true);
  update clients set name = p_new_name where id = p_id;
  -- rewrite the denormalized firm text on this client's projects, preserving any " - Contact" suffix
  update survey_projects set client = p_new_name ||
    (case when position(' - ' in coalesce(client,'')) > 0 then substring(client from position(' - ' in client)) else '' end)
  where client_id = p_id and deleted_at is null;
end $$;

-- 6) Grants — service_role invokes these via the connector's server-side
-- Supabase client; authenticated is granted too since the RPCs are the real
-- security boundary (SECURITY DEFINER, whitelisted columns, no dynamic SQL)
-- and re-run their own checks (found/stale_write/idempotent no-op).
grant execute on function public.mcp_write_project(uuid, jsonb, text, timestamptz) to authenticated, service_role;
grant execute on function public.mcp_create_project(jsonb, text) to authenticated, service_role;
grant execute on function public.mcp_add_step(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.mcp_complete_step(uuid, boolean, text, text) to authenticated, service_role;
grant execute on function public.mcp_edit_step(uuid, text, text) to authenticated, service_role;
grant execute on function public.mcp_set_bid_budget(uuid, numeric, text, text, text, text) to authenticated, service_role;
grant execute on function public.mcp_log_blast(uuid, int, numeric, numeric, text, text, text, text) to authenticated, service_role;
grant execute on function public.mcp_rename_client(uuid, text, text) to authenticated, service_role;
