-- 086: Make the financial gate real at the database layer.
--
-- WHAT IS WRONG TODAY
--
-- 082 granted project_financials to `authenticated` behind the ordinary analyst
-- policy and said so out loud: "anyone who can sign into SOCC as an analyst —
-- which is everyone on the team — can read every price in here with the public
-- anon key and two lines of JavaScript. Do not let a future reader mistake this
-- policy for a wall." That was a deliberate, correct trade when the gate was
-- soft by choice and the audience was fourteen trusted colleagues.
--
-- It stops being correct now, for two reasons that arrived together:
--   · 031 auto-provisions ANY @alpharoc.ai signup as an analyst, so inviting a
--     salesperson would hand them database-level read AND WRITE on pricing and
--     margin before anyone touched their profile. (085 step 8 fixes the trigger;
--     this file fixes what the trigger was exposing.)
--   · David asked for strong permissions rather than a hidden UI.
--
-- WHY 082's OBJECTION NO LONGER HOLDS
--
-- 082 argued a can_view_financials() predicate "would break all of them",
-- meaning the project page, the connector and the CSV path, which all read the
-- row regardless of who is asking and filter afterwards. Checked path by path,
-- that turns out not to be true any more — and possibly never was:
--
--   · lib/server/clone.ts            → createAdminClient() → service role
--   · app/api/cron/spawn-reruns      → createAdminClient() → service role
--   · the connector / assistant      → server-side, admin client
--   · lib/hooks/useProjectFinancials → the BROWSER client, as the user
--
-- Only the last one evaluates this policy at all, and it is precisely the path
-- that should be gated. The service role keeps its own `for all` policy (below),
-- so 082's second objection — that these helpers answer for auth.uid() and are
-- therefore always false on a service-role connection — is handled by that
-- policy rather than by loosening this one.
--
-- And a denied SELECT is not an error, it is zero rows. useProjectFinancials
-- reads with .maybeSingle() and each half already swallows its own failure,
-- because a project with no price set is the normal case. So a non-finance
-- analyst sees exactly what they see today: nothing. The difference is that now
-- there is nothing to see rather than something hidden.
--
-- WHAT THIS DOES NOT FIX — READ THIS BEFORE CALLING THE GATE AIRTIGHT
--
-- 1. project_segments.price_per_n (082) is a per-segment price override living
--    on a table every analyst must read to edit N. RLS cannot restrict a COLUMN,
--    and the obvious alternative — a column-level GRANT — would make the
--    browser's `select *` in useProjectSegments fail outright with "permission
--    denied for column", breaking segment editing for everyone. Hardening it
--    means moving it to its own child table, which is a migration with real
--    blast radius and belongs in its own change. Until then the SEGMENT price
--    remains soft-gated while the PROJECT price is hard-gated.
-- 2. 71 files use createAdminClient(), which bypasses RLS entirely. RLS is the
--    floor, not the whole wall; lib/auth/financials.ts is the single server-side
--    gate those routes must call.
-- 3. project_costs (080) is cost-to-run, NOT revenue, and is deliberately left
--    open — everyone internal is supposed to see what we spend.
--
-- REVERTING: re-run 082's two policy statements. Nothing else here is
-- destructive; no data is moved or dropped.
--
-- Apply by hand in the Supabase SQL editor (David), AFTER 085 — this file calls
-- can_view_financials(), which 085 rewires to read roles as well as direct
-- grants. Applying it before 085 still works (079's version answers from direct
-- grants alone, and all three finance holders have one) but would briefly mean a
-- role-only grant did not open the table. Re-runnable.
begin;

-- ── The project-level money table ─────────────────────────────────────────────
-- `for all` with the predicate in BOTH using and with check: a non-finance
-- analyst can no longer read a price, and no longer write one either. The write
-- half matters as much as the read — 082 granted INSERT and UPDATE to
-- `authenticated`, so today any analyst can set a client's price from the
-- browser console, and the audit trail would name them as the author of a number
-- they were never meant to touch.
drop policy if exists project_financials_analyst_rw on public.project_financials;
drop policy if exists project_financials_finance_rw on public.project_financials;
create policy project_financials_finance_rw on public.project_financials for all to authenticated
  using (public.can_view_financials())
  with check (public.can_view_financials());

-- Unchanged from 082, restated so this file is self-contained and re-runnable.
-- Every server path depends on it: the service role has no JWT, so
-- can_view_financials() is false for it and the policy above would deny.
drop policy if exists project_financials_service_all on public.project_financials;
create policy project_financials_service_all on public.project_financials
  for all to service_role using (true) with check (true);

comment on table public.project_financials is
  'Client pricing (price per completed N) and everything derived from it. HARD-GATED at the database layer as of 086: only a holder of view_financials can read or write a row from the browser. Server code uses the service role and must call the app gate in lib/auth/financials.ts. Cost-to-run lives in project_costs (080) and is deliberately open to everyone internal.';

-- ── The export log ────────────────────────────────────────────────────────────
-- 081 made data_exports service-role-write-only so nobody can forge an export
-- record under a colleague's name. Reads were left to the analyst policy, which
-- means one analyst can see what everybody exported. That is fine and arguably
-- the point of an export log, so it stays — restated here only because a reader
-- comparing the two money-adjacent tables will otherwise wonder if it was
-- missed. It was not.
--
-- No change. Documented, not modified.

commit;
