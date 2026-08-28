-- 091: a blast figure that nobody has recorded yet must not read as zero.
--
-- WHY THIS EXISTS
--
-- 058 added project_blasts.people and 060 added project_blasts.completes, both as
-- `integer not null default 0`; `bid` has been `numeric not null default 0` since
-- 043. BlastBlocks.tsx creates every new blast with {bid: 0, people: 0,
-- completes: 0}. So "this blast got zero completes" and "nobody has recorded the
-- completes yet" are stored as the SAME VALUE, and completes is exactly the field
-- that cannot be known at send time — it trickles in over days and is typed in by
-- hand, which in practice means usually never.
--
-- Measured on the live table, 2026-08-28:
--   * 8 of the 12 projects that have blasts have Σ(completes) = 0 while the
--     PROJECT collected real N (PR00307 86, PR00309 26 across 6 blasts,
--     PR00363 24, PR00270 34). A project cannot collect 86 completes through
--     blasts that produced none, so those zeros are missing data, not results.
--   * Blast cost is $/bid × completes (recompute_project_spend, 060 + 080), so
--     all 8 report $0 blast spend. At least ~$2,500 of real spend is invisible on
--     the four that at least recorded a bid; on PR00307, PR00257, PR00270 and
--     PR00388 the BID is 0 too, so the cost cannot even be estimated.
--   * 13 of the 18 blasts with a computable response rate show 0.00%, which made
--     an aggregate conclude that HIGHER bids produce LOWER response — the
--     opposite of reality, produced purely by absent data being averaged in as a
--     real zero.
--
-- The sales view David is asking for has to show cost-to-run and has to guide
-- "more audience vs higher incentive". Neither is possible while the cost silently
-- reads $0 and a blank response rate reads 0%.
--
-- THE DISCIPLINE THIS FOLLOWS
--
-- This repo already makes NULL mean "not recorded" where a zero would be a lie,
-- and says so at the column:
--   * project_financials.price_per_n (082) — "NULL means no rate agreed yet,
--     which margin must render as unknown, never as zero."
--   * project_segments.price_per_n (082) — NULL means "inherit the project
--     default", which is why it is deliberately not backfilled.
--   * survey_projects.n_target_max / project_segments.n_target_max (078) — absent
--     ceiling, not a ceiling of zero.
-- bid / people / completes join that set: NULL = not recorded, 0 = recorded and
-- it really was zero. Those are different facts and the app must show them
-- differently.
--
-- NO BACKFILL — DELIBERATE, DO NOT "FIX" THIS LATER
--
-- Every existing 0 stays a 0. We cannot tell which of them are genuine zeros
-- (a blast that truly landed nothing; a $0 reward) and which are the create
-- default nobody ever touched. Turning them into NULL would be a guess, and a
-- guess here DESTROYS the one thing we still know — that somebody at least once
-- looked at PR00309's six blasts. The zeros get corrected by hand, per blast, by
-- whoever knows. From today forward a NEW blast starts as unrecorded, which is
-- what stops the population of untrustworthy zeros from growing.
--
-- SPEND MUST NOT MOVE, AND IT DOES NOT
--
-- recompute_project_spend is rebuilt below with the blast columns coalesced to 0.
-- That is a provable no-op on the arithmetic: `sum()` already skips rows whose
-- expression is NULL, so a NULL row contributed nothing before and contributes
-- coalesce->0 now, and the pre-existing outer coalesce(..., 0) already covered
-- the all-rows-NULL / no-rows case. Every correctly-recorded blast therefore
-- computes to the same number to the cent. The coalesce is there to make the
-- intent explicit at the site, and so that a future edit which wraps the
-- expression in something NOT null-skipping (avg, an explicit division, a
-- COALESCE-less join) cannot silently change the total.
--
-- The three functions below were not retyped. They were EXTRACTED from the
-- highest-numbered migration that defines each one and spliced, and the splice
-- was audited with a mechanical unified diff — the 087/088/089 posture:
--   recompute_project_spend  <- 080_project_costs.sql   (only the blast term changed)
--   audit_project_blast      <- 060_blast_completes.sql (only the ::text renders changed)
--   mcp_log_blast            <- 076_blast_edit.sql      (only the DO UPDATE set-list changed)
-- Nothing after those files redefines them; 082/083/087/089 only `perform
-- public.recompute_project_spend(...)`.
--
-- mcp_update_blast (076) needs NO change and is deliberately absent. Its patch
-- arms are `case when p_patch ? 'completes' then (p_patch->>'completes')::int
-- else completes end`: jsonb `?` is TRUE for a key whose value is JSON null, and
-- `->>` yields SQL NULL for it, so {"completes": null} already writes NULL the
-- moment the column allows it. That is the path the connector uses to un-record a
-- figure that was entered by mistake.
--
-- APPLY ORDER — this one is dark-ship tolerant in the direction that matters, but
-- not in both:
--   * Creating a blast is safe either way, because the app OMITS bid/people/
--     completes from the INSERT rather than sending null. Pre-091 the column
--     defaults still fire and a new blast is born 0/0/0 (today's behaviour,
--     nothing breaks); post-091 the defaults are gone and it is born unrecorded.
--     That is the whole reason the insert omits rather than nulls.
--   * CLEARING an already-recorded figure back to unrecorded (the ✎ editor, or
--     connector update_blast with completes:null) writes an explicit NULL and
--     WILL be rejected until this file is applied — not-null violation, surfaced
--     as a visible "needs migration 091" message, never a silent no-op.
--   * Same for connector log_blast called WITHOUT a figure: it sends null on
--     purpose, so it fails loudly pre-091 rather than inventing a zero.
-- So: no surface goes dark waiting for this, but the new "leave it unrecorded"
-- capability only works once it is in.
--
-- Apply by hand in the Supabase SQL editor (David). Standalone and re-runnable;
-- wrapped in an explicit transaction so a half-applied file can never leave the
-- table nullable while recompute_project_spend / audit_project_blast still assume
-- NOT NULL.
begin;

