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
