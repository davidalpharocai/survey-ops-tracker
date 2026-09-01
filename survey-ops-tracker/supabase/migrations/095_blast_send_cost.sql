-- 095: a blast has TWO costs. The reward, and the cost of sending.
--
-- WHY THIS EXISTS
--
-- David, 2026-09-01: "we have a fixed cost line item for cost per contact in
-- blast. currently, it's always $0.02/contact. you can then multiply the # sent
-- x the cost/contact." Confirmed the same day, when asked whether it is charged
-- per message or per unique person: "its only on the sent."
--
-- Until now a blast cost exactly one thing: the REWARD, $/bid x completes (060).
-- That is what we pay a respondent for finishing. It is not what it costs to put
-- the message in front of them, and that second cost has been tracked NOWHERE.
--
-- The size of the hole, measured across all 35 live blasts before writing this:
--
--     total sent                    204,804
--     reward cost recorded today    $6,190.00
--     SEND COST at $0.02            $4,096.08   <- invisible
--
-- So blast cost has been understated by about two thirds of what we do record.
-- Two consequences worth naming, because they will both show up on screen the
-- moment this lands and neither is a bug:
--
--   * PR00309 goes from $0 to $1,915.76 -- 0% to 85% of its $2,250 budget --
--     WITHOUT anyone backfilling its missing completes. Its whole cost was send
--     cost. PR00363 likewise, $0 -> $241.08.
--   * PR00362 goes from 78% to 127% OF BUDGET. It is genuinely over by $822 and
--     has been all along; and that figure is still understated, because 2 of its
--     13 blasts have no sent count recorded at all.
--
-- PER SEND, NOT PER UNIQUE CONTACT -- and the distinction is the whole reason
-- this file says so three times. PR00309 sent to the same 31,545-person list on
-- three separate days: 95,788 sends over 31,545 people. Per send that is
-- $1,915.76; per unique contact it would be $630.90. David settled it as per
-- send. The column is therefore named cost_per_send and NOT cost_per_contact:
-- "contact" reads as a person, and a name that can be read two ways is exactly
-- how audience_size spent a year meaning two different things (see 094).
--
-- NOT THE SAME AS BUYING THE LIST. project_costs.quantity (092) exists for
-- ACQUIRING contacts -- $500 for a 10,000-row ZoomInfo export is $0.05 per
-- contact acquired, once. This is the cost of SENDING to them, every time. They
-- stack, and neither is a duplicate of the other:
--     acquire 10,000 contacts    $500     one flat cost line
--     send to them three times   $600     30,000 sends x $0.02
--     rewards                    $/bid x completes
--
-- THE RATE LIVES ON THE BLAST, defaulted from config -- the future-proofing
-- David asked for. Two layers:
--   * app_config.blast_cost_per_send is the CURRENT rate, changeable without a
--     deploy.
--   * project_blasts.cost_per_send is the rate THAT BLAST WAS CHARGED, captured
--     at insert time from the config value.
-- So raising the rate to $0.03 next year prices new blasts at $0.03 and leaves
-- every historical blast costing exactly what it cost. A single hardcoded
-- constant would silently restate two years of spend the day it changed. This is
-- the same reason `bid` is stored per blast rather than per client.
--
-- It also absorbs per-channel pricing with no further schema. The live data
-- already contains SMS blasts ("SMS - Pharm biotech strategy", PR00309) and SMS
-- is unlikely to cost the same as email; when that matters, type a different
-- rate on that blast.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable. Reversible by
-- re-running 091's recompute_project_spend / audit_project_blast / mcp_log_blast
-- and 076's mcp_update_blast, then dropping the two columns.
--
-- APPLY ORDER -- SQL FIRST, as always: PostgREST fails the whole request when an
-- explicit select names a missing column, and lib/utils/blast.ts's callers are
-- about to name cost_per_send.
begin;

-- 1) The current rate, in one place, changeable without a deploy.
--    app_config is a singleton (id = 1) with typed columns, so this is a column
--    rather than a key/value row.
alter table public.app_config
  add column if not exists blast_cost_per_send numeric not null default 0.02;

