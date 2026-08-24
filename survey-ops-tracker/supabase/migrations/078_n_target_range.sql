-- 078: N Target becomes a RANGE (min..max) instead of one number.
--
-- We keep `n_target` AS THE MINIMUM and add `n_target_max` beside it, on both
-- survey_projects and project_segments. Deliberate: ~25 existing readers of
-- n_target (board, list, pace, gen-pop floor, connector, sheet write-back, the
-- merge RPC) keep working unchanged and their meaning becomes "the minimum",
-- which is the conservative reading — the gen-pop N floor warning (056) should
-- fire on the number we're promising at worst, not on the optimistic top end.
-- So: no rename of n_target, and NO n_target_min column.
--
-- NOT touched on purpose: `n_internal_target` (our cushion — still one number
-- on both tables) and `project_launches.target` (a per-wave goal, still one
-- number). Those are internal planning figures, not the agreed client range.
--
-- BEFORE RUNNING: nothing. Migrations 001–077 must already be applied (this
-- rebuilds sync_segment_totals() from 062, audit_survey_project() from 069, and
-- mcp_write_project / mcp_add_segment / mcp_update_segment from 057, so those
-- must all be the live versions). The whole file is re-runnable.
--
-- APPLY ORDER — THIS SQL MUST GO IN BEFORE ANY CODE NAMING n_target_max SHIPS.
-- Unlike 079, this migration is NOT dark-ship tolerant. 079 only adds a TABLE,
-- and a missing table is swallowed by lib/auth/capabilities.ts; a missing
-- COLUMN is fatal, because PostgREST fails the ENTIRE request when an explicit
-- select list names a column that does not exist. So the moment n_target_max
-- lands in SLIM_PROJECT_COLUMNS (lib/hooks/useProjects.ts — that one array
-- feeds BOTH the board and the list), in either explicit select in
-- lib/mcp/data.ts, or in BASE_SELECT in lib/mcp/reports.ts, those surfaces plus
-- the connector and the CSV export all 400 until this file has been applied. A
-- write is no safer than a read: a PATCH body naming a missing column fails the
-- same way.
--   The alternative, if the code side has to ship first: read n_target_max ONLY
--   through the `*` selects — the project detail page and useProjectSegments
--   already select `*`, so they are safe either way — and do NOT add it to
--   SLIM_PROJECT_COLUMNS, to lib/mcp/data.ts's lists, or to
--   lib/mcp/reports.ts's BASE_SELECT until the SQL is in.
--
-- Apply by hand in the Supabase SQL editor (David). Wrapped in an explicit
-- transaction so that if any statement fails, the temporary trigger DISABLEs in
-- step 2 roll back with everything else — the table can never be left with its
-- delivered-status coupling switched off.
--
-- Statement order matters and is not cosmetic:
--   1) ALTER (add the columns)
--   2) BACKFILL (max := min) — must happen BEFORE step 5 rebuilds the audit
--      function, or every project gets a bogus "n_target_max: — → N" row in its
--      Logs tab and the 150-row MasterAuditLog gets flushed clean.
--   3) the min ≤ max guard
--   4) the segment rollup
--   5) the audit function
--   6) the connector write RPCs
begin;

-- 1) The new column. Nullable with no default: NULL means "no upper end agreed",
--    i.e. the single-number case we have today. App code must therefore treat a
--    null max as "same as the min" when it renders a range.
alter table public.survey_projects
  add column if not exists n_target_max integer;

alter table public.project_segments
  add column if not exists n_target_max integer;

