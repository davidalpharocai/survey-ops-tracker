-- 104: the ZoomInfo contact rate, as configuration rather than a magic number.
--
-- David: "currently the default cost for audience pulled from zoominfo is $0.07
-- per contact. so the total audience used cost would be (unique) audience used x
-- $0.07. the cost should not be multiplied against the total available audience."
--
-- The second sentence is the whole point and is enforced by which column the
-- arithmetic reads: audience_used, NEVER audience_size. 094 split those two
-- deliberately — total available is what the team handed us, used is what we
-- actually pulled — and only the second one costs money. 44 projects currently
-- carry a total available and would each be overcharged by the difference.
--
-- WHY THIS IS A SUGGESTION AND NOT AN AUTOMATIC SPEND TERM.
--
-- The tempting version adds `audience_used × rate` straight into
-- recompute_project_spend. That would be wrong here, and measurably so:
--
--   * PR00402 already carries a hand-entered contacts_export line of $1,548.47,
--     described "ZoomInfo contact download — 22,121 contacts @ $0.07". Its
--     audience_used is not set yet. The moment anyone backfills it to 22,121 —
--     which is the correct value — an automatic term would add a SECOND
--     $1,548.47 to a project whose spend is already right. That is the
--     095/PR00362 double count, pre-loaded and waiting for a data backfill.
--   * Today exactly 1 of 390 projects has audience_used recorded, so an
--     automatic term would also be inert while carrying that risk.
--
-- So the rate lives here, the app offers the line, and a human or the connector
-- creates it as a real, visible, editable project_costs row. Spend stays a sum
-- of recorded facts rather than a mix of records and derivations — which is what
-- makes it reconcilable at all.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable. Sets one value.
begin;

alter table public.app_config
  add column if not exists zoominfo_cost_per_contact numeric(10,4) not null default 0.07;

comment on column public.app_config.zoominfo_cost_per_contact is
  'Default $ per contact for audience pulled from ZoomInfo (0.07 as of 2026-09). Multiplied by survey_projects.audience_used — the contacts actually pulled — and NEVER by audience_size, which is the total the team had available and costs nothing until it is used. Drives a SUGGESTED contacts_export cost line; it is not a term in recompute_project_spend, so changing it never silently re-prices a project whose cost is already recorded.';

-- Existing row keeps whatever the default gave it; state it explicitly so a
-- re-run after a manual change does not look like it did nothing.
update public.app_config
   set zoominfo_cost_per_contact = 0.07
 where zoominfo_cost_per_contact is null;

commit;

-- Verify:
--   select zoominfo_cost_per_contact, blast_cost_per_send from public.app_config;
--   -> 0.0700 | 0.02
