-- 098: repair the projects whose board_column and stage flags contradict.
--
-- WHY
--
-- getCheckboxesForColumn (lib/utils/stage.ts) was the inverse of
-- deriveCurrentStage and disagreed with it by one stage for every column except
-- Submitted: asking for the flags of "Fielding" returned the flags that mean
-- "EdWin QA". Its docstring asserted "the destination stage itself is NOT
-- checked", which is the opposite of what deriveCurrentStage, fifteen lines
-- above it, has always said. Nothing composed the two until 2026-09-02.
--
-- Three write paths route through it -- the board drag (app/(app)/page.tsx),
-- useMoveProjectToColumn, and the connector's advance_project via
-- stageColumnsFor -- and every one of them ALSO writes board_column explicitly.
-- So the bug never showed as a wrong column. It showed as a row that disagreed
-- with itself: the card sat in Fielding while the stage spine read EdWin QA, and
-- the next spine click re-derived from the flags and pulled the card backwards.
-- David reported it as "when i move a survey back to fielding, it goes to
-- EdwinQA instead and only then can i move it to fielding".
--
-- The code fix ships separately. This repairs the rows already written.
--
-- WHICH FIELD WINS: board_column. A human chose it -- dragged the card, or told
-- the connector to move the project -- while the flags were computed for them by
-- the broken function. So the flags are recomputed FROM board_column, not the
-- other way round. Doing it the other way would move ten cards on the board to
-- wherever the bug had left their flags.
--
-- WHAT IT TOUCHES (measured 2026-09-02, 10 of 360 live rows):
--     PR00199, PR00200, PR00285, PR00297   Delivery,        flags say Data QA
--     PR00310, PR00311, PR00368            Doc Programming, flags say Submitted
--     PR00362, PR00388                     Fielding,        flags say EdWin QA
--     PR00300                              Fielding,        flags say Submitted
--
-- The first nine are off by exactly one stage -- this bug's signature. PR00300
-- is off by FOUR and is therefore NOT this bug: it is the archived guide-demo
-- project (ZZ Guide Demo Co), whose rows are written by the screenshot pipeline.
-- It is repaired by the same rule because the rule is "make the row agree with
-- itself", which is right regardless of how it got that way, but it is called
-- out here so nobody reads its inclusion as evidence of scope.
--
-- Derived in SQL from board_column rather than hardcoding those ten codes, so it
-- cannot be wrong about which rows need what, and so re-running it is a no-op.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable.
begin;

-- Three triggers on survey_projects would treat this bookkeeping write as a real
-- edit. Same precedent, and the same reasoning, as 078's backfill:
--
--   * survey_projects_updated_at (002) is an unconditional BEFORE UPDATE
--     `updated_at = now()`. Stamping today on these rows would destroy "when did
--     this project last actually change" and would invalidate any assistant
--     confirmation already prepared against the old value (update_project's
--     expected_updated_at rejects a stale token).
--   * survey_projects_delivered_status (064/069) forces status := 'Closed' for
--     ANY row sitting in the Delivery column. All four Delivery rows here are
--     already Closed so it would be a no-op today, but 064 deliberately left
--     Hold-in-Delivery rows for a human to judge and this must not quietly close
--     one that appears later.
--   * survey_projects_delivered_at (048) stamps delivered_at, which would
--     rewrite real delivery dates on the four Delivery rows.
--
-- NOT disabled: survey_projects_stage_history (062) and
-- survey_projects_fielding_launch_date (072) are both `of board_column`, and
-- this statement does not touch board_column. The audit trigger stays on and is
-- harmless: audit_survey_project logs 30 scalar columns and the six stage_*
-- flags are not among them, so it records nothing here. That does mean this
-- repair leaves no trace in any project's Logs tab -- this file is the record.
alter table public.survey_projects disable trigger survey_projects_updated_at;
alter table public.survey_projects disable trigger survey_projects_delivered_status;
alter table public.survey_projects disable trigger survey_projects_delivered_at;