-- 1) NULL becomes representable. Both halves matter: dropping NOT NULL is what
--    lets "unrecorded" exist at all, and dropping the DEFAULT is what makes an
--    INSERT that omits the column mean unrecorded instead of zero — which is
--    exactly how the app stays correct on both sides of this migration.
alter table public.project_blasts alter column completes drop not null;
alter table public.project_blasts alter column completes drop default;
alter table public.project_blasts alter column people    drop not null;
alter table public.project_blasts alter column people    drop default;
alter table public.project_blasts alter column bid       drop not null;
alter table public.project_blasts alter column bid       drop default;

-- A negative figure has no honest meaning in any of the three and would flip the
-- sign of a blast's cost, so refuse it in the table. The browser writes these
-- columns directly over PostgREST with no RPC chokepoint to validate in — the
-- same reason 078 step 3 and 082 put their guards down here. `is null or` so an
-- unrecorded value passes. drop-then-add because Postgres has no spelling for
-- `add constraint if not exists` (the 037 / 061 / 082 pattern).
alter table public.project_blasts drop constraint if exists project_blasts_figures_chk;
alter table public.project_blasts add constraint project_blasts_figures_chk
  check ((bid is null or bid >= 0)
     and (people is null or people >= 0)
     and (completes is null or completes >= 0));

comment on column public.project_blasts.completes is
  'How many people COMPLETED the survey from this blast. NULL means NOT RECORDED YET — completes trickle in for days after the send and are typed in by hand, so this is unknown far more often than it is zero. 0 means recorded and it really was zero. The two are different facts: cost is $/bid × completes, so an unrecorded value must render as unknown cost, NEVER as $0 (the price_per_n rule from 082). Existing 0s were deliberately NOT backfilled to NULL — see migration 091.';
comment on column public.project_blasts.people is
  'How many people this blast reached. Informational — it does not drive the cost, but it IS the denominator of the completion rate, so a 0 here fabricates a 0.00% response rate. NULL means not recorded.';
comment on column public.project_blasts.bid is
  'The per-completion reward in dollars — what we pay for ONE completed response. NULL means no bid recorded yet, so this blast''s cost is unknown; 0 means an unpaid send. Not project_costs.sms_email_blast (the platform fee for the send itself) and not the dead 043 blast_cost column.';

