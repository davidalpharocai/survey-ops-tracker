-- 101: let the connector write cost line items.
--
-- WHY
--
-- A project's spend can be recorded three ways — blasts, PS launch CPIs, and
-- flat cost lines (project_costs, 080) — and the connector can write only the
-- first two. There is no tool for a cost line, so a data purchase gets typed
-- into the app by hand, or worse, recorded as a fake blast: right dollars,
-- wrong metrics, because a blast inflates contacts-sent and the response rate.
--
-- The handoff that asked for this proposed writing to the `bids` array that
-- get_project returns. THAT WOULD NOT HAVE WORKED, and it is worth recording
-- why so nobody tries again: project_bids is a dead table from migration 015
-- (10 legacy rows), it was superseded by the blast rework, and it is NOT a term
-- in recompute_project_spend — which is blasts + suppliers + project_costs. A
-- bid total therefore cannot roll into actual_spend, which was the handoff's own
-- stated critical requirement. get_project still surfaces that dead table as
-- `bids`, which is almost certainly what produced the suggestion; this change
-- stops advertising it.
--
-- That is not read off the SQL, it is MEASURED. Recomputing every project's
-- spend from the four candidate terms and diffing against the recorded value:
-- 0 of 386 live projects disagree by more than a cent when spend is taken as
--   Σ(blast bid × completes) + Σ(blast $/send × people) + Σ(cost line amount)
--   + Σ(supplier CPI × collected)
-- and project_bids is excluded — while those 10 bid rows hold $364.85 that is
-- in no project's spend. PR00402 is the worked example: $1,650.00 reward +
-- $1,288.34 send + $1,548.47 cost line = $4,486.81, its exact actual_spend.
-- So a cost line demonstrably already moves spend; this migration only gives
-- the connector a way to write one.
--
-- project_costs, by contrast, is already fully wired: 080 gave it a spend
-- trigger (sync_cost_spend -> recompute_project_spend) and an audit trigger
-- (audit_project_cost -> the project_audit feed), and 092 gave it `quantity` for
-- the unit x qty case. It needs nothing except an idempotency key and three
-- RPCs.
--
-- WHAT THIS ADDS
--   * project_costs.idem_key + a partial unique index, mirroring
--     project_blasts_idem_uq, so re-sending the same line updates it in place
--     instead of duplicating. 080 recorded that project_costs deliberately had
--     NO uniqueness ("a project can carry many"), which is still true of the
--     table — this constrains only rows that CHOOSE to carry a key.
--   * mcp_log_cost / mcp_update_cost / mcp_remove_cost, mirroring the blast
--     RPCs including their REVOKE.
--
-- THE REVOKE IS NOT OPTIONAL. On 2026-09-03, 095 created a new mcp_log_blast
-- signature and did not re-issue its revoke; a newly created function gets
-- Postgres's default ACL of EXECUTE TO PUBLIC, and the anon key that ships in
-- the browser bundle could call a SECURITY DEFINER write RPC and move a
-- project's actual_spend. 096 closed it. Every function below carries the pair.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable. No data change.
begin;

-- ---------------------------------------------------------------------------
-- 1) The idempotency key.
--
--    Nullable, because the app's own "+ Add cost" button has no reason to invent
--    one — a human adding a line in the UI is not retrying a network call. Only
--    connector callers pass it, and only they get upsert behaviour.
--
--    A PARTIAL unique index, exactly like project_blasts_idem_uq. To be precise
--    about what the predicate does and does not buy, because the obvious guess
--    is wrong: a plain unique index on (project_id, idem_key) would ALREADY
--    permit any number of NULL-keyed rows per project, since Postgres indexes
--    are NULLS DISTINCT by default. The predicate is not what makes hand entry
--    possible. It keeps the index off the rows that can never collide, and it
--    states the intent in the schema — this constrains only rows that CHOOSE to
--    carry a key.
--
--    SO BE CLEAR ABOUT WHAT IS *NOT* PREVENTED: two add_cost calls with no
--    idem_key insert two rows, and recompute_project_spend counts both. That is
--    the 095/PR00362 double-count shape. Nothing in the database stops it —
--    identical cost lines are legitimate (two separate invoices for the same
--    amount), so a constraint would be wrong. The defence is in the tool: the
--    add_cost preview names any existing line on the project with the same kind
--    and amount, so a caller about to duplicate one is told before confirming.
-- ---------------------------------------------------------------------------
alter table public.project_costs
  add column if not exists idem_key text;

