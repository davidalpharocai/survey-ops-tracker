-- 117: where a delivered respondent came from, and which route paid for a cost line.
--
-- David, 2026-09-18: "i want to understand the split for N we delivered (N actual)
-- for PR00425 between PS and B2B ... once we know the split, note in SOCC, and then
-- be more granular about the CPQR. ideally theres a way to track this for surveys
-- where N collected was done via blasts and launches and it can feed into the
-- financials build + the CPQR analysis."
--
-- THE HOLE THIS FILLS
-- -------------------
-- A survey collects respondents exactly two ways: B2B blasts and PureSpectrum
-- launches. Both lib/finance/cpqr.ts and routeCosts() in lib/finance/hub.ts open
-- with the same line:
--
--   if (route !== 'blast' && route !== 'panel') continue
--
-- so a survey that used BOTH routes contributes to neither rate. In production
-- that is 7 surveys, every one of them delivered, carrying $32,878.54 of spend
-- and 2,554 delivered respondents -- about 13% of costed delivered spend and 7%
-- of delivered N, absent from the only per-respondent cost figure we publish.
--
-- Spend is already attributable: blast rows carry bid x completes and people x
-- $/send, supplier rows carry cpi x collected. TWO things are not, and this
-- migration adds exactly those two.
--
-- 1. WHICH ROUTE DELIVERED THE RESPONDENT (n_actual_panel / n_actual_blast)
-- ------------------------------------------------------------------------
-- n_collected splits itself, because the blast and supplier rows ARE the
-- collection record. n_actual does not: it is one post-QA number handed back by
-- the data team, and nothing in the schema says how much of it came from where.
--
-- On PR00425 the answer is 236 PureSpectrum and 16 B2B out of 252, measured by
-- joining the client deliverable's transaction_id column to the deliverable-level
-- QA workbook, which carries survey_id per respondent for all 1,020 collected.
-- The two survey instances mint structurally disjoint ids -- PureSpectrum 22-char
-- base62, B2B 12-char lowercase hex -- and the shape agrees with survey_id on
-- 1,020 of 1,020 rows. That split is the difference between a blended $53.63 per
-- delivered respondent and the truth, which is $8.84 on panel and $714.25 on
-- blast: an 81x spread the single number hides completely.
--
-- WHY NOT project_segments, which already has label/n_collected/n_actual/note.
-- Two reasons, and the first is fatal. sync_segment_totals() (078) OVERWRITES the
-- parent's n_target with sum(segments.n_target), and sum() over all-NULL is NULL
-- in Postgres -- so adding "PureSpectrum"/"B2B" segments without targets would
-- silently wipe PR00425's agreed N target of 250, and inventing a per-route
-- target to avoid that would be recording a number nobody agreed. Second, route
-- and audience are ORTHOGONAL: PR00426 already splits into 5 countries, and a
-- survey that is both segmented and mixed-route cannot express both in one table.
--
-- 2. WHICH ROUTE A FLAT COST LINE BELONGS TO (project_costs.route)
-- ---------------------------------------------------------------
-- This is not a nicety, it is the thing that decides whether the split is worth
-- having. PR00425 carries an $8,697.85 ZoomInfo contacts_export -- 64% of the
-- survey's entire cost -- and project_costs has no route column, so a per-route
-- CPQR that cannot place it reports the blast side at $170.63 instead of $714.25.
-- Four times too cheap, on the one survey the feature exists to price.
--
-- The attribution here is measured, not assumed: 124,255 contacts purchased
-- equals 124,255 total sends across the survey's 11 blasts, exactly. Every
-- contact bought was blasted once.
--
-- A NULL route still means "unattributed", and lib/finance keeps it out of both
-- rates and shows it as an explicit unrouted remainder rather than spreading it
-- pro rata. Pro rata would be 63% wrong here (it would put 5.9 of the 16 B2B
-- respondents' cost on the panel side).
--
-- 3. HOW THE SPLIT WAS ARRIVED AT (n_actual_split_method)
-- ------------------------------------------------------
-- 'measured'  -- every delivered respondent traced to its source instance.
-- 'derived'   -- follows necessarily from rows we already hold. PR00230's 1,328
--                delivered consumers are 100% panel because all 13 of its blasts
--                name Managers or Employees and no consumer blast exists.
-- 'estimated' -- a judgement. STORED, so the knowledge is not lost, and
--                structurally refused by every rate in lib/finance.
--
-- Without this the backfill of the other six surveys has to choose between
-- refusing an honest inference and laundering a guess into a published number.
--
-- DARK-SHIP
-- ---------
-- Every column is nullable with no default and nothing reads it until it is set,
-- so the app is correct before and after this is applied. lib/finance treats an
-- absent split exactly as it treats today's mixed survey: excluded, and counted
-- in the coverage line.

begin;

-- ---------------------------------------------------------------------------
-- 1) The delivered-N split, on survey_projects.
-- ---------------------------------------------------------------------------
alter table public.survey_projects
  add column if not exists n_actual_panel        integer,
  add column if not exists n_actual_blast        integer,
  add column if not exists n_actual_split_method text;

