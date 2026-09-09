-- 108: a third cost kind, and it is deliberately "other".
--
-- David asked what the third one should be. The honest answer is that the data
-- does not say: I scanned every project note, next-step and activity snippet for
-- translation, panel, incentive, recruiting, honorarium and stipend, and every
-- hit was a false positive — "lost in translation", "sample data", "panel" in an
-- unrelated sentence. One cost line exists in the entire database.
--
-- So rather than invent a category nobody has asked for, this adds an escape
-- hatch and lets the descriptions tell us what the real third category is:
--
--   * The failure it fixes is immediate. A closed two-value enum forces a
--     translation invoice to be filed as "Contacts Export" or "SMS/Email Blast",
--     and the kind is not decoration — health check 9 reads `sms_email_blast`
--     to find the send-cost double count, so a mislabelled row is a false
--     positive there forever.
--   * `other` never trips that check, by construction.
--   * In three months the descriptions on the `other` rows are evidence. Promote
--     the one that recurs into its own kind then, with a reason.
--
-- The description is required at the APPLICATION layer, not by a CHECK
-- constraint: a NOT NULL on description would apply to the two existing kinds
-- too, and 080 deliberately made it optional there because "Contacts Export
-- $1,548.47" is already self-describing. An `other` line without a note is
-- useless, so the UI and the connector both insist on one.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable. No data change.
begin;

alter table public.project_costs
  drop constraint if exists project_costs_kind_chk;

alter table public.project_costs
  add constraint project_costs_kind_chk
  check (kind in ('sms_email_blast', 'contacts_export', 'other'));

comment on column public.project_costs.kind is
  'What sort of flat cost this is. contacts_export = what it cost to ACQUIRE contacts. sms_email_blast = a FIXED platform charge that does not scale with messages (the per-message cost lives on the blast and is already in spend — putting it here charges it twice, which happened on PR00362 for $1,876.70). other = anything else, and its description is required by the app because the kind alone says nothing. Adding a fourth kind means changing this constraint AND lib/hooks/useProjectCosts.ts COST_KINDS, which the UI and the connector both read.';

-- The label function drives the audit trail (080's audit_project_cost renders
-- through it), so a new kind that is not here shows up in the history as its raw
-- slug.
create or replace function public.cost_kind_label(k text) returns text
language sql immutable as $$
  select case k
    when 'sms_email_blast' then 'SMS/Email Blast'
    when 'contacts_export' then 'Contacts Export'
    when 'other'           then 'Other'
    else coalesce(k, '—') end
$$;

commit;

-- Verify:
--   insert into project_costs (project_id, kind, amount)
--     values ('<a real project id>', 'other', 1) returning id;
--   -- then delete it. Before this migration that insert violates the CHECK.
