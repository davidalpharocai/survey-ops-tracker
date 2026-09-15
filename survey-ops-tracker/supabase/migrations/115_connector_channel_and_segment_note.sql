-- 115: two shipped columns the connector cannot reach.
--
-- David, 2026-09-13: "lets fix those two connector gaps." Both are columns that
-- exist, are used by the app, and are priced or displayed off — and that Claude
-- has no way to set, so both had to be patched around by hand this week.
--
--   1. project_blasts.channel   (112) — decides whether send cost is charged.
--   2. project_segments.note    (084) — the per-segment comment. David has asked
--                                       for segment notes twice.
--
-- ── WHY channel STILL NEEDS A PARAMETER AFTER 114 ───────────────────────────
-- 114 added a trigger that fills `channel` from the structured "EMAIL · " /
-- "SMS · " prefix the CM import writes, and argued against a parameter on the
-- grounds that a trigger covers every writer at once. That argument was right
-- and it is not the whole job. The trigger can only read a prefix that a MACHINE
-- wrote. It does nothing for the case this tool is actually used in:
--
--   "log the email blast that went to 12,000 people on Tuesday"
--
-- The note there is prose, there is no prefix, the trigger declines (correctly —
-- an unanchored match on the word "email" is exactly the PR00300 mistake 112
-- refused to make), and the blast lands with channel NULL. NULL is charged, by
-- deliberate design, so an email blast logged through the connector is billed
-- send cost it never incurred: 12,000 x $0.02 = $240 of invented spend, silently,
-- on a project's budget bar and margin.
--
-- So: the trigger keeps covering the writers that emit a prefix, and the
-- parameter covers the caller who simply KNOWS. The trigger never overrides an
-- explicit value, so the two cannot fight — an answer always beats an inference.
--
-- ── THE OVERLOAD TRAP, AND WHY THIS DROPS BY OID ────────────────────────────
-- Both functions gain an argument, and in Postgres that CREATES AN OVERLOAD
-- rather than replacing: `create or replace` cannot change a signature. Two
-- callable versions of a write RPC, both with every extra argument defaulted, is
-- worse than either one alone — every named-argument call then fails with
-- "function is not unique" and the tool stops working altogether. That specific
-- risk is why migration 084 looked at adding p_note to mcp_add_segment and
-- deliberately walked away from it:
--
--   "if that drop's type list is off by one, create or replace leaves TWO
--    all-defaulted overloads behind"
--
-- That is a real hazard of `drop function ...(uuid, text, text, int, int, int,
-- int, int)` — a hand-typed type list that misses is a silent no-op, because of
-- the `if exists`. So this migration does not hand-type a type list at all. It
-- enumerates the overloads from pg_proc and drops each BY OID, which cannot miss
-- and cannot be off by one, then asserts afterwards that exactly one remains.
-- Self-healing rather than fragile: if a previous accident already left two
-- behind, this collapses them to one instead of refusing.
--
-- ── AND IT RE-LOCKS ITSELF, WITHOUT BEING ASKED ─────────────────────────────
-- DROP + CREATE resets the ACL to Postgres's default, EXECUTE TO PUBLIC. That is
-- exactly how 095 left mcp_log_blast — a SECURITY DEFINER write RPC — callable by
-- anyone holding the anon key shipped in the browser bundle, until 096 caught it.
-- 096 closed it and left a standing rule: re-issue the revoke/grant every time,
-- and PROBE it rather than assuming.
--
-- This migration takes the probe off the human. After re-issuing the grants it
-- asserts, in SQL, that neither `anon` nor `authenticated` can execute any of the
-- three functions, and raises if they can. A migration that re-opened the hole
-- now fails loudly instead of committing quietly.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable. No data change.
begin;

-- ---------------------------------------------------------------------------
-- 1) mcp_log_blast gains p_channel.
-- ---------------------------------------------------------------------------
do $drop$
declare f record;
begin
  for f in
    -- pg_get_function_identity_arguments gives exactly the type list DROP wants, and
    -- %I.%I forces the schema on, so this cannot depend on whatever search_path the SQL
    -- editor happens to have. Building the name from the catalogue is the whole point:
    -- a hand-typed type list that is one type off is a silent no-op under `if exists`,
    -- and that silent no-op is what leaves two overloads behind.
    select format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'mcp_log_blast'
  loop
    raise notice 'dropping %', f.sig;
    execute 'drop function ' || f.sig;
  end loop;
