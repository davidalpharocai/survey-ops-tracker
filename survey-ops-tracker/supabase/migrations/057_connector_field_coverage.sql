-- 057: expand connector/assistant write coverage — Phase 1 (plain fields + N segments).
-- Applied manually in the Supabase SQL editor (David), like the other mcp_* RPCs.
--
-- (1) Widen mcp_write_project to accept fields the allow-list never learned:
--     audience (migration 052), category, objective, sprint_number,
--     n_floor_override + n_floor_override_reason (migration 056). This is the
--     DB half; the tool-layer allow-list (PROJECT_WRITE_FIELDS) is widened in code.
-- (2) Add mcp_add_segment / mcp_update_segment / mcp_remove_segment so the
--     connector can manage the N-segment breakdown (project_segments, migration
--     039). The existing sync_segment_totals trigger keeps the parent project's
--     segment_count + n_target/n_collected/n_actual correct, and — because these
--     RPCs set app.actor first — the resulting parent-N change is audited as
--     "<email> via Claude" through the existing audit_survey_project trigger.

-- ---------------------------------------------------------------------------
-- (1) mcp_write_project — full redefinition with the 6 added SET clauses.
-- ---------------------------------------------------------------------------
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

  update survey_projects set
    project_name       = case when p_patch ? 'project_name'       then p_patch->>'project_name' else project_name end,
    client             = case when p_patch ? 'client'             then p_patch->>'client' else client end,
    project_type       = case when p_patch ? 'project_type'       then (p_patch->>'project_type')::project_type else project_type end,
    captain_id         = case when p_patch ? 'captain_id'         then nullif(p_patch->>'captain_id','')::uuid else captain_id end,
    co_captain_ids     = case when p_patch ? 'co_captain_ids'     then coalesce((select array_agg(x)::uuid[] from jsonb_array_elements_text(p_patch->'co_captain_ids') x), '{}'::uuid[]) else co_captain_ids end,
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
    -- NEW in 057:
    audience           = case when p_patch ? 'audience'           then p_patch->>'audience' else audience end,
    category           = case when p_patch ? 'category'           then p_patch->>'category' else category end,
    objective          = case when p_patch ? 'objective'          then p_patch->>'objective' else objective end,
    sprint_number      = case when p_patch ? 'sprint_number'      then nullif(p_patch->>'sprint_number','')::int else sprint_number end,
    n_floor_override        = case when p_patch ? 'n_floor_override'        then (p_patch->>'n_floor_override')::boolean else n_floor_override end,
    n_floor_override_reason = case when p_patch ? 'n_floor_override_reason' then p_patch->>'n_floor_override_reason' else n_floor_override_reason end,
    compliance_override= case when p_patch ? 'compliance_override' then (p_patch->>'compliance_override')::boolean else compliance_override end,
    requested_by_contact_id = case when p_patch ? 'requested_by_contact_id' then nullif(p_patch->>'requested_by_contact_id','')::uuid else requested_by_contact_id end,
    requested_by_name  = case when p_patch ? 'requested_by_name'  then p_patch->>'requested_by_name' else requested_by_name end,
    latest_next_steps  = case when p_patch ? 'latest_next_steps'  then p_patch->>'latest_next_steps' else latest_next_steps end,
    linked_documents   = case when p_patch ? 'linked_documents'   then (select array_agg(x) from jsonb_array_elements_text(p_patch->'linked_documents') x) else linked_documents end
  where id = p_id
  returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- (2) Segment RPCs. Mirror mcp_add_step: set app.actor, then mutate
--     project_segments; the sync_segment_totals trigger recomputes parent N.
-- ---------------------------------------------------------------------------
create or replace function public.mcp_add_segment(
  p_project uuid, p_label text, p_actor text,
  p_target int default null, p_collected int default null,
  p_actual int default null, p_sort int default null
) returns public.project_segments language plpgsql security definer set search_path = public as $$
declare r public.project_segments;
begin
  perform set_config('app.actor', p_actor, true);
  if not exists (select 1 from survey_projects where id = p_project and deleted_at is null) then
    raise exception 'Project not found';
  end if;
  insert into project_segments (project_id, label, n_target, n_collected, n_actual, sort_order)
  values (
    p_project, p_label, p_target, coalesce(p_collected, 0), p_actual,
    coalesce(p_sort, (select coalesce(max(sort_order) + 1, 0) from project_segments where project_id = p_project))
  ) returning * into r;
  return r;
end $$;

create or replace function public.mcp_update_segment(p_segment uuid, p_patch jsonb, p_actor text)
returns public.project_segments language plpgsql security definer set search_path = public as $$
declare r public.project_segments;
begin
  perform set_config('app.actor', p_actor, true);
  update project_segments set
    label       = case when p_patch ? 'label'       then p_patch->>'label' else label end,
    n_target    = case when p_patch ? 'n_target'    then nullif(p_patch->>'n_target','')::int else n_target end,
    n_collected = case when p_patch ? 'n_collected' then coalesce(nullif(p_patch->>'n_collected','')::int, 0) else n_collected end,
    n_actual    = case when p_patch ? 'n_actual'    then nullif(p_patch->>'n_actual','')::int else n_actual end
  where id = p_segment
  returning * into r;
  if not found then raise exception 'Segment not found'; end if;
  return r;
end $$;

create or replace function public.mcp_remove_segment(p_segment uuid, p_actor text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.actor', p_actor, true);
  delete from project_segments where id = p_segment;
  if not found then raise exception 'Segment not found'; end if;
end $$;

-- Same lockdown as the other mcp_* RPCs: service_role only.
revoke all on function public.mcp_add_segment(uuid, text, text, int, int, int, int) from public, anon, authenticated;
grant execute on function public.mcp_add_segment(uuid, text, text, int, int, int, int) to service_role;
revoke all on function public.mcp_update_segment(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.mcp_update_segment(uuid, jsonb, text) to service_role;
revoke all on function public.mcp_remove_segment(uuid, text) from public, anon, authenticated;
grant execute on function public.mcp_remove_segment(uuid, text) to service_role;
