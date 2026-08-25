-- 082: project_financials — the first REVENUE in the schema.
--
-- Migrations 001–081 contain no price, revenue, margin or invoice column
-- anywhere: every money number we store today is money going OUT (project_bids,
-- project_blasts' bid × completes, project_suppliers' CPI × collected, 080's flat
-- project_costs, and the `actual_spend` they roll into). This adds the other side
-- — what the CLIENT pays us per completed interview.
--
-- `survey_projects.budget` is NOT that number. Budget is a COST CEILING: the most
-- we intend to spend running the study (David, 2026-08-24). Do not reconcile it
-- against contract value as if the two should agree. The one comparison that IS
-- meaningful runs the other way: an authorised ceiling ABOVE contract value is a
-- negative-margin alert, because we have signed off on spending more than the
-- study will bill.
--
-- Model:
--   · project_financials.price_per_n is the PROJECT-LEVEL DEFAULT rate.
--   · project_segments.price_per_n overrides it for one segment. NULL there means
--     "inherit the project default" — which is why it is not backfilled.
--   · Everything else is DERIVED and deliberately not stored:
--       blended rate  = Σ(rate × N) / Σ(N)
--       contract value = Σ(rate × n_target) .. Σ(rate × n_target_max)   [078's range]
--     A stored blended rate would be a second source of truth that goes stale the
--     first time a segment's N moves, and N moves constantly during fielding.
--
-- Why a separate table instead of a column on survey_projects: the project detail
-- page reads that table with `select *` (as 078's header records), so a price
-- column would ride along in that payload whether or not the viewer may see it,
-- and every explicit select list — SLIM_PROJECT_COLUMNS in lib/hooks/useProjects.ts,
-- the lists in lib/mcp/data.ts, BASE_SELECT in lib/mcp/reports.ts, the sheet
-- write-back's column map — would each have to remember to leave it out. A
-- separate table inverts that default: the money is only in a response that
-- deliberately joined it. It also keeps audit_survey_project()'s hand-listed field
-- list (078 step 5) and the ~25 readers of that table untouched.
--
-- VISIBILITY IS A SOFT GATE, NOT A SECURITY BOUNDARY. Per David's explicit call,
-- price / contract value / margin / budget are hidden in the UI and suppressed in
-- CSV export, connector + assistant output and the daily digest — because those
-- are the paths a hidden number would otherwise walk out through — but this table
-- is readable by any authenticated analyst (see step 1's RLS note). Nothing here
-- protects it, and it must never be described as if it did.
--
-- APPLY ORDER — same PostgREST failure mode 078 documents, in its milder form. A
-- missing TABLE is survivable if the reader treats the query error as "no price"
-- (the 079 posture), but the new project_segments.price_per_n is a missing COLUMN,
-- and PostgREST fails the ENTIRE request when an explicit select list names one.
-- useProjectSegments selects `*` and is safe either way; copyProjectSegments in
-- lib/server/clone.ts names its columns and would 400 for every clone and every
-- spawned rerun wave. So: apply this before any explicit select or PATCH body
-- names price_per_n.
--
-- Apply in the Supabase SQL editor (David). Standalone and re-runnable; wrapped in
-- an explicit transaction because step 4 rebuilds merge_projects and a half-applied
-- file must not leave that function pointing at a table the merge cannot see.
begin;

-- 1) The project-level default rate. One row per project, so `project_id` IS the
--    key — there is no separate id, and no per-project uniqueness to police.
--    Bookkeeping mirrors rerun_meta (050) / rerun_series (073): created_* for who
--    first agreed a price, updated_* for who last moved it.
create table if not exists public.project_financials (
  project_id  uuid primary key references public.survey_projects(id) on delete cascade,
  price_per_n numeric(10,2),
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_by  text,
  updated_at  timestamptz not null default now()
);

comment on table public.project_financials is
  'Client revenue: the default price per completed N for one project. Per-segment overrides live in project_segments.price_per_n. Blended rate and contract value are DERIVED in the app, never stored here. Read-visible to every analyst — finance-only visibility is enforced in the app, not by RLS.';
comment on column public.project_financials.price_per_n is
  'What the client pays us for ONE completed interview, in dollars. Not a total, not a blended rate, and NOT survey_projects.budget (which is the cost ceiling — the most we intend to SPEND). NULL means no rate agreed yet, which margin must render as unknown, never as zero.';

-- A negative rate has no honest meaning and would silently flip the sign of every
-- margin figure computed from it, so refuse it in the table — the browser writes
-- this column directly over PostgREST with no RPC chokepoint to validate in, the
-- same reason 078 step 3 put the N-range guard down here.
-- Deliberately NOT mirrored onto project_costs.amount: a negative COST line can
-- legitimately express a vendor credit. Revenue has no such case.
-- drop-then-add rather than `add constraint if not exists` (which Postgres has no
-- spelling for) so a re-run is clean — the 037 / 061 pattern.
alter table public.project_financials drop constraint if exists project_financials_price_chk;
alter table public.project_financials add constraint project_financials_price_chk
  check (price_per_n is null or price_per_n >= 0);

-- Reuse 002's set_updated_at so `updated_at` cannot be forgotten by a caller.
-- Money history is the one place where "when did this change" has to be true even
-- when the write came straight from the browser, which is every write here.
drop trigger if exists project_financials_updated_at on public.project_financials;
create trigger project_financials_updated_at
  before update on public.project_financials
  for each row execute function public.set_updated_at();

-- RLS: the analyst policy every other project child table uses (project_costs 080,
-- project_launches 061), NOT a capability check.
--
-- THIS TABLE IS NOT PROTECTED AT THE DATABASE LAYER, and that is on purpose. The
-- gate is soft, so every analyst must still be able to READ the row — the project
-- page, the connector and the CSV path all go through the same queries whether or
-- not the person holds view_financials, and they decide what to SHOW afterwards.
-- A `can_view_financials()` predicate in USING would break all of them, and could
-- not be the only policy anyway: 079's helpers answer for auth.uid(), so they are
-- always false on a service-role connection and would lock the server out too.
-- Concretely, what this means: anyone who can sign into SOCC as an analyst — which
-- is everyone on the team — can read every price in here with the public anon key
-- and two lines of JavaScript. The only thing keeping these numbers off screen is
-- app code. Do not let a future reader mistake this policy for a wall.
--
-- No DELETE grant: clearing a price is `price_per_n = null`, which keeps the row
-- and its created_by/created_at and leaves an audit trail (step 3). Deleting the
-- row throws that away, so only the service role can.
alter table public.project_financials enable row level security;
revoke all on public.project_financials from anon, authenticated;
grant select, insert, update on public.project_financials to authenticated;
grant all on public.project_financials to service_role;
drop policy if exists project_financials_analyst_rw on public.project_financials;
create policy project_financials_analyst_rw on public.project_financials for all to authenticated
  using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');
drop policy if exists project_financials_service_all on public.project_financials;
create policy project_financials_service_all on public.project_financials
  for all to service_role using (true) with check (true);

-- 2) Per-segment override. NULL is MEANINGFUL — it means "inherit the project
--    default" — so there is deliberately no backfill: writing today's project rate
--    onto every segment would freeze it into those rows, and a later change to the
--    project default would then stop reaching segments that never had an override.
--    A reader resolves `coalesce(segment.price_per_n, project.price_per_n)`.
--
--    sync_segment_totals() (078 step 4) is deliberately NOT touched: it rolls
--    segment N sums onto the parent, and there is no price total to roll up — the
--    blended rate is derived, per the header.
alter table public.project_segments
  add column if not exists price_per_n numeric(10,2);

comment on column public.project_segments.price_per_n is
  'Optional per-segment override of project_financials.price_per_n, in dollars per completed N. NULL means inherit the project default — it is NOT the same as 0, and is never backfilled.';

alter table public.project_segments drop constraint if exists project_segments_price_chk;
alter table public.project_segments add constraint project_segments_price_chk
  check (price_per_n is null or price_per_n >= 0);

-- 3) Audit. Same shape as audit_project_cost (080) / audit_project_blast (060):
--    resolve the actor the same way, and build a readable summary string BEFORE
--    the feed sees it — the reason 028 resolves captain_id to a name and 080
--    resolves a cost slug to its label.
create or replace function public.price_per_n_label(p numeric) returns text
language sql immutable as $$
  select case when p is null then '—' else '$' || p::text || ' per N' end