end $drop$;

create function public.mcp_log_blast(
  p_project uuid, p_bid numeric, p_people int, p_completes int, p_blast_at timestamptz,
  p_note text, p_created_by text, p_idem text, p_actor text,
  p_cost_per_send numeric default null,
  p_channel text default null
) returns public.project_blasts language plpgsql security definer set search_path = public as $$
declare r public.project_blasts;
begin
  perform set_config('app.actor', p_actor, true);

  -- Fail on a bad channel HERE, with a sentence a caller can act on. The column
  -- check constraint would also reject it, as 23514 naming a constraint, which
  -- surfaces to the user as noise.
  if p_channel is not null and p_channel not in ('email', 'sms') then
    raise exception 'channel must be ''email'' or ''sms'' (got %)', p_channel;
  end if;

  insert into project_blasts (project_id, bid, people, completes, blast_at, note, created_by, idem_key, cost_per_send, channel)
    values (p_project, p_bid, p_people, p_completes, p_blast_at, p_note, p_created_by, p_idem,
            coalesce(p_cost_per_send, public.default_blast_cost_per_send()), p_channel)
  on conflict (project_id, idem_key) where idem_key is not null do update
    set bid = coalesce(excluded.bid, project_blasts.bid),
        people = coalesce(excluded.people, project_blasts.people),
        completes = coalesce(excluded.completes, project_blasts.completes),
        blast_at = excluded.blast_at,
        note = excluded.note,
        -- On a retry, keep the rate already stored unless the caller sent one:
        -- an idempotent replay must not silently reprice a blast because the
        -- config default moved between the first call and the retry.
        cost_per_send = coalesce(p_cost_per_send, project_blasts.cost_per_send),
        -- Same discipline, and it matters more here: re-importing a screenshot
        -- that carries no channel must not wipe a channel somebody set by hand
        -- in the UI, because wiping it silently re-charges the send cost.
        channel = coalesce(p_channel, project_blasts.channel)
  returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- 2) mcp_update_blast gains a `channel` arm. Patch-shaped, so no signature
--    change and no overload risk -- `create or replace` keeps the existing ACL.
--    The revoke/grant below is re-issued anyway: it costs nothing and it means
--    nobody has to remember which of these two cases they are in.
--
--    A key present with a JSON null CLEARS the channel, i.e. walks it back to
--    "never recorded", consistent with every other field on this RPC. Clearing
--    re-arms 114's trigger, which will re-derive from the prefix if there is one.
-- ---------------------------------------------------------------------------
create or replace function public.mcp_update_blast(p_blast uuid, p_patch jsonb, p_actor text)
returns public.project_blasts language plpgsql security definer set search_path = public as $$
declare r public.project_blasts;
begin
  perform set_config('app.actor', p_actor, true);

  if p_patch ? 'channel'
     and p_patch->>'channel' is not null
     and p_patch->>'channel' not in ('email', 'sms') then
    raise exception 'channel must be ''email'' or ''sms'' (got %)', p_patch->>'channel';
  end if;

  update project_blasts set
    bid       = case when p_patch ? 'bid'       then (p_patch->>'bid')::numeric      else bid end,
    people    = case when p_patch ? 'people'    then (p_patch->>'people')::int       else people end,
    completes = case when p_patch ? 'completes' then (p_patch->>'completes')::int    else completes end,
    blast_at  = case when p_patch ? 'blast_at'  then nullif(p_patch->>'blast_at','')::timestamptz else blast_at end,
    note      = case when p_patch ? 'note'      then p_patch->>'note'                 else note end,
    cost_per_send = case when p_patch ? 'cost_per_send' then nullif(p_patch->>'cost_per_send','')::numeric else cost_per_send end,
    channel   = case when p_patch ? 'channel'   then nullif(p_patch->>'channel','')   else channel end
  where id = p_blast
  returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- 3) mcp_add_segment gains p_note -- the thing 084 declined to do.