comment on column public.app_config.blast_cost_per_send is
  'Current default cost per SEND for a B2B blast, in dollars. Copied onto each new blast at insert time (see project_blasts.cost_per_send), so changing it prices future blasts and never restates past ones.';

-- 2) Read the current rate. Exists as a function so it can be the COLUMN DEFAULT
--    below: that way ANY insert path -- the browser, the connector RPC, a
--    one-off script -- captures the rate in force at the time without having to
--    remember to pass it. Forgetting is otherwise the obvious failure, and it
--    would be silent.
--
--    Falls back to 0.02 if the config row is somehow absent, rather than
--    returning null, because a null rate would make the blast's cost unknown and
--    quietly drop it out of actual_spend.
create or replace function public.default_blast_cost_per_send()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select blast_cost_per_send from public.app_config where id = 1), 0.02);
$$;

-- 3) The rate this blast was actually charged.
alter table public.project_blasts
  add column if not exists cost_per_send numeric default public.default_blast_cost_per_send();

comment on column public.project_blasts.cost_per_send is
  'Dollars per SEND for this blast -- charged per message, so three reminder passes over one list cost three times. NOT per unique contact, and NOT the cost of acquiring the list (that is a project_costs line, see migration 092). Captured from app_config at insert time so a later rate change cannot restate this blast.';

do $chk$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_blasts_cost_per_send_chk') then
    alter table public.project_blasts add constraint project_blasts_cost_per_send_chk
      check (cost_per_send is null or cost_per_send >= 0);
  end if;
end $chk$;

-- 4) Backfill every existing blast to 0.02.
--
--    Deliberately a real value rather than leaving NULL to fall back to config at
--    read time. A read-time fallback would mean the day the rate changes, all 35
--    historical blasts silently reprice -- the precise failure this design is
--    built to prevent. David states the rate has always been 0.02, so pinning it
--    records what is true rather than what is current.
--
--    0 is a legitimate rate (an owned list that costs nothing to send to) and is
--    NOT what an unrecorded rate means, so only NULLs are touched.
--
--    project_blasts carries an AFTER trigger that recomputes project spend and an
--    audit trigger. Both are WANTED here: this update is exactly the moment
--    actual_spend should pick up +$4,096 across 6 projects, and the audit entry
--    is the record of why every project's spend moved on one day.
update public.project_blasts
   set cost_per_send = 0.02
 where cost_per_send is null;

-- 5) Spend now includes the send cost.
--
--    091's body with the blast term extended. One subquery rather than two: the
--    two blast costs are summed in a single scan of the same rows.
--
--    coalesce(people, 0) keeps 091's discipline -- an unrecorded sent count adds
--    NOTHING rather than guessing. That makes actual_spend a FLOOR on any project
--    with an unrecorded figure, which is why lib/utils/blast.ts keeps a separate
--    display path that renders unknown as unknown instead of as $0, and why
--    data_health reports the unrecorded ones. Two of 35 blasts are in that state
--    today, both on PR00362.
create or replace function public.recompute_project_spend(pid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.survey_projects set actual_spend =
      coalesce((select sum(coalesce(bid, 0) * coalesce(completes, 0)
                         + coalesce(people, 0) * coalesce(cost_per_send, 0))
                  from public.project_blasts where project_id = pid), 0)
    + coalesce((select sum(cpi * n_collected) from public.project_suppliers where project_id = pid), 0)
    + coalesce((select sum(amount) from public.project_costs where project_id = pid), 0)
  where id = pid;
end $$;

-- 6) Recompute every project that has blasts, so stored spend matches the new
--    formula immediately rather than drifting until each project's next edit.
--    Step 4's update already fired the trigger for rows it touched; this covers
--    any project whose blasts all already had a rate (i.e. a re-run of this file).
do $recalc$
declare p uuid;
begin
  for p in select distinct project_id from public.project_blasts loop
    perform public.recompute_project_spend(p);
  end loop;
end $recalc$;

