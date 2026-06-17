-- Two correctness fixes surfaced by the post-build audit:
--
-- 1. The field-level audit trigger (028) hand-listed ~28 columns. That list
--    fell out of date: soft delete/restore (deleted_at) and the internal-project
--    columns (category, objective, sprint_number) produced ZERO audit rows — so
--    the most consequential action (deleting a project) went unrecorded. Replace
--    it with a generic to_jsonb diff that audits every column except an explicit
--    deny-set of mechanical/noisy ones, so new columns are covered automatically.
--
-- 2. Internal projects default their client to "AlphaROC". The client-sync
--    trigger (005/024) isn't type-aware, so it created a phantom "AlphaROC"
--    client row and stamped client_id on internal work. Make the trigger skip
--    internal projects and clean up the rows already created.

-- ---------------------------------------------------------------------------
-- 1. Generic, drift-proof audit trigger
-- ---------------------------------------------------------------------------
create or replace function public.audit_survey_project()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor text := coalesce(nullif(auth.email(), ''), 'system');
  -- Columns we deliberately never audit: identity/timestamps, drag mechanics,
  -- sync bookkeeping, the per-stage checkboxes (board_column already captures
  -- stage moves; logging the 6 booleans too would spam the log on every drag),
  -- large JSON blobs, and fields handled specially below (captain_id, deleted_at).
  skip text[] := array[
    'id','created_at','updated_at','sort_order',
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

-- ---------------------------------------------------------------------------
-- 2. Make client-sync internal-aware + clean up the phantom client
-- ---------------------------------------------------------------------------
create or replace function public.sync_project_client()
returns trigger language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  -- Internal projects aren't tied to a real client (their "client" is just a
  -- label, default AlphaROC) — never create a client row or stamp client_id.
  if new.project_type = 'Internal' then
    new.client_id = null;
    return new;
  end if;
  if new.client is null or trim(new.client) = '' then
    return new;
  end if;
  insert into public.clients (name) values (public.client_firm_name(new.client))
  on conflict (name) do update set name = excluded.name
  returning id into cid;
  new.client_id = cid;
  return new;
end $$;

-- Detach existing internal projects from any client they were wrongly linked to.
update public.survey_projects
set client_id = null
where project_type = 'Internal' and client_id is not null;

-- Remove the phantom "AlphaROC" client if nothing real references it anymore.
delete from public.clients c
where c.name = 'AlphaROC'
  and not exists (select 1 from public.survey_projects p where p.client_id = c.id)
  and not exists (select 1 from public.profiles pr where pr.client_id = c.id);