comment on column public.survey_projects.n_actual_panel is
  'Of n_actual, how many delivered respondents came from PureSpectrum launches. NULL = not established.';
comment on column public.survey_projects.n_actual_blast is
  'Of n_actual, how many delivered respondents came from B2B blasts. NULL = not established.';
comment on column public.survey_projects.n_actual_split_method is
  'How the split was arrived at: measured | derived | estimated. estimated never enters a published rate.';

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'survey_projects_split_method_ck') then
    alter table public.survey_projects add constraint survey_projects_split_method_ck
      check (n_actual_split_method is null
             or n_actual_split_method in ('measured', 'derived', 'estimated'));
  end if;

  -- Negative respondents are not a thing, and a stray minus sign would sail
  -- straight into a divisor.
  if not exists (select 1 from pg_constraint where conname = 'survey_projects_split_nonneg_ck') then
    alter table public.survey_projects add constraint survey_projects_split_nonneg_ck
      check (coalesce(n_actual_panel, 0) >= 0 and coalesce(n_actual_blast, 0) >= 0);
  end if;
end $c$;

-- DELIBERATELY NOT A CONSTRAINT: "panel + blast = n_actual".
--
-- It is the right invariant and the wrong place for it. n_actual moves on its own
-- (the data team revises it, sync_segment_totals recomputes it from segments),
-- and a table constraint would make an unrelated, correct edit to n_actual fail
-- with a check violation the editor cannot act on. So the invariant is enforced
-- where it can be explained instead: reconcile_project reports the disagreement,
-- and lib/finance refuses to price a split that does not sum -- failing closed to
-- today's behaviour rather than onto a number that has moved.

-- ---------------------------------------------------------------------------
-- 2) Which route a flat cost line belongs to.
-- ---------------------------------------------------------------------------
alter table public.project_costs
  add column if not exists route text;

comment on column public.project_costs.route is
  'Which fielding route this cost bought: blast | panel. NULL = unattributed; lib/finance keeps it out of both rates and shows it as an unrouted remainder.';

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_costs_route_ck') then
    alter table public.project_costs add constraint project_costs_route_ck
      check (route is null or route in ('blast', 'panel'));
  end if;
end $c$;