-- 2) Backfill: every existing target becomes a degenerate range (max = min), so
--    "1,000" keeps reading as 1,000 rather than as an open-ended 1,000+.
--
--    survey_projects carries UNCONDITIONAL BEFORE UPDATE triggers that would
--    otherwise treat this bookkeeping write as a real edit:
--      · survey_projects_delivered_status (064/069) forces status := 'Closed'
--        for ANY row sitting in the Delivery column. 064's own backfill
--        deliberately skipped Hold-in-Delivery rows and left them for a human to
--        judge; a blanket update here would quietly close every one of them.
--      · survey_projects_delivered_at (048) stamps delivered_at.
--      · survey_projects_updated_at (002) is an unconditional BEFORE UPDATE
--        `new.updated_at = now()`, so it would stamp today on all ~150 rows and
--        destroy "when did this project last ACTUALLY change". Two things read
--        that number and would both be wrong afterwards: the `sheet_stale`
--        advisory in lib/mcp/health.ts compares sheet_synced_at < updated_at, so
--        every already-synced project would suddenly report its sheet copy
--        behind; and expected_updated_at — threaded from update_project in
--        lib/mcp/registry.ts through runProjectWrite in lib/mcp/writes.ts as an
--        optimistic-concurrency token — would reject any assistant confirmation
--        prepared before this migration with "changed since you looked".
--    project_segments_sync (039/062) would cascade into survey_projects and
--    re-roll the segment sums, clobbering any deliberate top-level N override
--    (the project page explicitly allows one: "a direct edit here stays until
--    the next segment change rolls up").
--    So disable exactly those four for the two backfill statements — the same
--    precedent 061 set for trg_audit_project_supplier. The audit trigger stays
--    ON: it is an AFTER UPDATE and, because step 5 has not run yet, it does not
--    know n_target_max exists, so it sees no changed field and writes nothing.
--
--    Not disabled because they cannot fire here: captain_assignment_stamp (019,
--    keys off captain_id), survey_projects_fielding_launch_date (072) and
--    survey_projects_stage_history (062) (both are `of board_column`).
alter table public.survey_projects  disable trigger survey_projects_delivered_status;
alter table public.survey_projects  disable trigger survey_projects_delivered_at;
alter table public.survey_projects  disable trigger survey_projects_updated_at;
alter table public.project_segments disable trigger project_segments_sync;

update public.survey_projects
   set n_target_max = n_target
 where n_target is not null and n_target_max is null;

update public.project_segments
   set n_target_max = n_target
 where n_target is not null and n_target_max is null;

alter table public.project_segments enable  trigger project_segments_sync;
alter table public.survey_projects  enable  trigger survey_projects_updated_at;
alter table public.survey_projects  enable  trigger survey_projects_delivered_at;
alter table public.survey_projects  enable  trigger survey_projects_delivered_status;

-- 3) Guard the invariant in the DATABASE, not the app. Both columns are written
--    straight from the browser over PostgREST (useUpdateProject, QuickEdit,
--    NumberCell) and from app/api/parse-project/route.ts, which parses free text
--    into n_target — there is no RPC chokepoint to validate in, so the table is
--    the only honest place for the rule.
--
--    A trigger rather than a CHECK constraint, for three reasons:
--      a) it can say WHICH numbers clashed, and PostgREST passes the message
--         through to the toast; a CHECK just names the constraint;
--      b) it is scoped to writes that actually touch the pair, so a row someone
--         hand-fixes in SQL can never brick every unrelated edit to that row;
--      c) it can be switched off around a migration backfill (see step 2) the
--         way 061 does — a CHECK cannot be selectively bypassed.
--
--    It RAISES rather than silently clamping: these are numbers we've agreed
--    with a client, so a typo ("max 100, min 1000") must come back to the person
--    typing it, not be quietly rewritten into a range nobody signed off on.
--
--    THE APP-SIDE CONTRACT that raising imposes, which nothing down here can
--    enforce: any surface that edits EITHER end must PATCH BOTH COLUMNS IN ONE
--    OBJECT — a single update({ n_target, n_target_max }) — so the guard only
--    ever sees a consistent pair. Every write path today sends a PARTIAL patch
--    (useUpdateProject takes `updates: ProjectUpdate`, useUpdateSegment takes
--    `Partial<SegmentInput>`, and the inline cell editors save ONE field per
--    save), and one field at a time has NO safe field order: widening 100..200
--    to 1000..2000 raises if the min goes first, narrowing it back raises if the
--    max goes first. app/api/parse-project/route.ts has the same exposure the
--    moment it parses both ends instead of just n_target — it must assemble the
--    pair and send it together, not field by field.
--
--    One function, two triggers — the column pair is named identically on both
--    tables.
--    OLD is only read inside the TG_OP = 'UPDATE' branch (never alongside the
--    INSERT test in one expression) — plpgsql doesn't promise to short-circuit a
--    boolean, so touching OLD on an INSERT is asking for trouble.
create or replace function public.enforce_n_target_range()
returns trigger language plpgsql set search_path = public as $$
begin
  if (TG_OP = 'UPDATE') then
    -- Untouched pair: let the write through. This is what keeps a row that was
    -- hand-repaired in SQL from blocking every later edit to its other fields.
    if (NEW.n_target, NEW.n_target_max) is not distinct from (OLD.n_target, OLD.n_target_max) then
      return NEW;
    end if;
  end if;

  if NEW.n_target is not null and NEW.n_target_max is not null
     and NEW.n_target_max < NEW.n_target
  then
    raise exception 'N Target max (%) cannot be below N Target min (%)',
      NEW.n_target_max, NEW.n_target;
  end if;
  return NEW;
end $$;

drop trigger if exists survey_projects_n_target_range on public.survey_projects;
create trigger survey_projects_n_target_range
  before insert or update on public.survey_projects
  for each row execute function public.enforce_n_target_range();

drop trigger if exists project_segments_n_target_range on public.project_segments;
create trigger project_segments_n_target_range
  before insert or update on public.project_segments
  for each row execute function public.enforce_n_target_range();

