-- 124: one model for rerun lineage. Backfill `series_id` from the older
-- project-to-project links, 2026-09-28.
--
-- THE PROBLEM, measured live 2026-09-28. Two columns describe the same idea and
-- have drifted:
--
--   survey_projects.series_id        -> a rerun_series row (the cadence model,
--                                       migration 073). 86 surveys.
--   survey_projects.rerun_series_id  -> the ROOT PROJECT's id, not a series at
--                                       all (the older lineage model; see
--                                       lib/hooks/useRerunLineage.ts, which says
--                                       so outright). 58 surveys, every one of
--                                       them pointing at a project.
--
-- 21 surveys carry both, and 38 carry ONLY the old one. Anything that queries
-- series_id cannot see those 38. That is what David hit: the series page for
-- "Bioprocessing" showed wave 2 missing while the project page showed PR00463
-- correctly linked to PR00199. Both screens were right inside their own model.
--
-- WHAT THIS MIGRATION DOES. It makes series_id the single model for the rows
-- where the answer is unambiguous, and refuses to guess anywhere else.
--
--   Group A - 2 waves whose root already belongs to a series: point them at it.
--             (PR00463 is already linked by hand, so in practice this moves
--             PR00501 into the National Independent Awareness Barometer series
--             as wave 3, behind PR00239 and PR00304.)
--   Group B - 16 roots with no series at all: create one each, then point the
--             root and every one of its waves at it (50 rows in total).
--
-- WHAT IT DELIBERATELY DOES NOT DO, and why:
--
--   * PR00443 IS EXCLUDED. It is wave 3, and the series it would join already
--     contains PR00409 as wave 3. The unique index on (series_id, rerun_number)
--     from migration 073 would reject it, and renumbering a live series is a
--     decision, not a backfill. lib/reruns/renumberLineage.ts exists for that.
--   * PR00245 IS EXCLUDED. Its rerun_series_id points at itself at wave 1 - the
--     "its own id IS the series id" case. There is no second wave and so no
--     series to make.
-- CORRECTED 2026-09-28, after the first run of this file aborted on its own
-- assertion. An earlier draft claimed 10 rows "point at different families" and
-- needed a human to settle them. THAT WAS WRONG, and the wrong part was the
-- test, not the data. `rerun_series_id` means "the survey I was cloned from",
-- NOT "the origin of the family": waves 3 to 7 of the wealth manager study all
-- name wave 2 (PR00066) as their root, because each was cloned from the one
-- before it. Comparing that against `rerun_series.origin_project_id` flags every
-- such chain as a disagreement. It is not one. Measured across all 449 live
-- surveys: under the family-membership test below, ZERO rows genuinely disagree.
--
-- `origin_project_id` turned out to be the unreliable column, not the lineage:
-- 9 of the 26 series have it NULL, and "National Independent Awareness
-- Barometer" points at a project that no longer exists. So a row is only really
-- broken when the survey its rerun_series_id names is not in the series at all.
-- That is what the assertion and the view below now test.
--   * `rerun_series_id` IS LEFT ALONE. It still feeds the project page lineage
--     view, and leaving it is what makes this reversible: undoing the whole
--     migration is `update survey_projects set series_id = null where ...`.
--
-- ⚠ THE ONE THING TO KNOW BEFORE RUNNING IT. The legacy auto-spawn in
-- app/api/cron/spawn-reruns/route.ts selects on `series_id is null`. 14 of these
-- waves are longitudinal and have never spawned, so TODAY they are eligible for
-- it. Once they have a series_id they leave that path - and the series created
-- here are deliberately NOT in service, so nothing will spawn a next wave for
-- them until somebody arms each series by hand. That is the safer default (see
-- the phantom-ladder problem: auto-spawn has already produced 65 delivered-but-
-- empty shells), but it IS a behaviour change and it is the reason every new
-- series below sets in_service, service_mode and auto_armed EXPLICITLY. The
-- table defaults are true / 'auto' / true; inheriting them would put 16 series
-- straight onto the spawn cron.
--
-- Cadence is left NULL on purpose. The column documents null as ad-hoc, and the
-- cadence cannot be honestly derived from the data: the Holocene tracker is
-- WEEKLY so every month gap reads 0, and PR00287 spans 2023 to 2026 and reads
-- as a negative gap. A guessed cadence that later drives a spawn is worse than
-- no cadence. Owner is left NULL for the same reason - every existing series is
-- owned by sreerag@alpharoc.ai, but assigning 16 more to him is his call.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable: every step
-- skips rows that already have what it would set.
begin;

-- ---------------------------------------------------------------------------
-- Group A: the root already belongs to a series, so the wave just joins it.
-- ---------------------------------------------------------------------------
update public.survey_projects w
   set series_id = s.id
  from public.rerun_series s, public.survey_projects root
 where w.project_code in ('PR00501', 'PR00463')
   and w.deleted_at is null
   and w.series_id is null
   and root.id = w.rerun_series_id
   and s.id = coalesce(
         (select s2.id from public.rerun_series s2 where s2.origin_project_id = root.id limit 1),
         root.series_id)
   -- Never break the one-wave-number-per-series index from 073.
   and not exists (
     select 1 from public.survey_projects x
      where x.series_id = s.id
        and x.deleted_at is null
        and coalesce(x.rerun_number, 1) = coalesce(w.rerun_number, 1)
        and x.id <> w.id);

