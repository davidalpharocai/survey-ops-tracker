-- 076: B2B blasts become editable — parity with PS launches.
--
-- Before: mcp_log_blast INSERTs and, on a duplicate (project_id, idem_key),
-- does an idempotent NO-OP (returns the existing row unchanged). So a blast
-- logged with completes=0 (e.g. from a campaign Overview tab, before completes
-- are known) could never have its completes filled via the connector.
--
-- After:
--   1. mcp_log_blast UPSERTs — an existing idem_key UPDATEs bid/people/completes/
--      blast_at/note instead of no-op'ing (mirrors log_launch's label upsert).
--   2. mcp_update_blast(id, jsonb patch) — edit any subset of fields on a blast
--      resolved by id (the connector resolves an idem_key → id first). Mirrors
--      mcp_update_segment (057): only keys present in the patch change.
--   3. mcp_remove_blast(id) — delete a blast. Mirrors mcp_remove_segment.
--
-- All three set app.actor so the existing project_blasts_audit trigger (060)
-- attributes the change, and every write fires project_blasts_spend (043) which
-- recomputes survey_projects.actual_spend = Σ(bid×completes) + Σ(cpi×collected).
-- Nothing to backfill. Apply in the Supabase SQL editor.

-- 1) UPSERT on the partial unique index project_blasts_idem_uq
--    (project_id, idem_key) WHERE idem_key IS NOT NULL.
create or replace function public.mcp_log_blast(
  p_project uuid, p_bid numeric, p_people int, p_completes int, p_blast_at timestamptz,
  p_note text, p_created_by text, p_idem text, p_actor text
) returns public.project_blasts language plpgsql security definer set search_path = public as $$
declare r public.project_blasts;
begin
  perform set_config('app.actor', p_actor, true);
  insert into project_blasts (project_id, bid, people, completes, blast_at, note, created_by, idem_key)
    values (p_project, p_bid, p_people, p_completes, p_blast_at, p_note, p_created_by, p_idem)
  on conflict (project_id, idem_key) where idem_key is not null do update
    set bid = excluded.bid,
        people = excluded.people,
        completes = excluded.completes,
        blast_at = excluded.blast_at,
        note = excluded.note
  returning * into r;
  return r;
end $$;
revoke execute on function public.mcp_log_blast(uuid, numeric, int, int, timestamptz, text, text, text, text) from public, anon, authenticated;
grant  execute on function public.mcp_log_blast(uuid, numeric, int, int, timestamptz, text, text, text, text) to service_role;

-- 2) Patch a blast by id — only keys present in p_patch change (mirrors
--    mcp_update_segment). numeric/int keys cast; blast_at accepts null.
create or replace function public.mcp_update_blast(p_blast uuid, p_patch jsonb, p_actor text)
returns public.project_blasts language plpgsql security definer set search_path = public as $$
declare r public.project_blasts;
begin
  perform set_config('app.actor', p_actor, true);
  update project_blasts set
    bid       = case when p_patch ? 'bid'       then (p_patch->>'bid')::numeric      else bid end,
    people    = case when p_patch ? 'people'    then (p_patch->>'people')::int       else people end,
    completes = case when p_patch ? 'completes' then (p_patch->>'completes')::int    else completes end,
    blast_at  = case when p_patch ? 'blast_at'  then nullif(p_patch->>'blast_at','')::timestamptz else blast_at end,
    note      = case when p_patch ? 'note'      then p_patch->>'note'                 else note end
  where id = p_blast
  returning * into r;
  return r;
end $$;
revoke execute on function public.mcp_update_blast(uuid, jsonb, text) from public, anon, authenticated;
grant  execute on function public.mcp_update_blast(uuid, jsonb, text) to service_role;

-- 3) Delete a blast by id (mirrors mcp_remove_segment).
create or replace function public.mcp_remove_blast(p_blast uuid, p_actor text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.actor', p_actor, true);
  delete from project_blasts where id = p_blast;
end $$;
revoke execute on function public.mcp_remove_blast(uuid, text) from public, anon, authenticated;
grant  execute on function public.mcp_remove_blast(uuid, text) to service_role;