-- ---------------------------------------------------------------------------
-- 3) The connector write path.
--
--    mcp_write_project hand-lists every column it will accept, and a key its
--    body does not name is DROPPED SILENTLY -- the UPDATE runs, the row comes
--    back, update_project reports ok with a client-side diff, and the column
--    never moves. So widening PROJECT_WRITE_FIELDS in TypeScript without this is
--    a connector that cheerfully reports success and writes nothing.
--
--    094's body verbatim (the highest-numbered definition, therefore live) with
--    three lines added after n_actual. Extracted from the file programmatically
--    rather than retyped, the discipline 087/088/094/100 all used: create-or-
--    replace cannot patch one statement inside a body, so the whole body is
--    restated, and a transcription slip here would silently un-write a column
--    that has worked for months.
-- ---------------------------------------------------------------------------
create or replace function public.mcp_write_project(
  p_id uuid, p_patch jsonb, p_actor text, p_expected_updated_at timestamptz default null
) returns public.survey_projects language plpgsql security definer set search_path = public as $$
declare r public.survey_projects;
begin
  perform set_config('app.actor', p_actor, true);
  select * into r from survey_projects where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Project not found'; end if;
  if p_expected_updated_at is not null and r.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_write: project changed since preview';
  end if;

  update survey_projects set
    project_name       = case when p_patch ? 'project_name'       then p_patch->>'project_name' else project_name end,
    client             = case when p_patch ? 'client'             then p_patch->>'client' else client end,
    project_type       = case when p_patch ? 'project_type'       then (p_patch->>'project_type')::project_type else project_type end,
    captain_id         = case when p_patch ? 'captain_id'         then nullif(p_patch->>'captain_id','')::uuid else captain_id end,
    co_captain_ids     = case when p_patch ? 'co_captain_ids'     then coalesce((select array_agg(x)::uuid[] from jsonb_array_elements_text(p_patch->'co_captain_ids') x), '{}'::uuid[]) else co_captain_ids end,
    salesperson        = case when p_patch ? 'salesperson'        then p_patch->>'salesperson' else salesperson end,
    priority           = case when p_patch ? 'priority'           then p_patch->>'priority' else priority end,
    blocked_by         = case when p_patch ? 'blocked_by'         then p_patch->>'blocked_by' else blocked_by end,
    status             = case when p_patch ? 'status'             then (p_patch->>'status')::project_status else status end,
    phase              = case when p_patch ? 'phase'              then (p_patch->>'phase')::project_phase else phase end,
    scoping_stage      = case when p_patch ? 'scoping_stage'      then (p_patch->>'scoping_stage')::scoping_stage else scoping_stage end,
    board_column       = case when p_patch ? 'board_column'       then (p_patch->>'board_column')::board_column else board_column end,
    stage_doc_programming    = case when p_patch ? 'stage_doc_programming'    then (p_patch->>'stage_doc_programming')::boolean else stage_doc_programming end,
    stage_survey_programming = case when p_patch ? 'stage_survey_programming' then (p_patch->>'stage_survey_programming')::boolean else stage_survey_programming end,
    stage_edwin_qa           = case when p_patch ? 'stage_edwin_qa'           then (p_patch->>'stage_edwin_qa')::boolean else stage_edwin_qa end,
    stage_fielding           = case when p_patch ? 'stage_fielding'           then (p_patch->>'stage_fielding')::boolean else stage_fielding end,
    stage_data_qa            = case when p_patch ? 'stage_data_qa'            then (p_patch->>'stage_data_qa')::boolean else stage_data_qa end,
    stage_delivery           = case when p_patch ? 'stage_delivery'           then (p_patch->>'stage_delivery')::boolean else stage_delivery end,
    submitted_date     = case when p_patch ? 'submitted_date'     then nullif(p_patch->>'submitted_date','')::date else submitted_date end,
    launch_date        = case when p_patch ? 'launch_date'        then nullif(p_patch->>'launch_date','')::date else launch_date end,
    due_date           = case when p_patch ? 'due_date'           then nullif(p_patch->>'due_date','')::date else due_date end,
    deliver_date       = case when p_patch ? 'deliver_date'       then nullif(p_patch->>'deliver_date','')::date else deliver_date end,
    rerun_date         = case when p_patch ? 'rerun_date'         then nullif(p_patch->>'rerun_date','')::date else rerun_date end,
    n_target           = case when p_patch ? 'n_target'           then nullif(p_patch->>'n_target','')::int else n_target end,
    n_target_max       = case when p_patch ? 'n_target_max'       then nullif(p_patch->>'n_target_max','')::int else n_target_max end,
    n_collected        = case when p_patch ? 'n_collected'        then nullif(p_patch->>'n_collected','')::int else n_collected end,
    n_actual           = case when p_patch ? 'n_actual'           then nullif(p_patch->>'n_actual','')::int else n_actual end,
    -- 117: the delivered-N split by fielding route. Two integers and the
    -- provenance of how they were arrived at; lib/finance refuses to price on
    -- anything but 'measured' or 'derived'.
    n_actual_panel     = case when p_patch ? 'n_actual_panel'     then nullif(p_patch->>'n_actual_panel','')::int else n_actual_panel end,
    n_actual_blast     = case when p_patch ? 'n_actual_blast'     then nullif(p_patch->>'n_actual_blast','')::int else n_actual_blast end,
    n_actual_split_method = case when p_patch ? 'n_actual_split_method' then nullif(p_patch->>'n_actual_split_method','') else n_actual_split_method end,
    n_internal_target  = case when p_patch ? 'n_internal_target'  then nullif(p_patch->>'n_internal_target','')::int else n_internal_target end,
    audience_size      = case when p_patch ? 'audience_size'      then nullif(p_patch->>'audience_size','')::int else audience_size end,
    audience_used      = case when p_patch ? 'audience_used'      then nullif(p_patch->>'audience_used','')::int else audience_used end,
    budget             = case when p_patch ? 'budget'             then nullif(p_patch->>'budget','')::numeric else budget end,
    longitudinal       = case when p_patch ? 'longitudinal'       then (p_patch->>'longitudinal')::boolean else longitudinal end,
    voter_survey_qa    = case when p_patch ? 'voter_survey_qa'    then (p_patch->>'voter_survey_qa')::boolean else voter_survey_qa end,
    citation_language_needed = case when p_patch ? 'citation_language_needed' then (p_patch->>'citation_language_needed')::boolean else citation_language_needed end,
    row_level_data     = case when p_patch ? 'row_level_data'     then (p_patch->>'row_level_data')::boolean else row_level_data end,
    terminations       = case when p_patch ? 'terminations'       then (p_patch->>'terminations')::boolean else terminations end,
    survey_tool_id     = case when p_patch ? 'survey_tool_id'     then p_patch->>'survey_tool_id' else survey_tool_id end,
    slack_channel_url  = case when p_patch ? 'slack_channel_url'  then p_patch->>'slack_channel_url' else slack_channel_url end,
    -- NEW in 057:
    audience           = case when p_patch ? 'audience'           then p_patch->>'audience' else audience end,
    category           = case when p_patch ? 'category'           then p_patch->>'category' else category end,
    objective          = case when p_patch ? 'objective'          then p_patch->>'objective' else objective end,
    sprint_number      = case when p_patch ? 'sprint_number'      then nullif(p_patch->>'sprint_number','')::int else sprint_number end,
    n_floor_override        = case when p_patch ? 'n_floor_override'        then (p_patch->>'n_floor_override')::boolean else n_floor_override end,
    n_floor_override_reason = case when p_patch ? 'n_floor_override_reason' then p_patch->>'n_floor_override_reason' else n_floor_override_reason end,
    compliance_override= case when p_patch ? 'compliance_override' then (p_patch->>'compliance_override')::boolean else compliance_override end,
    requested_by_contact_id = case when p_patch ? 'requested_by_contact_id' then nullif(p_patch->>'requested_by_contact_id','')::uuid else requested_by_contact_id end,
    requested_by_name  = case when p_patch ? 'requested_by_name'  then p_patch->>'requested_by_name' else requested_by_name end,
    latest_next_steps  = case when p_patch ? 'latest_next_steps'  then p_patch->>'latest_next_steps' else latest_next_steps end,
    linked_documents   = case when p_patch ? 'linked_documents'   then (select array_agg(x) from jsonb_array_elements_text(p_patch->'linked_documents') x) else linked_documents end
  where id = p_id
  returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- 4) The audit trigger, so a changed split shows up in the Logs tab and can be