-- ---------------------------------------------------------------------------
-- Group B, step 1: one series per root that has none.
-- ---------------------------------------------------------------------------
insert into public.rerun_series (
  client_id, client, survey_name, base_type, origin_project_id,
  cadence_months, delivery_cadence, owner_email,
  in_service, service_mode, auto_armed, paused,
  next_wave_no, anchor_date, notes)
select
  p.client_id,
  p.client,
  p.project_name,
  p.project_type,
  p.id,
  null,                      -- cadence unknown; null means ad-hoc (073)
  null,
  null,                      -- no owner named; set these by hand afterwards
  false,                     -- NOT in service. Table default is true.
  'manual',                  -- table default is 'auto'.
  false,                     -- table default is true.
  false,
  (select max(coalesce(w.rerun_number, 1)) + 1
     from public.survey_projects w
    where w.deleted_at is null
      and (w.id = p.id or w.rerun_series_id = p.id)),
  (select min(coalesce(w.launch_date, w.submitted_date, w.deliver_date))
     from public.survey_projects w
    where w.deleted_at is null
      and (w.id = p.id or w.rerun_series_id = p.id)),
  'Backfilled by migration 124 on 2026-09-28 from project-to-project lineage. '
  'Cadence, delivery cadence and owner were not derivable from the data and are '
  'unset; the series is out of service until somebody sets them.'
from public.survey_projects p
where p.deleted_at is null
  and p.project_code in (
    'PR00091', 'PR00137', 'PR00183', 'PR00197', 'PR00230', 'PR00235',
    'PR00262', 'PR00287', 'PR00290', 'PR00301', 'PR00307', 'PR00354',
    'PR00376', 'PR00379', 'PR00416', 'PR00420')
  and not exists (
    select 1 from public.rerun_series s where s.origin_project_id = p.id)
  -- The (client_id, lower(survey_name)) unique index from 073. Verified clear on
  -- 2026-09-28, checked again here so a re-run after someone adds a series by
  -- hand skips rather than aborts.
  and not exists (
    select 1 from public.rerun_series s
     where s.client_id is not distinct from p.client_id
       and lower(s.survey_name) = lower(p.project_name));

-- ---------------------------------------------------------------------------
-- Group B, step 2: point the root and every wave of it at its new series.
-- ---------------------------------------------------------------------------
update public.survey_projects w
   set series_id = s.id
  from public.rerun_series s
 where s.notes like 'Backfilled by migration 124%'
   and s.origin_project_id is not null
   and (w.id = s.origin_project_id or w.rerun_series_id = s.origin_project_id)
   and w.series_id is null
   and w.deleted_at is null
   and not exists (
     select 1 from public.survey_projects x
      where x.series_id = s.id
        and x.deleted_at is null
        and coalesce(x.rerun_number, 1) = coalesce(w.rerun_number, 1)
        and x.id <> w.id);

-- ---------------------------------------------------------------------------
-- Assertions. Measured expectations from 2026-09-28; a re-run after the data
-- has moved on should still pass, because each one states a PROPERTY rather
-- than a count, except where a count is the point.
-- ---------------------------------------------------------------------------
do $check$
declare n int; bad text;
begin
  -- 1. Every series this migration created is inert. If any of the three
  --    columns inherited its default, 16 series just joined the spawn cron.
  select count(*) into n from public.rerun_series
   where notes like 'Backfilled by migration 124%'
     and (in_service is true or service_mode <> 'manual' or auto_armed is true or paused is true);
  if n <> 0 then
    raise exception '124: % backfilled series are not inert - they would auto-spawn waves', n;
  end if;

  -- 2. The 16 roots each have exactly one series, and it is theirs.
  select count(*) into n from public.survey_projects p
   where p.deleted_at is null
     and p.project_code in (
       'PR00091','PR00137','PR00183','PR00197','PR00230','PR00235',
       'PR00262','PR00287','PR00290','PR00301','PR00307','PR00354',
       'PR00376','PR00379','PR00416','PR00420')
     and p.series_id is null;
  if n <> 0 then
    raise exception '124: % of the 16 roots still have no series_id', n;
  end if;

  -- 3. Nobody ended up in two places: no live wave has a series_id whose
  --    rerun_number is shared with another live wave of the same series.
  select count(*) into n from (
    select series_id, coalesce(rerun_number, 1) as w
      from public.survey_projects
     where series_id is not null and deleted_at is null
     group by 1, 2 having count(*) > 1) d;
  if n <> 0 then
    raise exception '124: % (series, wave number) pairs are duplicated', n;
  end if;

  -- 4. The excluded rows really were left alone.
  select string_agg(project_code, ', ') into bad from public.survey_projects
   where project_code in ('PR00443', 'PR00245') and series_id is not null and deleted_at is null;
  if bad is not null then
    raise exception '124: % should have been left out of this backfill', bad;
  end if;

  -- 5. Nobody was filed into a family they do not belong to. For every row that
  --    carries both links, the survey named by rerun_series_id must be IN the
  --    series the row now sits in - as a member, as its origin, or as the row
  --    itself. This is the test the first draft got wrong; see the note at the
  --    top. Measured 0 before this migration and it must still be 0 after.
  select count(*) into n from public.survey_projects w
    join public.rerun_series s on s.id = w.series_id
   where w.deleted_at is null
     and w.rerun_series_id is not null
     and w.rerun_series_id <> w.id
     and s.origin_project_id is distinct from w.rerun_series_id
     and not exists (
       select 1 from public.survey_projects sib
        where sib.series_id = w.series_id
          and sib.deleted_at is null
          and sib.id = w.rerun_series_id);
  if n <> 0 then
    raise exception '124: % rows were filed into a series their linked root is not part of', n;
  end if;
