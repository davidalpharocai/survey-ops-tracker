-- 092: record HOW MANY a flat cost line bought, not just what it cost.
--
-- WHY THIS EXISTS
--
-- David wants the sales view to guide the choice between buying more audience
-- and raising the incentive, and confirmed the audience is a PAID export
-- (ZoomInfo / Apollo). That makes it an arithmetic question rather than a
-- judgement call, but only if we know the cost per contact:
--
--   more audience :  c x max(0, R/r - u)  +  b x R
--   raise the bid :  b' x R
--
--   R = completes still needed      r = observed response rate
--   u = unsent audience remaining   b = current $/bid
--   c = $ PER CONTACT               b' = the higher bid
--
-- Rearranged, the break-even bid is  b* = b + c x E / R  (E = extra contacts to
-- buy). Above b*, raising the incentive costs more than simply buying the
-- contacts. Every term in that is already in SOCC except c.
--
-- project_costs (080) stores `amount` and nothing else, so a $4,000
-- contacts_export could be four thousand contacts or forty thousand. c is
-- underivable, and the whole recommendation collapses to a guess.
--
-- WHAT THIS ADDS
--
-- One nullable column. `quantity` is what the money bought, in the natural unit
-- of the cost kind:
--   contacts_export  -> number of contacts
--   sms_email_blast  -> number of sends
--
-- NULLABLE ON PURPOSE, and NULL is meaningful — it means "nobody recorded how
-- many", which is not zero. This is the same discipline as price_per_n (082),
-- n_target_max (078) and the blast figures (091), and 091 is the cautionary
-- tale: `not null default 0` there made "no completes" and "not counted"
-- indistinguishable, and the result was eight projects silently reporting $0
-- spend. A `default 0` here would be worse still, because quantity is a DIVISOR:
-- amount / 0 is not a wrong unit cost, it is an infinity or a crash.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- * No `unit_cost` column. It is amount / quantity — derivable, so storing it
--   invites the two-fields-one-idea drift that series_id / rerun_series_id
--   already cost a day to unpick. Compute it at read time.
-- * No backfill. The single existing cost row is a $0 sms_email_blast with an
--   empty description, so there is nothing to infer a quantity from, and
--   inventing one would poison the very average this exists to produce.
-- * recompute_project_spend is NOT touched. Spend is the sum of `amount`;
--   quantity never enters it, so the trigger and every figure derived from it
--   are unchanged. Verified: the function references project_costs.amount only.
-- * No RPC arm needed. Unlike project_segments (084), project_costs has no
--   mcp_* write function with `case when p_patch ? 'col'` arms that would
--   silently drop an unmentioned key — lib/hooks/useProjectCosts.ts writes the
--   table directly, so a new column is reachable the moment the UI sends it.
--
-- A NOTE ON WHAT c ACTUALLY MEANS, for whoever wires the recommendation:
-- the right c is the MARGINAL cost of the next batch. If exports are sold in
-- fixed tranches with a minimum spend, amount / quantity is the average of a
-- past purchase and understates the cost of buying a few more contacts. The
-- guidance should say which it used. Flagged with David; unresolved at time of
-- writing.
--
-- Apply by hand in the Supabase SQL editor (David). Standalone and re-runnable;
-- safe to apply before or after the code that writes it, since an absent column
-- simply means the field is never sent.
begin;

alter table public.project_costs
  add column if not exists quantity integer;

-- > 0, never = 0. A zero would divide by zero in amount / quantity, and "this
-- purchase bought nothing" is not a state worth representing: if no contacts
-- arrived, the line does not belong on the project.
alter table public.project_costs
  drop constraint if exists project_costs_quantity_chk;
alter table public.project_costs
  add constraint project_costs_quantity_chk
  check (quantity is null or quantity > 0);

comment on column public.project_costs.quantity is
  'How many units this cost bought - contacts for a contacts_export, sends for an sms_email_blast. NULL means nobody recorded it, which is NOT zero. Divided into `amount` at read time to get the unit cost that the audience-vs-incentive guidance needs; no unit_cost column exists, because a derived value stored alongside its inputs drifts from them.';

commit;