-- 2) 080's recompute_project_spend with the two nullable blast columns coalesced.
--    Provably the same number for every recorded blast (see the header): sum()
--    already skipped NULL rows. Supplier and cost terms untouched.
create or replace function public.recompute_project_spend(pid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.survey_projects set actual_spend =
      coalesce((select sum(coalesce(bid, 0) * coalesce(completes, 0)) from public.project_blasts where project_id = pid), 0)
    + coalesce((select sum(cpi * n_collected) from public.project_suppliers where project_id = pid), 0)
    + coalesce((select sum(amount) from public.project_costs where project_id = pid), 0)
  where id = pid;
end $$;
revoke execute on function public.recompute_project_spend(uuid) from public, anon, authenticated;

-- 3) 060's audit_project_blast with each figure rendered through coalesce(…,'—').
--    Not cosmetic: `NULL::text` anywhere in a `||` chain makes the WHOLE string
--    NULL, so the first unrecorded blast would have written a project_audit row
--    with an EMPTY new_value — a history entry whose silence reads as "nothing
--    changed", which is the failure mode 088 was written to stop. The UPDATE
--    guard is row-wise `is distinct from`, which is already NULL-correct, so
--    recording a figure for the first time (NULL -> 12) still fires exactly once.
create or replace function public.audit_project_blast()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text := coalesce(nullif(auth.email(), ''), nullif(current_setting('app.actor', true), ''), 'system');
begin
  if (TG_OP = 'INSERT') then
    insert into public.project_audit(project_id, field, new_value, changed_by)
    values (NEW.project_id, 'blast_added',
      coalesce(NEW.completes::text, '—') || ' completes / ' || coalesce(NEW.people::text, '—') || ' people @ $' || coalesce(NEW.bid::text, '—'), actor);
  elsif (TG_OP = 'DELETE') then
    insert into public.project_audit(project_id, field, old_value, changed_by)
    values (OLD.project_id, 'blast_removed',
      coalesce(OLD.completes::text, '—') || ' completes / ' || coalesce(OLD.people::text, '—') || ' people @ $' || coalesce(OLD.bid::text, '—'), actor);
    return OLD;
  elsif (TG_OP = 'UPDATE') then
    if (NEW.people, NEW.completes, NEW.bid, NEW.blast_at) is distinct from (OLD.people, OLD.completes, OLD.bid, OLD.blast_at) then
      insert into public.project_audit(project_id, field, old_value, new_value, changed_by)
      values (NEW.project_id, 'blast_changed',
        coalesce(OLD.completes::text, '—') || ' completes / ' || coalesce(OLD.people::text, '—') || ' people @ $' || coalesce(OLD.bid::text, '—'),
        coalesce(NEW.completes::text, '—') || ' completes / ' || coalesce(NEW.people::text, '—') || ' people @ $' || coalesce(NEW.bid::text, '—'), actor);
    end if;
  end if;
  return NEW;
end $$;

-- 4) 076's mcp_log_blast with the DO UPDATE set-list made non-destructive for the
--    three nullable figures. Re-logging the same idem_key is how a screenshot
--    re-import corrects a blast, and a re-import from a campaign Overview tab
--    legitimately has no completes to send. Before this, `completes =
--    excluded.completes` would have WIPED a number somebody had since typed in by
--    hand (and pre-091 it silently zeroed it, because the connector coerced the
--    missing value to 0). coalesce keeps the recorded value when the incoming one
--    is absent; a real incoming figure still wins. Un-recording is done
--    explicitly through mcp_update_blast, which is the honest place for it.
--    blast_at / note keep excluded.* — clearing those has always been intended
--    and neither is money.
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
    set bid = coalesce(excluded.bid, project_blasts.bid),
        people = coalesce(excluded.people, project_blasts.people),
        completes = coalesce(excluded.completes, project_blasts.completes),
        blast_at = excluded.blast_at,
        note = excluded.note
  returning * into r;
  return r;
end $$;
revoke execute on function public.mcp_log_blast(uuid, numeric, int, int, timestamptz, text, text, text, text) from public, anon, authenticated;
grant  execute on function public.mcp_log_blast(uuid, numeric, int, int, timestamptz, text, text, text, text) to service_role;

commit;