$$;

-- WHY THE FIELD NAMES ALL SHARE A PREFIX — this is a soft-gate hole, and naming is
-- the only handle the app gets on it. Nothing that reads project_audit filters by
-- `field`: useProjectAudit takes `select *` (the project Logs tab), useAuditLog
-- takes a column list but every row (the MasterAuditLog), and both readers in
-- lib/mcp/data.ts — getChangeHistory and getLastChangeBatch, behind
-- get_change_history and undo_last_change — do the same. So every row written
-- below carries a restricted number into surfaces that do not suppress it yet, and
-- the suppression has to be one predicate on `field`: hence the shared
-- `price_per_n` / `segment_price` prefixes. That same filter MUST also cover the
-- plain `budget` rows audit_survey_project() has been writing since 078 step 5 —
-- budget is restricted under the same decision and is in the feed today.
--   These names are deliberately NOT added to UNDOABLE_FIELDS (lib/mcp/writes.ts):
--   undo reverts through mcp_write_project, which only writes survey_projects, so
--   it could never put a price back into this table anyway. They fall through to
--   "not an auto-revertible field", which is the honest answer.
--
-- INSERT and UPDATE only, NO DELETE branch — a deliberate departure from
-- audit_project_cost, not an omission. A hard project delete (the trash view's
-- usePermanentlyDeleteProject) cascades to child tables; a child's AFTER DELETE
-- trigger then inserts into project_audit whose own FK parent has already gone, so
-- the insert fails the FK check and takes the whole delete with it. That hazard is
-- pre-existing in audit_project_cost / audit_project_blast (see `risks`), and
-- adding a DELETE branch here would extend it to every project that has a price
-- row. Nothing is lost by leaving it out: analysts have no DELETE grant (step 1),
-- clearing a price is an UPDATE to NULL and IS logged below.
create or replace function public.audit_project_financials()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text := coalesce(nullif(auth.email(), ''), nullif(current_setting('app.actor', true), ''), 'system');
begin
  if (TG_OP = 'INSERT') then
    -- A row created with no rate yet carries no information; don't spend a feed line on it.
    if NEW.price_per_n is not null then
      insert into public.project_audit(project_id, field, new_value, changed_by)
      values (NEW.project_id, 'price_per_n_set', public.price_per_n_label(NEW.price_per_n), actor);
    end if;
  elsif (TG_OP = 'UPDATE') then
    if NEW.price_per_n is distinct from OLD.price_per_n then
      insert into public.project_audit(project_id, field, old_value, new_value, changed_by)
      values (NEW.project_id, 'price_per_n_changed',
        public.price_per_n_label(OLD.price_per_n), public.price_per_n_label(NEW.price_per_n), actor);
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists project_financials_audit on public.project_financials;
create trigger project_financials_audit
  after insert or update on public.project_financials
  for each row execute function public.audit_project_financials();