comment on column public.project_costs.idem_key is
  'Optional caller-supplied key making a write idempotent. Set by connector tools so re-sending the same cost line updates it rather than duplicating; left NULL by the app UI, where a human adding a line is not retrying anything.';

create unique index if not exists project_costs_idem_uq
  on public.project_costs (project_id, idem_key)
  where idem_key is not null;

-- ---------------------------------------------------------------------------
-- 2) ADD (or update, on a repeat key).
--
--    p_quantity is stored as given and NOT used to compute p_amount here: the
--    caller computes it, because 092's CHECK makes quantity a divisor
--    (`quantity is null or quantity > 0`) and the app already treats amount as
--    "exactly as invoiced". Doing the multiplication in SQL as well would give
--    two definitions of one number — the failure this codebase has paid for
--    three times in a fortnight. The connector tool does the arithmetic once,
--    shows it in the preview, and stores the result.
-- ---------------------------------------------------------------------------
create or replace function public.mcp_log_cost(
  p_project uuid, p_kind text, p_amount numeric, p_quantity int,
  p_description text, p_incurred_on date, p_created_by text,
  p_idem text, p_actor text
) returns public.project_costs language plpgsql security definer set search_path = public as $$
declare r public.project_costs;
begin
  perform set_config('app.actor', p_actor, true);
  if not exists (select 1 from survey_projects where id = p_project and deleted_at is null) then
    raise exception 'Project not found';
  end if;

  -- p_amount IS REQUIRED, stated rather than papered over.
  --
  -- The insert below has to coalesce it, because 080 made amount NOT NULL. That
  -- coalesce means excluded.amount is never NULL, which in turn means the
  -- `amount = coalesce(excluded.amount, project_costs.amount)` arm of the ON
  -- CONFLICT can never fall through — so a retry that omitted the amount would
  -- ZERO the stored figure rather than leaving it alone, the exact opposite of
  -- what the comment on that arm promises.
  --
  -- Unreachable through add_cost today (resolveCostMoney refuses a call with no
  -- money at all), but "unreachable" is not a contract, and the calling tool now
  -- tells its user that an omitted field keeps its recorded value. Raise instead,
  -- so the promise is true for every caller rather than true by luck.
  if p_amount is null then
    raise exception 'A cost line needs an amount. Pass the total in dollars; use mcp_update_cost to change one that is already recorded.';
  end if;

  insert into project_costs (project_id, kind, amount, quantity, description, incurred_on, created_by, idem_key)
    values (p_project, p_kind, coalesce(p_amount, 0), p_quantity, p_description, p_incurred_on, p_created_by, p_idem)
  on conflict (project_id, idem_key) where idem_key is not null do update
    -- coalesce on the way in, so a retry that omits a field LEAVES the recorded
    -- value alone rather than blanking it. Same rule as mcp_log_blast: use
    -- mcp_update_cost to un-record something on purpose.
    set kind        = coalesce(excluded.kind, project_costs.kind),
        amount      = coalesce(excluded.amount, project_costs.amount),
        quantity    = coalesce(excluded.quantity, project_costs.quantity),
        description = coalesce(excluded.description, project_costs.description),
        incurred_on = coalesce(excluded.incurred_on, project_costs.incurred_on)
  returning * into r;
  return r;
end $$;

revoke execute on function
  public.mcp_log_cost(uuid, text, numeric, int, text, date, text, text, text)
  from public, anon, authenticated;
grant execute on function
  public.mcp_log_cost(uuid, text, numeric, int, text, date, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3) UPDATE — patch-shaped, so only the keys present change.