--    undone. 100's body verbatim plus three audit_field calls beside n_actual.
--    Without this the columns move with no trace and undo_last_change has no row
--    to find even once UNDOABLE_FIELDS names them.
-- ---------------------------------------------------------------------------
create or replace function public.audit_survey_project()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor text := coalesce(nullif(auth.email(), ''), 'system');
  old_cap text;
  new_cap text;
  old_series text;
  new_series text;
  old_root text;
  new_root text;
  old_term text;
  new_term text;
begin
  perform audit_field(NEW.id, 'project_name', OLD.project_name, NEW.project_name, actor);
  perform audit_field(NEW.id, 'client', OLD.client, NEW.client, actor);
  perform audit_field(NEW.id, 'project_type', OLD.project_type::text, NEW.project_type::text, actor);
  perform audit_field(NEW.id, 'status', OLD.status::text, NEW.status::text, actor);
  perform audit_field(NEW.id, 'phase', OLD.phase::text, NEW.phase::text, actor);
  perform audit_field(NEW.id, 'scoping_stage', OLD.scoping_stage::text, NEW.scoping_stage::text, actor);
  perform audit_field(NEW.id, 'board_column', OLD.board_column::text, NEW.board_column::text, actor);
  perform audit_field(NEW.id, 'salesperson', OLD.salesperson, NEW.salesperson, actor);
  perform audit_field(NEW.id, 'priority', OLD.priority, NEW.priority, actor);
  perform audit_field(NEW.id, 'blocked_by', OLD.blocked_by, NEW.blocked_by, actor);
  perform audit_field(NEW.id, 'submitted_date', OLD.submitted_date::text, NEW.submitted_date::text, actor);
  perform audit_field(NEW.id, 'launch_date', OLD.launch_date::text, NEW.launch_date::text, actor);
  perform audit_field(NEW.id, 'due_date', OLD.due_date::text, NEW.due_date::text, actor);
  perform audit_field(NEW.id, 'deliver_date', OLD.deliver_date::text, NEW.deliver_date::text, actor);
  perform audit_field(NEW.id, 'n_target', OLD.n_target::text, NEW.n_target::text, actor);
  perform audit_field(NEW.id, 'n_target_max', OLD.n_target_max::text, NEW.n_target_max::text, actor);
  perform audit_field(NEW.id, 'n_collected', OLD.n_collected::text, NEW.n_collected::text, actor);
  perform audit_field(NEW.id, 'n_actual', OLD.n_actual::text, NEW.n_actual::text, actor);
  -- 117: the route split travels with n_actual, so the Logs tab explains a
  -- moved CPQR the same way it explains a moved N.
  perform audit_field(NEW.id, 'n_actual_panel', OLD.n_actual_panel::text, NEW.n_actual_panel::text, actor);
  perform audit_field(NEW.id, 'n_actual_blast', OLD.n_actual_blast::text, NEW.n_actual_blast::text, actor);
  perform audit_field(NEW.id, 'n_actual_split_method', OLD.n_actual_split_method, NEW.n_actual_split_method, actor);
  perform audit_field(NEW.id, 'audience_size', OLD.audience_size::text, NEW.audience_size::text, actor);
  perform audit_field(NEW.id, 'audience_used', OLD.audience_used::text, NEW.audience_used::text, actor);
  perform audit_field(NEW.id, 'budget', OLD.budget::text, NEW.budget::text, actor);
  perform audit_field(NEW.id, 'credits', OLD.credits::text, NEW.credits::text, actor);
  perform audit_field(NEW.id, 'actual_spend', OLD.actual_spend::text, NEW.actual_spend::text, actor);
  perform audit_field(NEW.id, 'longitudinal', OLD.longitudinal::text, NEW.longitudinal::text, actor);
  perform audit_field(NEW.id, 'voter_survey_qa', OLD.voter_survey_qa::text, NEW.voter_survey_qa::text, actor);
  perform audit_field(NEW.id, 'citation_language_needed', OLD.citation_language_needed::text, NEW.citation_language_needed::text, actor);
  perform audit_field(NEW.id, 'row_level_data', OLD.row_level_data::text, NEW.row_level_data::text, actor);
  perform audit_field(NEW.id, 'terminations', OLD.terminations::text, NEW.terminations::text, actor);
  perform audit_field(NEW.id, 'occam', OLD.occam::text, NEW.occam::text, actor);
  perform audit_field(NEW.id, 'cancel_reason', OLD.cancel_reason, NEW.cancel_reason, actor);
  perform audit_field(NEW.id, 'survey_tool_id', OLD.survey_tool_id, NEW.survey_tool_id, actor);
  perform audit_field(NEW.id, 'slack_channel_url', OLD.slack_channel_url, NEW.slack_channel_url, actor);
  perform audit_field(NEW.id, 'latest_next_steps', OLD.latest_next_steps, NEW.latest_next_steps, actor);

  if OLD.captain_id is distinct from NEW.captain_id then
    select name into old_cap from public.team_members where id = OLD.captain_id;
    select name into new_cap from public.team_members where id = NEW.captain_id;
    perform audit_field(NEW.id, 'captain', coalesce(old_cap, '—'), coalesce(new_cap, '—'), actor);
  end if;


  -- 088: THE RERUN WIRING, which was audited nowhere at all.
  --
  -- Until now this trigger logged 30 scalar columns and not one of the fields
  -- that decide whether a survey belongs to a series. The consequence was
  -- discovered the hard way while tracing BAM's PR00388: its series link had been
  -- dropped by a merge, and the change history for the entire database contained
  -- exactly ONE series_id row -- the repair inserted by hand afterwards. So
  -- "there is no history entry" did not mean "nothing changed"; it meant nothing
  -- was ever recorded. That is the worst possible state for an audit log, because
  -- it reads as evidence.
  --
  -- Now that a survey can be added to and removed from a series from the UI, this
  -- stops being a gap in a rarely-touched field and becomes a gap in a routine
  -- one.
  --
  -- series_id and rerun_series_id are RESOLVED TO NAMES rather than logged as
  -- UUIDs, following the captain_id -> name precedent immediately above: a raw
  -- uuid in a history panel tells a reader nothing, and the whole point of these
  -- rows is that a person reads them later. The uuid is still recoverable from
  -- the row it points at; the name is what makes the entry legible.
  --
  -- Guarded by `is distinct from` so a no-op UPDATE writes nothing, and so the
  -- lookups only run when the value actually moved -- these fire on every write
  -- to survey_projects, so an unconditional subquery per column would be a real
  -- cost on the hot path.
  if OLD.series_id is distinct from NEW.series_id then
    select survey_name into old_series from public.rerun_series where id = OLD.series_id;
    select survey_name into new_series from public.rerun_series where id = NEW.series_id;
    perform audit_field(NEW.id, 'rerun_series',
      coalesce(old_series, case when OLD.series_id is null then 'none' else 'unknown series' end),
      coalesce(new_series, case when NEW.series_id is null then 'none' else 'unknown series' end),
      actor);
  end if;

  -- The LEGACY lineage pointer. Not the same thing as series_id and repeatedly
  -- mistaken for it: it holds the FIRST WAVE'S PROJECT ID, not a series id. It is
  -- what the project page's wave list and app/api/projects/link-rerun/route.ts
  -- read, while the client page groups on series_id alone -- which is how a
  -- survey can look grouped on one screen and loose on the other. Resolved to the
  -- root wave's project code for exactly that reason: seeing "PR00025" makes the
  -- distinction obvious in a way a uuid never would.
  if OLD.rerun_series_id is distinct from NEW.rerun_series_id then
    select project_code into old_root from public.survey_projects where id = OLD.rerun_series_id;
    select project_code into new_root from public.survey_projects where id = NEW.rerun_series_id;
    perform audit_field(NEW.id, 'rerun_lineage_root',
      coalesce(old_root, case when OLD.rerun_series_id is null then 'none' else 'unknown' end),
      coalesce(new_root, case when NEW.rerun_series_id is null then 'none' else 'unknown' end),
      actor);
  end if;

  -- Wave position. rerun_number is recomputed for EVERY wave whenever one is
  -- added, removed or dragged (renumberWaves in lib/reruns/series.ts), so these
  -- rows are how you later explain why a survey's wave number moved without
  -- anyone editing it directly.
  perform audit_field(NEW.id, 'rerun_number', OLD.rerun_number::text, NEW.rerun_number::text, actor);
  perform audit_field(NEW.id, 'wave_order', OLD.wave_order::text, NEW.wave_order::text, actor);
  perform audit_field(NEW.id, 'rerun_date', OLD.rerun_date::text, NEW.rerun_date::text, actor);

  -- 100: which credit pool this survey draws against. Resolved to the term's
  -- NAME rather than logged raw, following the captain_id and series_id
  -- precedent above: a uuid in the Logs tab is unreadable, and being able to
  -- read it later is the whole point of recording it. Behind an `is distinct
  -- from` guard so a no-op UPDATE writes nothing and the subquery only runs when
  -- the value actually moved — this trigger fires on every write to the table.
  if OLD.term_id is distinct from NEW.term_id then
    select name into old_term from public.client_terms where id = OLD.term_id;
    select name into new_term from public.client_terms where id = NEW.term_id;
    perform audit_field(NEW.id, 'term', coalesce(old_term, '—'), coalesce(new_term, '—'), actor);
  end if;

  return NEW;