with target as (
  select
    id,
    case board_column
      when 'Submitted'          then 0
      when 'Doc Programming'    then 1
      when 'Survey Programming' then 2
      when 'EdWin QA'           then 3
      when 'Fielding'           then 4
      when 'Data QA'            then 5
      when 'Delivery'           then 6
    end as i
  from public.survey_projects
  where deleted_at is null
)
update public.survey_projects p set
  -- The corrected contract: a flag means the stage has been REACHED, so being in
  -- column i requires every flag up to and including i to be true. Mirrors the
  -- fixed getCheckboxesForColumn exactly (>=, not >).
  stage_doc_programming    = (t.i >= 1),
  stage_survey_programming = (t.i >= 2),
  stage_edwin_qa           = (t.i >= 3),
  stage_fielding           = (t.i >= 4),
  stage_data_qa            = (t.i >= 5),
  stage_delivery           = (t.i >= 6)
from target t
where t.id = p.id
  -- A scoping column maps to null and is left alone: those rows are not on the
  -- pipeline and their stage flags are deliberately whatever they were before
  -- promotion (see the board's "Demote" branch, which keeps them so a
  -- re-promotion resumes intact).
  and t.i is not null
  -- Only rows that actually disagree, so a re-run touches nothing.
  and (
    p.stage_doc_programming, p.stage_survey_programming, p.stage_edwin_qa,
    p.stage_fielding, p.stage_data_qa, p.stage_delivery
  ) is distinct from (
    (t.i >= 1), (t.i >= 2), (t.i >= 3), (t.i >= 4), (t.i >= 5), (t.i >= 6)
  );

alter table public.survey_projects enable trigger survey_projects_delivered_at;
alter table public.survey_projects enable trigger survey_projects_delivered_status;
alter table public.survey_projects enable trigger survey_projects_updated_at;

commit;

-- VERIFY: this should return zero rows. Any row it returns is a project still
-- disagreeing with itself.
--
--   select project_code, board_column,
--          stage_doc_programming, stage_survey_programming, stage_edwin_qa,
--          stage_fielding, stage_data_qa, stage_delivery
--     from public.survey_projects
--    where deleted_at is null
--      and board_column in ('Submitted','Doc Programming','Survey Programming',
--                           'EdWin QA','Fielding','Data QA','Delivery')
--      and (stage_doc_programming, stage_survey_programming, stage_edwin_qa,
--           stage_fielding, stage_data_qa, stage_delivery)
--          is distinct from (
--            (case board_column when 'Submitted' then 0 when 'Doc Programming' then 1
--                 when 'Survey Programming' then 2 when 'EdWin QA' then 3
--                 when 'Fielding' then 4 when 'Data QA' then 5 else 6 end) >= 1,
--            (case board_column when 'Submitted' then 0 when 'Doc Programming' then 1
--                 when 'Survey Programming' then 2 when 'EdWin QA' then 3
--                 when 'Fielding' then 4 when 'Data QA' then 5 else 6 end) >= 2,
--            (case board_column when 'Submitted' then 0 when 'Doc Programming' then 1
--                 when 'Survey Programming' then 2 when 'EdWin QA' then 3
--                 when 'Fielding' then 4 when 'Data QA' then 5 else 6 end) >= 3,
--            (case board_column when 'Submitted' then 0 when 'Doc Programming' then 1
--                 when 'Survey Programming' then 2 when 'EdWin QA' then 3
--                 when 'Fielding' then 4 when 'Data QA' then 5 else 6 end) >= 4,
--            (case board_column when 'Submitted' then 0 when 'Doc Programming' then 1
--                 when 'Survey Programming' then 2 when 'EdWin QA' then 3
--                 when 'Fielding' then 4 when 'Data QA' then 5 else 6 end) >= 5,
--            (case board_column when 'Submitted' then 0 when 'Doc Programming' then 1
--                 when 'Survey Programming' then 2 when 'EdWin QA' then 3
--                 when 'Fielding' then 4 when 'Data QA' then 5 else 6 end) >= 6);
--
-- A data_health check would be better than a comment, and is worth adding when
-- the money-formula consolidation lands -- the same "one fact, two
-- implementations" family of problem.
