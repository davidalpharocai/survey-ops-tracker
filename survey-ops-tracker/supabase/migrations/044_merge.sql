-- Merge duplicate projects/clients. Structural re-pointing + soft-delete of the
-- loser, atomically. Field conflict-resolution is applied by the UI (a normal
-- typed update on the survivor) before these run.

-- Clients gain soft-delete (projects already have deleted_at).
alter table public.clients add column if not exists deleted_at timestamptz;

-- ---- merge_projects ----
create or replace function public.merge_projects(p_survivor uuid, p_loser uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  actor text := coalesce(nullif(auth.email(), ''), 'system');
  survivor_code text;
  loser_code text;
  ver_offset int;
begin
  if public.my_role() <> 'analyst' then raise exception 'Not authorized'; end if;
  if p_survivor = p_loser then raise exception 'Cannot merge a project into itself'; end if;
  if not exists (select 1 from survey_projects where id = p_survivor and deleted_at is null)
    then raise exception 'Survivor project not found'; end if;
  if not exists (select 1 from survey_projects where id = p_loser and deleted_at is null)
    then raise exception 'Loser project not found'; end if;
  if exists (select 1 from project_segments where project_id in (p_survivor, p_loser))
    then raise exception 'Un-split segmented N before merging'; end if;

  update project_bids        set project_id = p_survivor where project_id = p_loser;
  update project_blasts       set project_id = p_survivor where project_id = p_loser;
  update project_steps        set project_id = p_survivor where project_id = p_loser;
  update project_activity     set project_id = p_survivor where project_id = p_loser;
  update project_data_changes set project_id = p_survivor where project_id = p_loser;
  update deliverables         set project_id = p_survivor where project_id = p_loser;
  update project_audit        set project_id = p_survivor where project_id = p_loser;

  select coalesce(max(version), 0) into ver_offset
    from question_submissions where project_id = p_survivor;
  -- Renumber the loser's submissions into a clean contiguous block above the
  -- survivor's max, so a version gap or a version=0 row cannot collide.
  update question_submissions qs
    set project_id = p_survivor, version = ver_offset + r.rn
    from (
      select id, row_number() over (order by version, id) as rn
      from question_submissions where project_id = p_loser
    ) r
    where qs.id = r.id;

  delete from project_recipients l
    where l.project_id = p_loser
      and exists (select 1 from project_recipients s
                  where s.project_id = p_survivor and s.email = l.email and s.role = l.role);
  update project_recipients set project_id = p_survivor where project_id = p_loser;

  delete from project_seen where project_id = p_loser;

  update survey_projects set deleted_at = now() where id = p_loser;

  select project_code into survivor_code from survey_projects where id = p_survivor;
  select project_code into loser_code   from survey_projects where id = p_loser;
  insert into project_audit(project_id, field, new_value, changed_by)
    values (p_survivor, 'merged_in', coalesce(loser_code, p_loser::text), actor);
  insert into project_audit(project_id, field, new_value, changed_by)
    values (p_loser, 'merged_into', coalesce(survivor_code, p_survivor::text), actor);
end $$;

-- ---- merge_clients ----
create or replace function public.merge_clients(p_survivor uuid, p_loser uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  survivor_name text;
begin
  if public.my_role() <> 'analyst' then raise exception 'Not authorized'; end if;
  if p_survivor = p_loser then raise exception 'Cannot merge a client into itself'; end if;
  if not exists (select 1 from clients where id = p_survivor and deleted_at is null)
    then raise exception 'Survivor client not found'; end if;
  if not exists (select 1 from clients where id = p_loser and deleted_at is null)
    then raise exception 'Loser client not found'; end if;

  select name into survivor_name from clients where id = p_survivor;

  update survey_projects set client_id = p_survivor where client_id = p_loser;
  update survey_projects
    set client = survivor_name ||
      (case when position(' - ' in coalesce(client, '')) > 0
            then substring(client from position(' - ' in client)) else '' end)
    where client_id = p_survivor;

  update profiles        set client_id = p_survivor where client_id = p_loser;
  update deliverables    set client_id = p_survivor where client_id = p_loser;
  update client_contacts set client_id = p_survivor where client_id = p_loser;
  update client_notes    set client_id = p_survivor where client_id = p_loser;

  update clients set deleted_at = now() where id = p_loser;
end $$;

grant execute on function public.merge_projects(uuid, uuid) to authenticated;
grant execute on function public.merge_clients(uuid, uuid) to authenticated;