end $$;

-- ---------------------------------------------------------------------------
-- 5) add_cost learns to say which route it bought for.
--
--    THE OVERLOAD TRAP, same as 115. mcp_log_cost takes positional arguments and
--    is CALLED with named ones (lib/mcp/writes.ts:550). Adding p_route creates a
--    SECOND function rather than replacing the first, and a named-argument call
--    against two candidates fails with "function is not unique" -- which is the
--    connector breaking in production, not here. So the old signature is dropped
--    by catalogue lookup rather than by a hand-typed type list: if that list is
--    off by one the drop silently misses and both versions survive.
--
--    AND THE ACL TRAP (095/096). DROP + CREATE resets a function's grants to
--    EXECUTE TO PUBLIC -- which is how anon got execute on a write RPC in
--    September. The revoke/grant below is mandatory, not tidiness, and the verify
--    block at the end proves it took.
-- ---------------------------------------------------------------------------
do $drop$
declare f record;
begin
  for f in
    select format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'mcp_log_cost'
  loop
    raise notice 'dropping %', f.sig;
    execute 'drop function ' || f.sig;
  end loop;
end $drop$;

create or replace function public.mcp_log_cost(
  p_project uuid, p_kind text, p_amount numeric, p_quantity int,
  p_description text, p_incurred_on date, p_created_by text,
  p_idem text, p_actor text, p_route text default null
) returns public.project_costs language plpgsql security definer set search_path = public as $$
declare r public.project_costs;
begin
  perform set_config('app.actor', p_actor, true);
  if not exists (select 1 from survey_projects where id = p_project and deleted_at is null) then
    raise exception 'Project not found';
  end if;

  if p_amount is null then
    raise exception 'A cost line needs an amount. Pass the total in dollars; use mcp_update_cost to change one that is already recorded.';
  end if;

  -- Checked here as well as by the table constraint, so the caller gets a
  -- sentence rather than a constraint name.
  if p_route is not null and p_route not in ('blast', 'panel') then
    raise exception 'route must be blast or panel (got %)', p_route;
  end if;

  insert into project_costs (project_id, kind, amount, quantity, description, incurred_on, created_by, idem_key, route)
    values (p_project, p_kind, coalesce(p_amount, 0), p_quantity, p_description, p_incurred_on, p_created_by, p_idem, p_route)
  on conflict (project_id, idem_key) where idem_key is not null do update
    -- coalesce on the way in, so a retry that omits a field LEAVES the recorded
    -- value alone rather than blanking it. Same rule as mcp_log_blast: use
    -- mcp_update_cost to un-record something on purpose.
    set kind        = coalesce(excluded.kind, project_costs.kind),
        amount      = coalesce(excluded.amount, project_costs.amount),
        quantity    = coalesce(excluded.quantity, project_costs.quantity),
        description = coalesce(excluded.description, project_costs.description),
        incurred_on = coalesce(excluded.incurred_on, project_costs.incurred_on),
        route       = coalesce(excluded.route, project_costs.route)
  returning * into r;
  return r;
