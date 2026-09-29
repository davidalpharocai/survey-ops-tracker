-- 128: the Study Questions Review gate, and the date a study was greenlit.
-- 2026-09-29. RUN 127 FIRST, IN A SEPARATE EXECUTION (see the note at its top).
--
-- Two columns:
--
--   stage_questions_approved  the rung. false = the questionnaire is still
--                             going back and forth with the client.
--   greenlit_at               the date that rung was cleared — David's "Study
--                             Greenlit".
--
-- WHY greenlit_at IS A NEW COLUMN AND NOT A REDEFINED submitted_date. David
-- asked whether submitted_date could simply be renamed to mean this. It cannot,
-- because submitted_date is read in ~25 non-test places and three of them would
-- change their answers silently rather than loudly:
--
--   * lib/insights/model.ts — cycle time is submitted -> delivered. This is the
--     one we WANT to change, and it is handled below.
--   * lib/finance/hub.ts finDate() — falls back
--     deliver_date || launch_date || submitted_date. Moving submitted_date
--     forward slides any study with no deliver or launch date into a later
--     month, quietly restating finance history.
--   * lib/reruns/renumberLineage.ts — waves are SORTED by
--     submitted_date ?? launch_date ?? deliver_date ?? created_at and numbered
--     from that order. A series holding some waves under the old meaning and
--     some under the new could RENUMBER ITSELF. Wave numbers are on
--     deliverables that have already gone to clients.
--
-- A new column leaves all three reading exactly what they read yesterday.
--
-- WHY greenlit_at IS NOT BACKFILLED. We do not know when the questions were
-- approved for work that predates this stage — only when it was submitted.
-- Writing submitted_date into greenlit_at would manufacture a fact and make
-- every historical study look as though it had been measured under the new
-- definition. It is left null, and the code reads
-- `greenlit_at ?? submitted_date`, so every number computed before today stays
-- identical to the number it was. The changeover is marked on the cycle-time
-- chart instead, because a trend line that crosses it is genuinely comparing
-- two definitions and should say so rather than average them.
--
-- WHY stage_questions_approved IS BACKFILLED TO true, AND WHY THAT IS NOT THE
-- SAME KIND OF CLAIM. It asserts only that the questionnaire for a study
-- already in Doc Programming (or Fielding, or delivered) is settled, which is
-- true by construction. It is also load-bearing: deriveCurrentStage is a ladder
-- whose floor this change moves, so without this UPDATE every existing project
-- reads as Study Questions Review and the whole board falls back one column.

alter table public.survey_projects
  add column if not exists stage_questions_approved boolean default false,
  add column if not exists greenlit_at date;

comment on column public.survey_projects.greenlit_at is
  'Date the client approved the questionnaire (David''s "Study Greenlit"). Null for studies that predate migration 128; readers fall back to submitted_date.';

-- Everything that exists today is past this gate. Must run before the default
-- below starts creating rows that are legitimately false.
--
-- DO NOT MOVE THIS BELOW THE TRIGGER AT THE END OF THIS FILE. The ordering is
-- load-bearing: the trigger stamps greenlit_at whenever this flag becomes true,
-- so running it after would write today's date onto all ~400 historical
-- studies and claim every one of them was greenlit on the day the migration
-- ran. Here, with no trigger yet, the backfill sets the flag and leaves
-- greenlit_at null — which is the honest answer, and the one cycleStartOf's
-- fallback is written against.
update public.survey_projects
   set stage_questions_approved = true
 where stage_questions_approved is distinct from true;

-- New work arrives at the questions gate, not past it. David, 2026-09-29:
-- "only once the survey questions are approved do i consider it submitted."
alter table public.survey_projects
  alter column board_column set default 'Study Questions Review';

-- The connector creates projects too, and it passes its own fallback rather
-- than letting the column default apply. Both doors have to open on the same
-- room or MCP-created and app-created studies start in different places.
create or replace function public.mcp_create_project(p_patch jsonb, p_actor text)
returns public.survey_projects language plpgsql security definer set search_path = public as $$
declare r public.survey_projects;
begin
  perform set_config('app.actor', p_actor, true);
  insert into survey_projects (project_name, client, project_type, captain_id, salesperson, due_date, n_target, phase, board_column, scoping_stage, submitted_date)
  values (
    p_patch->>'project_name',
    p_patch->>'client',
    nullif(p_patch->>'project_type','')::project_type,
    nullif(p_patch->>'captain_id','')::uuid,
    p_patch->>'salesperson',
    nullif(p_patch->>'due_date','')::date,
    nullif(p_patch->>'n_target','')::int,
    coalesce(nullif(p_patch->>'phase','')::project_phase, 'Scoping'),
    coalesce(nullif(p_patch->>'board_column','')::board_column, 'Study Questions Review'),
    case when (p_patch->>'phase') = 'Active' then null else coalesce(nullif(p_patch->>'scoping_stage','')::scoping_stage, 'New Inquiry') end,
    nullif(p_patch->>'submitted_date','')::date
  ) returning * into r;
  return r;
end $$;

-- greenlit_at is stamped where the gate is actually cleared, not in the app.
--
-- Four code paths move a study between stages — the board drag, the pipeline
-- spine, useMoveProjectToColumn, and the connector's advance_project via
-- stageColumnsFor — and a fifth is David running UPDATE by hand. Setting the
-- date in the app would mean four copies of one rule, which is the shape that
-- produced the getCheckboxesForColumn bug this file's neighbours document. A
-- trigger is the single definition all five pass through.
--
-- Only ever fills a NULL, so an explicitly supplied date always wins and a
-- study cannot be re-greenlit by bouncing back and forth across the gate.
--
-- Uses bare current_date, matching every other migration here. Worth knowing:
-- that is the server's date (UTC), so a study approved late in a New York
-- evening stamps the following day. The alternative would be the only
-- timezone-aware call in the schema, and a one-day edge on a date used for
-- cycle-time medians is the smaller of the two problems.
create or replace function public.set_greenlit_at()
returns trigger language plpgsql as $$
begin
  if NEW.stage_questions_approved is true
     and NEW.greenlit_at is null
     and (TG_OP = 'INSERT' or OLD.stage_questions_approved is distinct from true)
  then
    NEW.greenlit_at := current_date;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_set_greenlit_at on public.survey_projects;
create trigger trg_set_greenlit_at
  before insert or update on public.survey_projects
  for each row execute function public.set_greenlit_at();
