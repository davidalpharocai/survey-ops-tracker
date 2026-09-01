-- 094: "Audience Size" becomes a PAIR -- Total Available, and Used.
--
-- WHY THIS EXISTS
--
-- audience_size has meant two different things to different people, and the data
-- proves it. David settled the definition on 2026-08-31: it is HOW MANY CONTACTS
-- THE TEAM HAS HANDED US -- an internal supply figure. The tooltip in
-- NSegmentsEditor said the opposite ("total size of the panel or population being
-- surveyed"), i.e. a market estimate, so the box has been collecting both
-- readings and nobody could tell which reading any given number was.
--
-- Evidence that one column cannot carry the meaning:
--
--   * PR00309 holds audience_size 31,545 while its blast reach sums to 95,788.
--     The two blasts dated 2026-08-13 sum to EXACTLY 31,545, and the pairs on
--     08-15 and 08-17 repeat over the same list. Three passes, one pool. So blast
--     reach is SEND VOLUME and can never stand in for "how much of the audience
--     we have used" -- which kills the tempting shortcut of deriving `used` as
--     sum(project_blasts.people).
--   * PR00260: pool 9,000, reach 11,105 across three shrinking waves. Same story.
--   * Four projects carry n_collected ABOVE audience_size -- PR00054 (17 vs 99),
--     PR00075 (14 vs 120), PR00060 (1 vs 178), PR00101 (50 vs 442). Arithmetically
--     impossible for a pool, so the number in the box is something else entirely.
--     PR00101 and PR00182 hold values equal to their own n_target, which is what
--     it looks like when someone reads the label as "the target".
--
-- `used` is therefore not derivable, and needs its own column. That is this file.
--
-- WHAT THIS DOES
--
--   audience_size  -- SAME column, no rename. Relabelled in the UI to
--                     "Total Available Audience Size": what the team handed over.
--   audience_used  -- NEW, nullable: how many of those contacts we have drawn on.
--
-- The column keeps its name because ~15 readers name it (connector reports, CSV
-- export, merge, quick-edit, clone, the gen-pop floor) and a rename buys nothing
-- the label change does not already deliver. 078 made the same call for n_target.
--
-- REMAINING (= total - used) is DERIVED in the app and stored nowhere. It is the
-- figure that actually answers send-again vs buy-more-contacts; a third stored
-- column would just be a third number to disagree with the other two.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- No `used <= total` CHECK or trigger. 078 added exactly that guard for the
-- n_target/n_target_max pair, and its own comments record what it cost: because
-- every editor in this app saves ONE FIELD PER SAVE, a cross-column rule has no
-- safe field order -- raising `used` first fails, lowering `total` first fails --
-- so 078 had to impose an app-wide "always PATCH both columns in one object"
-- contract on every write path. The audience pair is edited by those same
-- one-field-at-a-time NumberCells, and unlike the two ends of an N range these
-- two numbers arrive WEEKS APART: the team hands over a list, and the sends
-- happen later. A hard guard would turn the normal order of work into an error.
-- Violations are reported by data_health instead (lib/mcp/health.ts), which is
-- where the four impossible rows above have to surface anyway.
--
-- No backfill. NULL means "never recorded", which is the truth for all 354 rows,
-- and is exactly the distinction 091 had to restore for blast figures after
-- `default 0` made an unrecorded blast indistinguishable from a free one.
-- Writing zeros here would assert we know the list is untouched.
--
-- No rollup into sync_segment_totals. Audience has never rolled up (078 spells
-- out why: once a project is split, the parent audience string is not even
-- rendered), and summing audience_used across segments would double-count any
-- segments drawing on the SAME list -- the precise error that produced PR00309's
-- 95,788.
--
-- No signature change to mcp_add_segment. It takes positional parameters, so
-- extra audience arguments would CREATE AN OVERLOAD beside the old function
-- rather than replace it, leaving two callable versions. Step 6 teaches
-- mcp_update_segment all three audience keys instead, which also closes a
-- pre-existing gap worth naming: the segment RPCs could not set `audience` or
-- `audience_size` AT ALL, so the connector could add a segment it was then unable
-- to describe.
--
-- APPLY ORDER -- THIS SQL GOES IN FIRST. Same hazard 078 documented at length:
-- PostgREST fails the ENTIRE request when an explicit select list names a column
-- that does not exist, and BASE_SELECT in lib/mcp/reports.ts is about to name
-- audience_used. Run this before the code ships, or every connector report 400s.
-- (audience_size is not in SLIM_PROJECT_COLUMNS, so the board and the list are
-- not exposed either way -- checked.)
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable. Reversible by
-- re-running 088's audit_survey_project, 078's mcp_write_project and 084's
-- mcp_update_segment, then dropping the two columns.
begin;

-- 1) The new column, on both tables. Nullable with no default -- see "no
--    backfill" above. project_segments needs it because 10 segments already carry
--    an audience_size, so the pair has to exist at both levels or a split project
--    could record a pool with no way to say how much of it was spent.
alter table public.survey_projects
  add column if not exists audience_used integer;

alter table public.project_segments
  add column if not exists audience_used integer;