--
--    084 added the note COLUMN and taught mcp_update_segment to patch it, so a
--    segment could be given a note only in two calls: add, then update. The
--    connector has been doing exactly that, and a failure between the two leaves
--    a segment with no note and no error anyone sees.
-- ---------------------------------------------------------------------------
do $drop$
declare f record;
begin
  for f in
    select format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'mcp_add_segment'
  loop
    raise notice 'dropping %', f.sig;
    execute 'drop function ' || f.sig;
  end loop;
end $drop$;

create function public.mcp_add_segment(
  p_project uuid, p_label text, p_actor text,
  p_target int default null, p_collected int default null,
  p_actual int default null, p_sort int default null,
  p_target_max int default null,
  p_note text default null
) returns public.project_segments language plpgsql security definer set search_path = public as $$
declare r public.project_segments;
begin
  perform set_config('app.actor', p_actor, true);
  if not exists (select 1 from survey_projects where id = p_project and deleted_at is null) then
    raise exception 'Project not found';
  end if;
  insert into project_segments (project_id, label, n_target, n_target_max, n_collected, n_actual, sort_order, note)
  values (
    p_project, p_label, p_target, p_target_max, coalesce(p_collected, 0), p_actual,
    coalesce(p_sort, (select coalesce(max(sort_order) + 1, 0) from project_segments where project_id = p_project)),
    p_note
  ) returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Re-lock. Named in full so a future overload cannot take the revoke instead.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.mcp_log_blast(uuid, numeric, int, int, timestamptz, text, text, text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function
  public.mcp_log_blast(uuid, numeric, int, int, timestamptz, text, text, text, text, numeric, text)
  to service_role;

revoke execute on function public.mcp_update_blast(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.mcp_update_blast(uuid, jsonb, text) to service_role;

revoke execute on function
  public.mcp_add_segment(uuid, text, text, int, int, int, int, int, text)
  from public, anon, authenticated;
grant execute on function
  public.mcp_add_segment(uuid, text, text, int, int, int, int, int, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5) Assert it, rather than assume it. This is 096's curl probe, moved into the
--    migration so it can never be skipped. Raises inside the transaction, so a
--    failure rolls the whole thing back rather than shipping half-applied.
-- ---------------------------------------------------------------------------
do $verify$
declare
  fname text;
  n int;
  f record;
begin
  foreach fname in array array['mcp_log_blast', 'mcp_update_blast', 'mcp_add_segment']::text[] loop
    select count(*) into n
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = fname;

    -- Exactly one. Two all-defaulted overloads is the failure 084 feared, and it
    -- shows up as "function is not unique" at the first named-argument call --
    -- i.e. in production, not here. Catch it here.
    if n <> 1 then
      raise exception '%: expected exactly 1 overload after this migration, found %', fname, n;
    end if;

    for f in
      select p.oid, p.oid::regprocedure::text as sig
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = fname
    loop
      -- PUBLIC grants apply to every role, so anon holding EXECUTE also catches
      -- a grant that was left to PUBLIC.
      if has_function_privilege('anon', f.oid, 'EXECUTE') then
        raise exception 'SECURITY: % is executable by anon -- the 095/096 hole, reopened', f.sig;
      end if;
      if has_function_privilege('authenticated', f.oid, 'EXECUTE') then
        raise exception 'SECURITY: % is executable by authenticated', f.sig;
      end if;
      if not has_function_privilege('service_role', f.oid, 'EXECUTE') then
        raise exception '% is NOT executable by service_role -- the connector would 500', f.sig;
      end if;
    end loop;
  end loop;
end $verify$;

commit;

-- PostgREST caches the schema, and these functions changed SHAPE rather than body. Supabase
-- reloads the cache on DDL by itself, but it costs nothing to ask and it removes the one
-- way this lands correctly in the database and still answers
-- "Could not find the function public.mcp_log_blast(...)" to the next connector call.
notify pgrst, 'reload schema';

-- VERIFY, after applying. The migration already asserted all of this and would
-- have rolled back if it failed, so these are for reading, not for trusting:
--
--   -- one overload each, with the new argument last:
--   select p.oid::regprocedure
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('mcp_log_blast', 'mcp_update_blast', 'mcp_add_segment');
--
--   -- and the anon probe from 096, which must now say 42501:
--   curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/mcp_log_blast" \
--     -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
--     -H "Content-Type: application/json" -d '{"p_project":"not-a-uuid"}'
--
-- 22P02 means it is OPEN. 42501 "permission denied" is what correct looks like.