end $$;

revoke execute on function
  public.mcp_log_cost(uuid, text, numeric, int, text, date, text, text, text, text)
  from public, anon, authenticated;
grant execute on function
  public.mcp_log_cost(uuid, text, numeric, int, text, date, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6) update_cost can set or clear a route. Patch-shaped, so an omitted key does
--    not change it and an explicit null un-records it -- the same three-way
--    distinction update_blast makes between omit, set and clear.
--
--    create-or-replace is correct here: the signature is unchanged, so the grants
--    survive and there is no overload to trip over.
-- ---------------------------------------------------------------------------
create or replace function public.mcp_update_cost(p_cost uuid, p_patch jsonb, p_actor text)
returns public.project_costs language plpgsql security definer set search_path = public as $$
declare r public.project_costs;
begin
  perform set_config('app.actor', p_actor, true);
  if p_patch ? 'route' and nullif(p_patch->>'route', '') is not null
     and p_patch->>'route' not in ('blast', 'panel') then
    raise exception 'route must be blast or panel (got %)', p_patch->>'route';
  end if;
  update project_costs set
    kind        = case when p_patch ? 'kind'        then p_patch->>'kind' else kind end,
    amount      = case when p_patch ? 'amount'      then coalesce(nullif(p_patch->>'amount','')::numeric, 0) else amount end,
    -- quantity CAN be un-recorded (set back to null) on purpose: a line first
    -- entered as unit x qty may turn out to be a flat fee.
    quantity    = case when p_patch ? 'quantity'    then nullif(p_patch->>'quantity','')::int else quantity end,
    description = case when p_patch ? 'description' then p_patch->>'description' else description end,
    incurred_on = case when p_patch ? 'incurred_on' then nullif(p_patch->>'incurred_on','')::date else incurred_on end,
    route       = case when p_patch ? 'route'       then nullif(p_patch->>'route','') else route end
  where id = p_cost
  returning * into r;
  if not found then raise exception 'Cost line not found'; end if;
  return r;