-- 2) Write the definition into the DATABASE, not just the tooltip. The whole
--    cause of this migration was two readings of one label, and a column comment
--    is the one place the meaning cannot drift away from the column itself.
comment on column public.survey_projects.audience_size is
  'Total Available Audience Size: how many contacts the team has handed us for this project. An internal supply figure, NOT a market or panel estimate.';
comment on column public.survey_projects.audience_used is
  'Audience Size Used: how many of those contacts we have actually drawn on. NULL = never recorded. NOT derivable from project_blasts.people, which counts repeat sends over the same list.';
comment on column public.project_segments.audience_size is
  'Total Available Audience Size for this segment. See survey_projects.audience_size.';
comment on column public.project_segments.audience_used is
  'Audience Size Used for this segment. See survey_projects.audience_used.';

-- 3) The one invariant worth putting in the table: a count of contacts cannot be
--    negative. SINGLE-COLUMN on purpose, so it can never wedge an unrelated edit
--    to the same row -- the failure mode 078's two-column guard walked into.
--    Verified before writing this file: zero rows on either table currently hold
--    a negative audience_size, so the constraint on the EXISTING column adds
--    cleanly rather than failing the migration.
--    Guarded by name rather than `if not exists` (which ALTER TABLE ... ADD
--    CONSTRAINT does not support) to keep the file re-runnable.
do $chk$
begin
  if not exists (select 1 from pg_constraint where conname = 'survey_projects_audience_used_chk') then
    alter table public.survey_projects add constraint survey_projects_audience_used_chk
      check (audience_used is null or audience_used >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'survey_projects_audience_size_chk') then
    alter table public.survey_projects add constraint survey_projects_audience_size_chk
      check (audience_size is null or audience_size >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'project_segments_audience_used_chk') then
    alter table public.project_segments add constraint project_segments_audience_used_chk
      check (audience_used is null or audience_used >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'project_segments_audience_size_chk') then
    alter table public.project_segments add constraint project_segments_audience_size_chk
      check (audience_size is null or audience_size >= 0);
  end if;
end $chk$;

-- 4) Audit the new column, so "how much of the list did we burn" has a history.
--
--    088's audit_survey_project() VERBATIM with one line added beside the
--    existing audience_size line. Extracted from 088 programmatically rather than
--    retyped (scripts/_gen094.py) -- the discipline 087 and 088 both used,
--    because `create or replace` cannot patch a single statement inside a
--    function body and a hand-copied 110-line function is a drift waiting to
--    happen.
--
--    Note for the next person: this function still audits voter_survey_qa and
--    citation_language_needed. 090 retired their TRIGGER, not their columns, so
--    those two lines are dead but harmless. Left alone deliberately -- removing
--    them belongs in whichever migration finally drops the columns.

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
  perform audit_field(NEW.id, 'audience_size', OLD.audience_size::text, NEW.audience_size::text, actor);
  perform audit_field(NEW.id, 'audience_used', OLD.audience_used::text, NEW.audience_used::text, actor);
  perform audit_field(NEW.id, 'budget', OLD.budget::text, NEW.budget::text, actor);
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

  return NEW;
end $$;

-- 5) The connector write path. Same verbatim-splice treatment: 078's
--    mcp_write_project with one audience_used line beside audience_size.

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

-- 6) mcp_update_segment gains the whole audience trio.
--
--    084's version with three lines added. `audience` and `audience_size` are NEW
--    here, not just audience_used: the segment RPCs have never been able to write
--    either one, which meant a connector-created segment could carry an N but
--    never say who it was for. Found while adding audience_used, and fixed here
--    rather than filed, because shipping a segment that can record how much of a
--    list it spent while unable to name the list would be the same bug again.

create or replace function public.mcp_update_segment(p_segment uuid, p_patch jsonb, p_actor text)
returns public.project_segments language plpgsql security definer set search_path = public as $$
declare r public.project_segments;
begin
  perform set_config('app.actor', p_actor, true);
  update project_segments set
    label       = case when p_patch ? 'label'       then p_patch->>'label' else label end,
    n_target    = case when p_patch ? 'n_target'    then nullif(p_patch->>'n_target','')::int else n_target end,
    n_target_max = case when p_patch ? 'n_target_max' then nullif(p_patch->>'n_target_max','')::int else n_target_max end,
    n_collected = case when p_patch ? 'n_collected' then coalesce(nullif(p_patch->>'n_collected','')::int, 0) else n_collected end,
    n_actual    = case when p_patch ? 'n_actual'    then nullif(p_patch->>'n_actual','')::int else n_actual end,
    audience    = case when p_patch ? 'audience'    then p_patch->>'audience' else audience end,
    audience_size = case when p_patch ? 'audience_size' then nullif(p_patch->>'audience_size','')::int else audience_size end,
    audience_used = case when p_patch ? 'audience_used' then nullif(p_patch->>'audience_used','')::int else audience_used end,
    note        = case when p_patch ? 'note'        then p_patch->>'note' else note end
  where id = p_segment
  returning * into r;
  if not found then raise exception 'Segment not found'; end if;
  return r;
end $$;

commit;