-- project_segments has never had an audit trigger of any kind, so without this one
-- a price agreed per segment could be changed with no trace — and the override is
-- the same money number as the project default. Scoped hard to price_per_n so it
-- can never fire on an ordinary N edit: an INSERT with no override and every
-- N/label change write nothing. Segment DELETE is out for the cascade reason above,
-- and because a removed segment takes its own N with it — the project's rolled-up
-- range moving is the visible event there.
create or replace function public.audit_segment_price()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text := coalesce(nullif(auth.email(), ''), nullif(current_setting('app.actor', true), ''), 'system');
begin
  if (TG_OP = 'INSERT') then
    if NEW.price_per_n is not null then
      insert into public.project_audit(project_id, field, new_value, changed_by)
      values (NEW.project_id, 'segment_price_set',
        NEW.label || ' — ' || public.price_per_n_label(NEW.price_per_n), actor);
    end if;
  elsif (TG_OP = 'UPDATE') then
    if NEW.price_per_n is distinct from OLD.price_per_n then
      insert into public.project_audit(project_id, field, old_value, new_value, changed_by)
      values (NEW.project_id, 'segment_price_changed',
        OLD.label || ' — ' || public.price_per_n_label(OLD.price_per_n),
        NEW.label || ' — ' || public.price_per_n_label(NEW.price_per_n), actor);
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists project_segments_price_audit on public.project_segments;
create trigger project_segments_price_audit
  after insert or update on public.project_segments
  for each row execute function public.audit_segment_price();