-- ---------------------------------------------------------------------------
create or replace function public.mcp_update_cost(p_cost uuid, p_patch jsonb, p_actor text)
returns public.project_costs language plpgsql security definer set search_path = public as $$
declare r public.project_costs;
begin
  perform set_config('app.actor', p_actor, true);
  update project_costs set
    kind        = case when p_patch ? 'kind'        then p_patch->>'kind' else kind end,
    amount      = case when p_patch ? 'amount'      then coalesce(nullif(p_patch->>'amount','')::numeric, 0) else amount end,
    -- quantity CAN be un-recorded (set back to null) on purpose: a line first
    -- entered as unit x qty may turn out to be a flat fee.
    quantity    = case when p_patch ? 'quantity'    then nullif(p_patch->>'quantity','')::int else quantity end,
    description = case when p_patch ? 'description' then p_patch->>'description' else description end,
    incurred_on = case when p_patch ? 'incurred_on' then nullif(p_patch->>'incurred_on','')::date else incurred_on end
  where id = p_cost
  returning * into r;
  if not found then raise exception 'Cost line not found'; end if;
  return r;
end $$;

revoke execute on function public.mcp_update_cost(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.mcp_update_cost(uuid, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4) REMOVE. A real delete, like mcp_remove_blast — a cost line has no
--    soft-delete column and the audit trigger records the removal, so the
--    history survives the row.
-- ---------------------------------------------------------------------------
create or replace function public.mcp_remove_cost(p_cost uuid, p_actor text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.actor', p_actor, true);
  delete from project_costs where id = p_cost;
  if not found then raise exception 'Cost line not found'; end if;
end $$;

revoke execute on function public.mcp_remove_cost(uuid, text) from public, anon, authenticated;
grant execute on function public.mcp_remove_cost(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5) Teach the audit trigger about `quantity`.
--
--    080 wrote the UPDATE guard as
--      (NEW.kind, NEW.amount, NEW.description, NEW.incurred_on)
--        is distinct from (OLD....)
--    and 092 then added `quantity` WITHOUT extending it, reasoning that no RPC
--    wrote the table so the browser was the only mutator. THIS MIGRATION IS
--    WHAT MAKES THAT REASONING FALSE. As written, `update_cost` changing only
--    the quantity moves the column and the guard evaluates false, so no
--    project_audit row is written at all: get_change_history and the project
--    Activity feed both show that nothing happened.
--
--    That is not cosmetic. quantity is a DIVISOR — 092 exists so unit cost is
--    derivable as amount / quantity — so a silent edit from 22,121 to 40,000
--    moves PR00402's cost per contact from $0.07 to $0.0387 with no trace of
--    who did it or when. An unauditable money edit is the thing this codebase
--    keeps paying for.
--
--    Both halves fixed: the guard notices a quantity change, and the rendered
--    before/after actually shows the number, so an audited change is legible
--    rather than just logged. `create or replace` preserves the existing ACL
--    (096's lesson), and Postgres does not check EXECUTE on a trigger function,
--    so there is no grant to re-issue here.
-- ---------------------------------------------------------------------------
-- One renderer for both sides of the diff, so the before and after can never
-- drift into different formats. "Contacts Export $1548.47 x 22121 — ZoomInfo
-- download". The quantity is omitted entirely when NULL rather than printed as
-- 0: a flat fee has no unit count, which is not the same as a count of none.
--
-- No revoke on this one, deliberately, matching cost_kind_label from 080: it is
-- `immutable sql`, NOT security definer, reads no table and takes its inputs as
-- arguments, so an anon caller can learn nothing from it that it did not already
-- supply. The revoke discipline above is for the SECURITY DEFINER functions that
-- write money.
create or replace function public.cost_line_label(
  p_kind text, p_amount numeric, p_quantity int, p_description text
) returns text language sql immutable as $$
  select public.cost_kind_label(p_kind)
      || ' $' || coalesce(p_amount, 0)::text
      || coalesce(' x ' || p_quantity::text, '')
      || coalesce(' — ' || p_description, '')
$$;

create or replace function public.audit_project_cost()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor text := coalesce(nullif(auth.email(), ''), nullif(current_setting('app.actor', true), ''), 'system');
begin
  if (TG_OP = 'INSERT') then
    insert into public.project_audit(project_id, field, new_value, changed_by)
    values (NEW.project_id, 'cost_added',
      public.cost_line_label(NEW.kind, NEW.amount, NEW.quantity, NEW.description), actor);
  elsif (TG_OP = 'DELETE') then
    insert into public.project_audit(project_id, field, old_value, changed_by)
    values (OLD.project_id, 'cost_removed',
      public.cost_line_label(OLD.kind, OLD.amount, OLD.quantity, OLD.description), actor);
    return OLD;
  elsif (TG_OP = 'UPDATE') then
    if (NEW.kind, NEW.amount, NEW.quantity, NEW.description, NEW.incurred_on)
       is distinct from (OLD.kind, OLD.amount, OLD.quantity, OLD.description, OLD.incurred_on) then
      insert into public.project_audit(project_id, field, old_value, new_value, changed_by)
      values (NEW.project_id, 'cost_changed',
        public.cost_line_label(OLD.kind, OLD.amount, OLD.quantity, OLD.description),
        public.cost_line_label(NEW.kind, NEW.amount, NEW.quantity, NEW.description), actor);
    end if;
  end if;
  return NEW;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- VERIFY the revokes actually took. Do not read the absence of an error as
-- proof, and do not use a partial argument list.
--
-- THE OBVIOUS PROBE DOES NOT WORK, and this is worth spelling out because the
-- first version of this block used it. PostgREST resolves an RPC by matching
-- the JSON body's keys to a function signature. These functions have no
-- defaults, so a body carrying only p_project matches NOTHING and PostgREST
-- answers 404 / PGRST202 — the SAME answer it gives for a function that does
-- not exist at all. Measured against mcp_log_blast, which 096 definitively
-- locked:
--
--   {"p_project": "..."}   -> HTTP 404, PGRST202   (locked)
--   {"p_project": "..."}   -> HTTP 404, PGRST202   (a function that isn't there)
--
-- Identical. A partial-argument probe therefore cannot tell "safely locked"
-- from "wide open" from "never applied", and reading its 404 as reassurance is
-- exactly how 095's hole would have survived this check.
--
-- SEND THE FULL ARGUMENT LIST. Then the answers separate cleanly:
--
--   HTTP 401 / 42501  permission denied for function  -> LOCKED. Correct.
--   HTTP 404 / PGRST202                               -> NOT APPLIED YET.
--   HTTP 400 / 22P02  invalid input syntax for uuid   -> ***STILL OPEN***.
--                     The anon key reached the function body. Fix immediately.
--
--   A=$ANON_KEY; U=$SUPABASE_URL; Z=00000000-0000-0000-0000-000000000000
--
--   curl -si -X POST "$U/rest/v1/rpc/mcp_log_cost" \
--     -H "apikey: $A" -H "Authorization: Bearer $A" -H "Content-Type: application/json" \
--     -d "{\"p_project\":\"$Z\",\"p_kind\":\"contacts_export\",\"p_amount\":0,
--          \"p_quantity\":null,\"p_description\":null,\"p_incurred_on\":null,
--          \"p_created_by\":\"probe\",\"p_idem\":\"probe\",\"p_actor\":\"probe\"}"
--
--   curl -si -X POST "$U/rest/v1/rpc/mcp_update_cost" \
--     -H "apikey: $A" -H "Authorization: Bearer $A" -H "Content-Type: application/json" \
--     -d "{\"p_cost\":\"$Z\",\"p_patch\":{},\"p_actor\":\"probe\"}"
--
--   curl -si -X POST "$U/rest/v1/rpc/mcp_remove_cost" \
--     -H "apikey: $A" -H "Authorization: Bearer $A" -H "Content-Type: application/json" \
--     -d "{\"p_cost\":\"$Z\",\"p_actor\":\"probe\"}"
--
-- The all-zero UUID is deliberate: if a probe DID reach a body, it matches no
-- project, so mcp_log_cost raises 'Project not found' and the other two raise
-- 'Cost line not found' — a real 42501 is impossible to confuse with a write.
--
-- scripts/_revoke-probe-test.mjs runs this and prints the comparison.