-- 7) Audit the rate alongside the other blast figures. It is a money field now,
--    so a change to it has to leave the same trace a bid change does.
create or replace function public.audit_project_blast()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text := coalesce(nullif(auth.email(), ''), nullif(current_setting('app.actor', true), ''), 'system');
begin
  if (TG_OP = 'INSERT') then
    insert into public.project_audit(project_id, field, new_value, changed_by)
    values (NEW.project_id, 'blast_added',
      coalesce(NEW.completes::text, '—') || ' completes / ' || coalesce(NEW.people::text, '—') || ' people @ $' || coalesce(NEW.bid::text, '—')
      || ' bid, $' || coalesce(NEW.cost_per_send::text, '—') || '/send', actor);
  elsif (TG_OP = 'DELETE') then
    insert into public.project_audit(project_id, field, old_value, changed_by)
    values (OLD.project_id, 'blast_removed',
      coalesce(OLD.completes::text, '—') || ' completes / ' || coalesce(OLD.people::text, '—') || ' people @ $' || coalesce(OLD.bid::text, '—')
      || ' bid, $' || coalesce(OLD.cost_per_send::text, '—') || '/send', actor);
    return OLD;
  elsif (TG_OP = 'UPDATE') then
    if (NEW.people, NEW.completes, NEW.bid, NEW.blast_at, NEW.cost_per_send)
       is distinct from (OLD.people, OLD.completes, OLD.bid, OLD.blast_at, OLD.cost_per_send) then
      insert into public.project_audit(project_id, field, old_value, new_value, changed_by)
      values (NEW.project_id, 'blast_changed',
        coalesce(OLD.completes::text, '—') || ' completes / ' || coalesce(OLD.people::text, '—') || ' people @ $' || coalesce(OLD.bid::text, '—')
        || ' bid, $' || coalesce(OLD.cost_per_send::text, '—') || '/send',
        coalesce(NEW.completes::text, '—') || ' completes / ' || coalesce(NEW.people::text, '—') || ' people @ $' || coalesce(NEW.bid::text, '—')
        || ' bid, $' || coalesce(NEW.cost_per_send::text, '—') || '/send', actor);
    end if;
  end if;
  return NEW;
end $$;

-- 8) The connector write paths.
--
--    mcp_log_blast gains a parameter, which means DROPPING the old function
--    first: adding an argument creates an OVERLOAD rather than replacing, and two
--    callable versions of a write RPC is how a caller silently keeps using the
--    old one. Dropped by its exact 9-argument signature so a re-run is safe.
--
--    p_cost_per_send is nullable and, when null, falls through to the column
--    default -- i.e. today's config rate. So an older connector client that does
--    not know about the parameter still produces a correctly priced blast.
drop function if exists public.mcp_log_blast(uuid, numeric, int, int, timestamptz, text, text, text, text);

create or replace function public.mcp_log_blast(
  p_project uuid, p_bid numeric, p_people int, p_completes int, p_blast_at timestamptz,
  p_note text, p_created_by text, p_idem text, p_actor text, p_cost_per_send numeric default null
) returns public.project_blasts language plpgsql security definer set search_path = public as $$
declare r public.project_blasts;
begin
  perform set_config('app.actor', p_actor, true);
  insert into project_blasts (project_id, bid, people, completes, blast_at, note, created_by, idem_key, cost_per_send)
    values (p_project, p_bid, p_people, p_completes, p_blast_at, p_note, p_created_by, p_idem,
            coalesce(p_cost_per_send, public.default_blast_cost_per_send()))
  on conflict (project_id, idem_key) where idem_key is not null do update
    set bid = coalesce(excluded.bid, project_blasts.bid),
        people = coalesce(excluded.people, project_blasts.people),
        completes = coalesce(excluded.completes, project_blasts.completes),
        blast_at = excluded.blast_at,
        note = excluded.note,
        -- On a retry, keep the rate already stored unless the caller sent one:
        -- an idempotent replay must not silently reprice a blast because the
        -- config default moved between the first call and the retry.
        cost_per_send = coalesce(p_cost_per_send, project_blasts.cost_per_send)
  returning * into r;
  return r;
end $$;

-- 076's body plus one line. Patch-shaped, so no signature change.
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
    note      = case when p_patch ? 'note'      then p_patch->>'note'                 else note end,
    cost_per_send = case when p_patch ? 'cost_per_send' then nullif(p_patch->>'cost_per_send','')::numeric else cost_per_send end
  where id = p_blast
  returning * into r;
  return r;
end $$;

commit;