-- 4) merge_projects re-points a FIXED LIST of child tables and is blind to every
--    new one — 067 had to go back for launches/suppliers, 080 for cost lines, and
--    this is the third time. But project_financials cannot be re-pointed the way
--    those were: `project_id` is its PRIMARY KEY, so a bare
--    `update ... set project_id = p_survivor` raises a unique violation the moment
--    the survivor already has a row, and merging two priced projects would fail
--    outright. Doing nothing is no better — the loser is only soft-deleted, so the
--    price would sit on a row nothing reads again.
--
--    SURVIVOR-WINS: keep the survivor's row, discard the loser's, re-point only
--    when the survivor has none. The survivor is by definition the project that
--    continues — the one with the live client, the live dates and the live delivery
--    — so its negotiated rate is the one still in force; the loser's is the price
--    on a duplicate we are retiring. Same reasoning that already makes the
--    survivor's N segments win two lines up.
--
--    Row PRESENCE decides, not the value, so the rule stays deterministic. That
--    leaves one uncomfortable case — a survivor row whose price is still NULL
--    beating a loser that had a real rate — which is exactly why the discard is
--    written to the feed first: nothing about a price disappears silently, and the
--    number stays recoverable from the Logs tab.
--
--    Rebuilt verbatim from 080; the two `*_price` declares, the discard-audit
--    block and the delete/update pair below are the only additions. The re-point
--    itself writes no audit row (only project_id changes, so step 3's trigger sees
--    no price change) — correct, because the merge already logs merged_in /
--    merged_into.
create or replace function public.merge_projects(p_survivor uuid, p_loser uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  actor text := coalesce(nullif(auth.email(), ''), 'system');
  survivor_code text;
  loser_code text;
  ver_offset int;
  survivor_price numeric(10,2);
  loser_price numeric(10,2);
begin
  if public.my_role() <> 'analyst' then raise exception 'Not authorized'; end if;
  if p_survivor = p_loser then raise exception 'Cannot merge a project into itself'; end if;
  if not exists (select 1 from survey_projects where id = p_survivor and deleted_at is null)
    then raise exception 'Survivor project not found'; end if;
  if not exists (select 1 from survey_projects where id = p_loser and deleted_at is null)
    then raise exception 'Loser project not found'; end if;

  -- Discard the retired duplicate's N segments (survivor's N wins).
  delete from project_segments where project_id = p_loser;

  -- Survivor-wins on the price row (see the note above the function). Log the
  -- discarded rate BEFORE deleting it, so a merge can never lose a number quietly.
  select price_per_n into survivor_price from project_financials where project_id = p_survivor;
  select price_per_n into loser_price    from project_financials where project_id = p_loser;
  if loser_price is not null and exists (select 1 from project_financials where project_id = p_survivor) then
    insert into project_audit(project_id, field, old_value, new_value, changed_by)
      values (p_survivor, 'price_per_n_merge_discarded',
        public.price_per_n_label(loser_price), public.price_per_n_label(survivor_price), actor);
  end if;
  delete from project_financials l
    where l.project_id = p_loser
      and exists (select 1 from project_financials s where s.project_id = p_survivor);
  update project_financials set project_id = p_survivor where project_id = p_loser;

  update project_bids         set project_id = p_survivor where project_id = p_loser;
  update project_blasts       set project_id = p_survivor where project_id = p_loser;
  update project_costs        set project_id = p_survivor where project_id = p_loser;
  update project_steps        set project_id = p_survivor where project_id = p_loser;
  update project_activity     set project_id = p_survivor where project_id = p_loser;
  update project_data_changes set project_id = p_survivor where project_id = p_loser;
  update deliverables         set project_id = p_survivor where project_id = p_loser;
  update project_audit        set project_id = p_survivor where project_id = p_loser;

  -- PS: re-point launches first (ids unchanged → the suppliers' launch_id FK stays
  -- valid), then the supplier rows themselves.
  update project_launches     set project_id = p_survivor where project_id = p_loser;
  update project_suppliers    set project_id = p_survivor where project_id = p_loser;

  select coalesce(max(version), 0) into ver_offset
    from question_submissions where project_id = p_survivor;
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

  -- Reflect the merged-in supplier/blast/cost spend in the survivor's actual_spend.
  perform public.recompute_project_spend(p_survivor);
