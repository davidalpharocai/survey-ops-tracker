-- 088: audit the rerun wiring, so adding or removing a survey from a series
--      leaves a trace.
--
-- WHY THIS EXISTS
--
-- David asked for the ability to add and remove a survey from a series. Before
-- building it, the fields that operation writes need to be auditable, because
-- right now they are not audited at all.
--
-- audit_survey_project() logs 30 scalar columns. None of them is series_id,
-- rerun_series_id, rerun_number, wave_order or rerun_date. That was found while
-- tracing why BAM's PR00388 had fallen out of its foodservice series: the change
-- history for the WHOLE database contained exactly one series_id row, the manual
-- repair added on 2026-08-27. "No history entry" therefore did not mean "nothing
-- changed" -- it meant nothing had ever been recorded, which is the worst state
-- for an audit log to be in, because its silence reads as evidence.
--
-- A rarely-edited unaudited field is a latent problem. A field the UI now edits
-- routinely is an active one, which is why this lands BEFORE the feature.
--
-- WHAT IS IN HERE
--
-- 078's audit_survey_project() verbatim, plus five fields:
--   * rerun_series       -- series_id, resolved to the series NAME
--   * rerun_lineage_root -- rerun_series_id, resolved to the root wave's PR code
--   * rerun_number       -- wave position, recomputed for every wave on any change
--   * wave_order         -- the manual drag order, when one has been set
--   * rerun_date         -- the scheduled next-wave date
--
-- The two uuid columns are resolved to names rather than logged raw, following
-- the captain_id -> name precedent already in this function. A uuid in a history
-- panel tells the reader nothing, and being able to read these later is the only
-- reason they exist. It also makes the series_id / rerun_series_id distinction
-- visible at a glance -- seeing "PR00025" rather than a uuid is what stops the
-- next person conflating a lineage pointer with a series link, which is the
-- specific confusion that produced the PR00388 bug.
--
-- Both lookups sit behind `is distinct from` guards, so a no-op UPDATE writes
-- nothing and the subqueries only run when the value actually moved. This trigger
-- fires on every write to survey_projects, so an unconditional subquery per
-- column would be a real cost on a hot path.
--
-- WHAT IS NOT IN HERE
--
-- The add/remove operation itself. It lives in lib/reruns/seriesOps.ts beside
-- createSeriesFromProject and reorderWaves, because the wave-numbering rule it
-- has to honour (renumberWaves in lib/reruns/series.ts) is genuinely subtle --
-- manual wave_order wins over dates when any wave has one, the date key falls
-- back submitted -> launch -> deliver -> created, and the origin is forced to
-- Wave 1 when no manual order exists. Reimplementing that in SQL would create a
-- second definition of the rule and guarantee the two drift. Nothing about the
-- operation needs new grants: it runs server-side on the admin client, like every
-- other series write.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable, and reversible
-- by re-running 078's copy of the function.
begin;

-- 078's audit_survey_project() VERBATIM, with the 088 block spliced in before
-- `return NEW;` and four locals added to the declare list. Extracted from 078
-- programmatically rather than retyped, so nothing else can have drifted -- the
-- same discipline 087 used, and for the same reason: `create or replace` cannot
-- patch a single statement inside a function body.
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
-- The trigger itself is unchanged and does not need re-creating: it already
-- points at this function name, and `create or replace function` swaps the body
-- underneath it. Restated here only so the next reader does not go looking for a
-- missing `create trigger`.

commit;