end $$;

revoke execute on function public.mcp_update_cost(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.mcp_update_cost(uuid, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- VERIFY, inside the transaction, so a failure rolls the whole thing back.
-- ---------------------------------------------------------------------------
do $verify$
declare
  n int;
  f record;
  body text;
begin
  -- The columns exist and carry their constraints.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'survey_projects'
     and column_name in ('n_actual_panel', 'n_actual_blast', 'n_actual_split_method');
  if n <> 3 then raise exception 'expected 3 new survey_projects columns, found %', n; end if;

  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'project_costs' and column_name = 'route';
  if n <> 1 then raise exception 'project_costs.route missing'; end if;

  select count(*) into n from pg_constraint
   where conname in ('survey_projects_split_method_ck', 'survey_projects_split_nonneg_ck', 'project_costs_route_ck');
  if n <> 3 then raise exception 'expected 3 new check constraints, found %', n; end if;

  -- The write path actually NAMES the new columns. This is the failure that is
  -- otherwise silent: a patch key the body does not mention is dropped and the
  -- tool still reports success.
  body := pg_get_functiondef('public.mcp_write_project(uuid,jsonb,text,timestamptz)'::regprocedure);
  if body not like '%n_actual_panel%' then
    raise exception 'mcp_write_project does not name n_actual_panel -- the splice missed';
  end if;
  if body not like '%n_actual_blast%' then
    raise exception 'mcp_write_project does not name n_actual_blast -- the splice missed';
  end if;
  if body not like '%n_actual_split_method%' then
    raise exception 'mcp_write_project does not name n_actual_split_method -- the splice missed';
  end if;

  -- The splice did not COST anything either. 094's body assigned 49
  -- columns; the spliced one must assign exactly three more. A retyped body that
  -- quietly lost a line would pass every other check in this block.
  n := (select count(*) from regexp_matches(body, 'case when p_patch \?', 'g'));
  if n <> 52 then
    raise exception 'mcp_write_project sets % columns, expected 52 -- the splice dropped or duplicated one', n;
  end if;

  -- Same for the audit trigger.
  if pg_get_functiondef('public.audit_survey_project()'::regprocedure) not like '%n_actual_split_method%' then
    raise exception 'audit_survey_project does not audit the split';
  end if;

  -- Exactly one mcp_log_cost. Two all-defaulted overloads is 115's failure and it
  -- surfaces as "function is not unique" at the first named-argument call.
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mcp_log_cost';
  if n <> 1 then raise exception 'mcp_log_cost: expected exactly 1 overload, found %', n; end if;

  -- And it must not have come back from the DROP with PUBLIC execute.
  for f in
    select p.oid, p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('mcp_log_cost', 'mcp_update_cost', 'mcp_write_project')
  loop
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
end $verify$;

commit;

-- mcp_log_cost changed SHAPE, not just body, so PostgREST's cached schema would
-- otherwise answer "Could not find the function public.mcp_log_cost(...)" to the
-- next add_cost call. Supabase reloads on DDL by itself; asking costs nothing.
notify pgrst, 'reload schema';

-- VERIFY, after applying. The block above already asserted all of it and would
-- have rolled back, so these are for reading rather than for trusting:
--
--   select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'mcp_log_cost';
--   -- one row, ending in ", text)" for p_route.
--
--   select column_name, data_type from information_schema.columns
--    where table_name = 'survey_projects' and column_name like 'n_actual%';
--
--   -- and the anon probe from 096, which must say 42501 and not 22P02:
--   curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/mcp_log_cost" \
--     -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
--     -H "Content-Type: application/json" -d '{"p_project":"not-a-uuid"}'