end $$;

grant execute on function public.merge_projects(uuid, uuid) to authenticated;

-- 5) Two things this file CANNOT fix from SQL, recorded where the next person
--    will look.
--
--    (a) RERUN WAVES INHERIT NOTHING. app/api/cron/spawn-reruns/route.ts spawns
--    the next wave of a series, and lib/reruns/spawnSeries.ts copies suppliers,
--    blasts and segments to it — but a brand-new wave has no project_financials
--    row. A rerun is the same study for the same client at the same rate, so the
--    price MUST be copied on the spawn path; the alternative is a wave that reads
--    as $0 revenue in every margin figure, which is worse than null because it
--    looks like an answer. The DECISION IS: copy it (the exact app-side change is
--    handed to the orchestrator). Until that lands — and as the permanent rule for
--    any project nobody has priced — a MISSING project_financials row is UNKNOWN,
--    never zero: render '—', and leave margin, contract value and the
--    budget-above-contract alert uncomputed rather than computed from a phantom 0.
--    Same for lib/server/clone.ts's cloneProject: a clone is normally the same
--    commercial deal, so the price should ride with it under a carry flag.
--
--    (b) PRICING MUST NEVER LIVE IN rerun_series.future_defaults. That column is
--    untyped jsonb, it ALREADY carries `budget` (lib/reruns/series.ts reads
--    fd.budget in nextWaveInherit), and 073 grants it to `authenticated` behind an
--    analyst policy — so it is both browser-readable and browser-WRITABLE, and it
--    has no audit trigger of any kind. A per-series rate deposited there would be
--    money that can_view_financials() cannot see, that no gate can suppress, and
--    that changes with no trace. Per-series pricing keys off project_financials, or
--    it does not exist.
comment on column public.rerun_series.future_defaults is
  'Untyped jsonb carry-forward for the next wave (see nextWaveInherit in lib/reruns/series.ts). Browser-readable AND browser-writable under the analyst policy, with no audit trigger. NEVER put pricing, margin or any revenue figure in here — finance-restricted numbers belong in project_financials, which is what the app''s visibility gate and every audit trail key off. It already carries `budget` (a cost ceiling), and that is as far as money goes in this column.';

commit;
