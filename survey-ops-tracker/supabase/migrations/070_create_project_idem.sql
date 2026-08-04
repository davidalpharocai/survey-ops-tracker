-- create_project idempotency: a stable idem_key lets a retried confirm return the
-- already-created project instead of inserting a duplicate (e.g. when the tool
-- response is lost and the model re-issues the same confirm). Mirrors the money-append
-- idempotency pattern (project_blasts.idem_key, migrations 046/058/060).

-- 1) idem_key column + partial unique index (global; a create has no parent row).
alter table public.survey_projects add column if not exists idem_key text;
create unique index if not exists survey_projects_idem_uq
  on public.survey_projects(idem_key) where idem_key is not null;

-- 2) Recreate mcp_create_project with an optional p_idem. Drop the old 2-arg
--    signature first so the 3-arg-with-default isn't ambiguous with a lingering
--    2-arg version. Body is identical to migration 046 except the idem plumbing.
drop function if exists public.mcp_create_project(jsonb, text);
create or replace function public.mcp_create_project(p_patch jsonb, p_actor text, p_idem text default null)
returns public.survey_projects language plpgsql security definer set search_path = public as $$
declare r public.survey_projects;
begin
  perform set_config('app.actor', p_actor, true);
  -- Idempotency: a retried create with the same idem_key returns the existing
  -- project rather than inserting a duplicate.
  if nullif(p_idem,'') is not null then
    select * into r from survey_projects where idem_key = p_idem limit 1;
    if found then return r; end if;
  end if;
  insert into survey_projects (project_name, client, project_type, captain_id, salesperson, due_date, n_target, phase, board_column, scoping_stage, submitted_date, idem_key)
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
    nullif(p_patch->>'submitted_date','')::date,
    nullif(p_idem,'')
  ) returning * into r;
  return r;
exception when unique_violation then
  -- Lost a race on idem_key: return the row the winner created. Any OTHER unique
  -- violation is a genuine error — re-raise it rather than masking it.
  if nullif(p_idem,'') is not null then
    select * into r from survey_projects where idem_key = p_idem limit 1;
    if found then return r; end if;
  end if;
  raise;
end $$;

revoke execute on function public.mcp_create_project(jsonb, text, text) from public, anon, authenticated;
grant  execute on function public.mcp_create_project(jsonb, text, text) to service_role;