end $check$;

-- ---------------------------------------------------------------------------
-- A standing view of the drift, so this cannot quietly happen again. No
-- constraint: 10 rows already violate the rule, and a constraint that cannot be
-- added today is a constraint nobody adds. Ship the measurement first; add the
-- check once the view is empty.
-- ---------------------------------------------------------------------------
create or replace view public.rerun_link_drift as
select
  w.id,
  w.project_code,
  w.project_name,
  w.rerun_number,
  w.series_id,
  w.rerun_series_id,
  root.project_code as linked_root_code,
  s.survey_name    as series_name,
  origin.project_code as series_origin_code,
  case
    when w.series_id is null
      then 'linked the old way only - invisible to anything reading series_id'
    else 'filed into a series its linked root is not part of'
  end as problem
from public.survey_projects w
left join public.rerun_series s     on s.id = w.series_id
left join public.survey_projects root   on root.id = w.rerun_series_id
left join public.survey_projects origin on origin.id = s.origin_project_id
where w.deleted_at is null
  and w.rerun_series_id is not null
  and (
    w.series_id is null
    -- Not "the origins disagree" - see the note at the top of this file. The
    -- row is only wrong if the survey it was cloned from is not in this family.
    or (w.rerun_series_id <> w.id
        and s.origin_project_id is distinct from w.rerun_series_id
        and not exists (
          select 1 from public.survey_projects sib
           where sib.series_id = w.series_id
             and sib.deleted_at is null
             and sib.id = w.rerun_series_id))
  );

comment on view public.rerun_link_drift is
  'Surveys whose rerun lineage disagrees between series_id (the cadence model, migration 073) and '
  'rerun_series_id (the older project-to-project link). Empty is the goal state. Migration 124 '
  'backfilled every unambiguous case. Note that a wave naming a SIBLING wave as its root is normal '
  'and is NOT drift - clone-from-the-previous-wave is how these were made; this view only lists a '
  'row whose linked survey is in no shared series at all, or that has no series_id yet.';

-- Same two lines as every other view here: Supabase default privileges hand a
-- new object to anon as well, so the revoke is not ceremonial.
revoke all on public.rerun_link_drift from anon, authenticated, public;
grant select on public.rerun_link_drift to authenticated;

commit;

-- VERIFY (reading, not trusting; the asserts above already ran):
--
--   -- Nothing was armed. Expect 16 rows, all f / manual / f.
--   select project_code_hint, in_service, service_mode, auto_armed, cadence_months, next_wave_no
--     from (select survey_name as project_code_hint, in_service, service_mode, auto_armed,
--                  cadence_months, next_wave_no
--             from public.rerun_series where notes like 'Backfilled by migration 124%') q;
--
--   -- The Bioprocessing series now has both waves.
--   select project_code, rerun_number, status, board_column
--     from public.survey_projects
--    where series_id = 'e8a3e3c1-9bb1-4652-9b96-f8886edfee02' and deleted_at is null
--    order by rerun_number;
--
--   -- What is left to settle by hand. Expect exactly 2, both 'linked the old way
--   -- only': PR00443 (wave 3 collides with PR00409) and PR00245 (self-link).
--   select project_code, rerun_number, linked_root_code, series_origin_code, problem
--     from public.rerun_link_drift order by problem, project_code;
--
-- AFTERWARDS, for each backfilled series, set the cadence and the owner on the
-- series page and turn it back into service if it should be running. Until then
-- no next wave will be spawned for any of them.
--
-- TO UNDO THE WHOLE THING:
--   update public.survey_projects set series_id = null
--    where series_id in (select id from public.rerun_series
--                         where notes like 'Backfilled by migration 124%');
--   delete from public.rerun_series where notes like 'Backfilled by migration 124%';
--   update public.survey_projects set series_id = null
--    where project_code in ('PR00501', 'PR00463');