-- 4) Segment rollup (062's body) now also sums the max onto the parent project.
--
--    Null-max handling: a segment whose max is null has ONE agreed number, so it
--    contributes that number to both ends — hence sum(coalesce(max, min)). But
--    if NO segment has a max, the project shouldn't sprout a fake range either,
--    so the whole total stays null until at least one segment has one. Same
--    shape as 039's n_actual rule.
--
--    FIX while we're in here (pre-existing, 039 → 062): the "last segment
--    removed" branch only reset segment_count and left the rolled-up n_* totals
--    behind. Carrying n_target / n_internal_target / n_collected / n_actual over
--    is intentional and stays — the project reverts to manual single-N mode and
--    those numbers are its starting point (the connector tells the user exactly
--    that: "the project reverts to a single N"); blanking them would throw away
--    the project's N. What was genuinely stale is the ROLLUP-ONLY state: with no
--    segments there is no summed range any more, so clear n_target_max and let
--    n_target stand alone as the single number. That also guarantees the pair
--    left behind can never violate the step-3 guard.
create or replace function public.sync_segment_totals() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
  cnt int;
begin
  pid := coalesce(new.project_id, old.project_id);
  select count(*) into cnt from public.project_segments where project_id = pid;
  if cnt > 0 then
    update public.survey_projects s set
      segment_count     = cnt,
      n_target          = (select sum(n_target) from public.project_segments where project_id = pid),
      n_target_max      = (select case when count(n_target_max) > 0
                                      then sum(coalesce(n_target_max, n_target)) end
                             from public.project_segments where project_id = pid),
      n_internal_target = (select sum(n_internal_target) from public.project_segments where project_id = pid),
      n_collected       = (select coalesce(sum(coalesce(n_collected,0)),0) from public.project_segments where project_id = pid),
      n_actual          = (select case when count(n_actual) > 0 then sum(n_actual) end from public.project_segments where project_id = pid)
    where s.id = pid;
  else
    update public.survey_projects s set segment_count = 0, n_target_max = null where s.id = pid;
  end if;
  return null;
end $$;

-- 5) Field-change audit: 069's hand-listed body verbatim plus ONE line for
--    n_target_max, next to n_target so the Logs tab reads min-then-max.
--    Hand-listed on purpose — 046 briefly made this a generic jsonb_object_keys
--    loop, but 068 and then 069 rebuilt it hand-listed from 028, and the highest
--    migration wins, so the explicit list is what is live. Do not "improve" it
--    back into a loop: the list is also the definition of which fields are worth
--    logging (captain is resolved to a name, delivered_at/segment_count are
--    intentionally absent).
create or replace function public.audit_survey_project()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor text := coalesce(nullif(auth.email(), ''), 'system');
  old_cap text;
  new_cap text;
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

  return NEW;
end $$;

-- 6) The DB-side connector / in-app-assistant write RPCs: 057's bodies verbatim
--    plus the one n_target_max arm each. 057 is the highest-numbered definition
--    of all three, so its hand-listed columns are what is live — same discipline
--    as step 5, and do not "improve" anything else in these bodies.
--
--    This is not optional polish. Each of these resolves a column as
--    `case when p_patch ? 'col' then ... else col end`, and a jsonb patch key
--    that no case-arm mentions is NEVER READ. Without the arm, n_target_max
--    would be silently DROPPED from every connector and assistant write:
--    update_project returns success, project_audit logs nothing (the value never
--    changed), and the person who agreed a max with the client believes it was
--    saved. Losing a number agreed with a client quietly is worse than an
--    error — the same reasoning step 3 raises on.
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

--    mcp_add_segment needs somewhere to get the value from, so it gains
--    p_target_max — added LAST with a default so runAddSegment's named-arg call
--    (which already omits p_sort) keeps working untouched. Drop the old 7-arg
--    signature first so the 8-arg-with-default isn't ambiguous with a lingering
--    7-arg version, exactly as 070 did for mcp_create_project; the grants have
--    to be re-issued afterwards because the drop takes them with it.
drop function if exists public.mcp_add_segment(uuid, text, text, int, int, int, int);
create or replace function public.mcp_add_segment(
  p_project uuid, p_label text, p_actor text,
  p_target int default null, p_collected int default null,
  p_actual int default null, p_sort int default null,
  p_target_max int default null
) returns public.project_segments language plpgsql security definer set search_path = public as $$
declare r public.project_segments;
begin
  perform set_config('app.actor', p_actor, true);
  if not exists (select 1 from survey_projects where id = p_project and deleted_at is null) then
    raise exception 'Project not found';
  end if;
  insert into project_segments (project_id, label, n_target, n_target_max, n_collected, n_actual, sort_order)
  values (
    p_project, p_label, p_target, p_target_max, coalesce(p_collected, 0), p_actual,
    coalesce(p_sort, (select coalesce(max(sort_order) + 1, 0) from project_segments where project_id = p_project))
  ) returning * into r;
  return r;
end $$;

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
    n_actual    = case when p_patch ? 'n_actual'    then nullif(p_patch->>'n_actual','')::int else n_actual end
  where id = p_segment
  returning * into r;
  if not found then raise exception 'Segment not found'; end if;
  return r;
end $$;

revoke all on function public.mcp_add_segment(uuid, text, text, int, int, int, int, int) from public, anon, authenticated;
grant execute on function public.mcp_add_segment(uuid, text, text, int, int, int, int, int) to service_role;

commit;
