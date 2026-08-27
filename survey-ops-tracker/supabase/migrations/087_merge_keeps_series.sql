-- 087: a merge must not silently drop what it cannot re-point.
--
-- merge_projects re-points fifteen CHILD TABLES and carries the price row and the
-- context override, but it never merged the scalar columns on survey_projects
-- itself. Two of those carry real information, and both were being lost:
-- series membership (series_id / rerun_series_id / rerun_number) and the
-- append-only notes log (latest_next_steps).
--
-- WHY THIS EXISTS
--
-- David asked why PR00388 ("Foodservice - SYY, USFD and PFGC - wave 3", BAM) was
-- not grouped with the other foodservice waves on the client page. Two causes,
-- either of which alone produces that symptom:
--
--   1. PR00388 was created 2026-08-25, AFTER the first-class series existed, by a
--      path that does not set series_id. Only createSeriesFromProject
--      (lib/reruns/seriesOps.ts:228) and the auto-spawn cron
--      (app/api/cron/spawn-reruns/route.ts:134) ever assign it, and there is
--      still NO operation that attaches an existing project to an existing
--      series. So it began life outside the series.
--   2. On 2026-08-26 PR00295 -- which WAS wave 3 of that series -- was merged
--      into PR00388. merge_projects re-points fifteen child tables and carries
--      the price and the context override, but never touched series_id, so the
--      surviving wave 3 stayed outside the series.
--
-- This file fixes (2), the one that is a bug rather than a missing feature.
--
-- Tracing that turned up a SECOND column lost by the same merge: PR00388's notes
-- log was empty while PR00295 held 1,436 characters David wrote on 2026-08-25 --
-- who was really driving the study, the pricing Alex had held, an ownership
-- caveat, an open client issue, and an explicit "reconcile before programming"
-- flag on the N target. The project_steps checklist had transferred correctly, so
-- nothing looked wrong; the project reached Fielding without the note.
--
-- Both of PR00388's values were repaired by hand on 2026-08-27 (project_audit
-- holds a `series_id` row and a notes-log update, both attributed to
-- "david@alpharoc.ai ... via Claude"), so this file does not touch its data.
--
-- WHAT THIS FILE DOES NOT DO
--
-- * It does not repair the two OTHER live projects found in the same state,
--   PR00010 and PR00207 (both HingeVoter/Carah -- waves 2 and 3 of the family
--   whose wave 1, PR00341, holds series 36329d48). Re-homing projects is
--   deliberate data surgery, not a migration side effect. Step 2's view lists
--   them so the decision is at least visible.
-- * It does not add an "attach an existing project to a series" action. That is a
--   real gap -- it is why PR00388 had to be fixed with SQL -- but it is a feature
--   with a UI, not a policy fix.
-- * It does not renumber anything. applyRenumber (lib/reruns/seriesOps.ts:133)
--   owns wave numbering and runs in the app; a merge is not a reordering.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable, and reversible
-- by re-running 083's copy of merge_projects.
begin;

-- STEP 1: merge_projects, with the series carry-over.
--
-- This is 083's function VERBATIM apart from the block marked 087, spliced in
-- immediately before the loser is soft-deleted (it must read both rows while both
-- still exist). Reproduced in full because `create or replace` cannot patch a
-- single statement -- and extracted from 083 programmatically rather than
-- retyped, so nothing else can have drifted.
create or replace function public.merge_projects(p_survivor uuid, p_loser uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  actor text := coalesce(nullif(auth.email(), ''), 'system');
  survivor_code text;
  loser_code text;
  ver_offset int;
  survivor_price numeric(10,2);
  loser_price numeric(10,2);
begin
  if public.my_role() <> 'analyst' then raise exception 'Not authorized'; end if;
  if p_survivor = p_loser then raise exception 'Cannot merge a project into itself'; end if;
  if not exists (select 1 from survey_projects where id = p_survivor and deleted_at is null)
    then raise exception 'Survivor project not found'; end if;
  if not exists (select 1 from survey_projects where id = p_loser and deleted_at is null)
    then raise exception 'Loser project not found'; end if;

  -- Discard the retired duplicate's N segments (survivor's N wins).
  delete from project_segments where project_id = p_loser;

  -- Survivor-wins on the price row (082). Log the discarded rate BEFORE deleting
  -- it, so a merge can never lose a number quietly.
  select price_per_n into survivor_price from project_financials where project_id = p_survivor;
  select price_per_n into loser_price    from project_financials where project_id = p_loser;
  if loser_price is not null and exists (select 1 from project_financials where project_id = p_survivor) then
    insert into project_audit(project_id, field, old_value, new_value, changed_by)
      values (p_survivor, 'price_per_n_merge_discarded',
        public.price_per_n_label(loser_price), public.price_per_n_label(survivor_price), actor);
  end if;
  delete from project_financials l
    where l.project_id = p_loser
      and exists (select 1 from project_financials s where s.project_id = p_survivor);
  update project_financials set project_id = p_survivor where project_id = p_loser;

  -- Survivor-wins on the context row (083): same primary-key collision, and NO
  -- audit line — the briefing regenerates on the next nightly pass. Carry the
  -- loser's HUMAN topic override into any blank the survivor has first: the
  -- generated half of that row is disposable, an analyst's correction is not.
  -- This UPDATE must run before the delete below, while both rows still exist.
  update project_context s
     set topics_override    = coalesce(s.topics_override, l.topics_override),
         companies_override = coalesce(s.companies_override, l.companies_override),
         topics_set_by      = coalesce(s.topics_set_by, l.topics_set_by),
         topics_set_at      = coalesce(s.topics_set_at, l.topics_set_at)
    from project_context l
   where s.project_id = p_survivor and l.project_id = p_loser;
  delete from project_context l
    where l.project_id = p_loser
      and exists (select 1 from project_context s where s.project_id = p_survivor);
  update project_context set project_id = p_survivor where project_id = p_loser;
  -- Whichever row survived, it now describes a project that just absorbed another,
  -- so force a regeneration (see the inputs_fingerprint comment). No-op when the
  -- survivor has no context row at all — the nightly pass will create one.
  update project_context set inputs_fingerprint = null where project_id = p_survivor;

  update project_bids         set project_id = p_survivor where project_id = p_loser;
  update project_blasts       set project_id = p_survivor where project_id = p_loser;
  update project_costs        set project_id = p_survivor where project_id = p_loser;
  update project_steps        set project_id = p_survivor where project_id = p_loser;
  update project_activity     set project_id = p_survivor where project_id = p_loser;
  update project_data_changes set project_id = p_survivor where project_id = p_loser;
  update deliverables         set project_id = p_survivor where project_id = p_loser;
  update project_audit        set project_id = p_survivor where project_id = p_loser;

  -- PS: re-point launches first (ids unchanged → the suppliers' launch_id FK stays
  -- valid), then the supplier rows themselves.
  update project_launches     set project_id = p_survivor where project_id = p_loser;
  update project_suppliers    set project_id = p_survivor where project_id = p_loser;

  select coalesce(max(version), 0) into ver_offset
    from question_submissions where project_id = p_survivor;
  update question_submissions qs
    set project_id = p_survivor, version = ver_offset + r.rn
    from (
      select id, row_number() over (order by version, id) as rn
      from question_submissions where project_id = p_loser
    ) r
    where qs.id = r.id;

  delete from project_recipients l
    where l.project_id = p_loser
      and exists (select 1 from project_recipients s
                  where s.project_id = p_survivor and s.email = l.email and s.role = l.role);
  update project_recipients set project_id = p_survivor where project_id = p_loser;

  delete from project_seen where project_id = p_loser;


  -- 087: carry the loser's SERIES MEMBERSHIP to the survivor.
  --
  -- The bug this fixes, concretely: on 2026-08-26 PR00295 (wave 3 of the BAM
  -- Foodservice series) was merged into PR00388 (which was not in that series at
  -- all). Everything else transferred, but series_id did not, so the surviving
  -- wave 3 dropped out of its own series and the client page rendered it as a
  -- loose row underneath the group it belonged to. Nobody had touched these
  -- columns here because a merge is USUALLY within one family, where the survivor
  -- already holds the same values and there is nothing to carry.
  --
  -- Survivor-wins, exactly like the price row (082) and the context override
  -- above: coalesce only fills a BLANK. If the survivor already belongs to a
  -- series the merge must NOT move it -- silently re-homing a project into the
  -- loser's series would be a bigger wrong than the one being fixed.
  --
  -- rerun_number rides along only when the survivor has none. Carrying a number
  -- onto a project that already has one could put two waves at the same position
  -- in a series; leaving the survivor's own number alone cannot.
  --
  -- Both halves are carried because they are two halves of one idea:
  -- rerun_series_id/rerun_number is the legacy per-project lineage (what the
  -- project page's wave list and app/api/projects/link-rerun/route.ts manage) and
  -- series_id is the first-class rerun_series FK from 073 (what the client page
  -- groups on, and the only one it reads). Filling one and not the other is how
  -- PR00388 came to look grouped on its own page and ungrouped on the client's.
  update survey_projects s
     set series_id       = coalesce(s.series_id, l.series_id),
         rerun_series_id = coalesce(s.rerun_series_id, l.rerun_series_id),
         rerun_number    = coalesce(s.rerun_number, l.rerun_number)
    from survey_projects l
   where s.id = p_survivor and l.id = p_loser;

  -- Log an inheritance, and log a DIFFERENT line when the two disagreed and
  -- survivor-wins discarded the loser's series -- the same "a merge can never
  -- lose a number quietly" rule the price block above follows.
  insert into project_audit(project_id, field, old_value, new_value, changed_by)
  select p_survivor, 'series_id_merge_inherited', null, l.series_id::text, actor
    from survey_projects l, survey_projects s
   where l.id = p_loser and s.id = p_survivor
     and l.series_id is not null
     and s.series_id = l.series_id;

  insert into project_audit(project_id, field, old_value, new_value, changed_by)
  select p_survivor, 'series_id_merge_discarded', l.series_id::text, s.series_id::text, actor
    from survey_projects l, survey_projects s
   where l.id = p_loser and s.id = p_survivor
     and l.series_id is not null and s.series_id is not null
     and l.series_id <> s.series_id;

  -- 087: carry the loser's NOTES LOG too.
  --
  -- Same defect, different column, found while tracing the first one. The merge
  -- re-points fifteen child TABLES but never merged the scalar text on
  -- survey_projects, and latest_next_steps is not a denormalisation of
  -- project_steps -- it is its own append-only narrative log, auto-stamped with a
  -- date and author (lib/hooks/useProjects.ts:372, autoStamp).
  --
  -- What that cost in the case that prompted this: PR00295 carried 1,436
  -- characters David wrote on 2026-08-25 -- who was actually driving the study,
  -- the $125/N pricing Alex had held, an ownership caveat, an open client issue,
  -- and an explicit "reconcile before programming" flag on the N target. The
  -- project_steps checklist transferred correctly; that note did not, and the
  -- project reached Fielding without it. It was restored by hand on 2026-08-27.
  --
  -- CONCATENATED, not coalesced. Every other carry-over in this function is
  -- survivor-wins, and for a single-valued field like a price that is right --
  -- one of them has to lose. An append-only log is different: both halves are
  -- real history, and picking one silently destroys the other. So a blank
  -- survivor inherits the loser's log outright, and when BOTH have content the
  -- loser's is appended beneath a marker naming where it came from. The result is
  -- longer than either input, which is the correct failure mode for a log.
  update survey_projects s
     set latest_next_steps = case
           when nullif(btrim(coalesce(l.latest_next_steps, '')), '') is null
             then s.latest_next_steps
           when nullif(btrim(coalesce(s.latest_next_steps, '')), '') is null
             then l.latest_next_steps
           else s.latest_next_steps || chr(10) || chr(10)
                || '[merged in from ' || coalesce(l.project_code, p_loser::text) || ']'
                || chr(10) || l.latest_next_steps
         end
    from survey_projects l
   where s.id = p_survivor
     and l.id = p_loser
     and nullif(btrim(coalesce(l.latest_next_steps, '')), '') is not null;

  -- The 028 audit trigger already logs latest_next_steps on any UPDATE, so the
  -- change itself is recorded. This line records WHY, which the trigger cannot
  -- know -- and matches the price block's habit of naming the merge explicitly.
  insert into project_audit(project_id, field, new_value, changed_by)
  select p_survivor, 'next_steps_merge_carried',
         coalesce(l.project_code, p_loser::text), actor
    from survey_projects l
   where l.id = p_loser
     and nullif(btrim(coalesce(l.latest_next_steps, '')), '') is not null;

  update survey_projects set deleted_at = now() where id = p_loser;

  select project_code into survivor_code from survey_projects where id = p_survivor;
  select project_code into loser_code   from survey_projects where id = p_loser;
  insert into project_audit(project_id, field, new_value, changed_by)
    values (p_survivor, 'merged_in', coalesce(loser_code, p_loser::text), actor);
  insert into project_audit(project_id, field, new_value, changed_by)
    values (p_loser, 'merged_into', coalesce(survivor_code, p_survivor::text), actor);

  -- Reflect the merged-in supplier/blast/cost spend in the survivor's actual_spend.
  perform public.recompute_project_spend(p_survivor);
end $$;
grant execute on function public.merge_projects(uuid, uuid) to authenticated;

-- STEP 2: make a recurrence visible instead of invisible.
--
-- A project whose SIBLINGS belong to a first-class series while it does not.
-- That is the precise shape of this bug and it is invisible today: the client
-- page simply renders the odd one out as a loose row, which reads as a project
-- that is not a rerun at all.
--
-- Deliberately NOT the same thing as "has no series_id". Twenty-four live
-- projects across eight families have no series at all, because their family was
-- never promoted -- Holocene Weekly Tracker's thirteen waves being the largest.
-- Those are consistent rather than broken, and listing them here would bury the
-- two that are.
--
-- security_invoker so the view is subject to the CALLER's RLS. A view created by
-- the owner otherwise runs with the owner's rights and bypasses row-level
-- security entirely, which is the classic Postgres footgun in this area.
create or replace view public.orphaned_series_members
with (security_invoker = true) as
with lineage as (
  select p.id, p.project_code, p.project_name, p.client, p.series_id,
         p.rerun_number,
         coalesce(p.rerun_series_id, p.id) as family_root
    from public.survey_projects p
   where p.deleted_at is null
     and (p.rerun_series_id is not null or p.series_id is not null)
),
families as (
  select family_root,
         max(series_id::text) filter (where series_id is not null) as family_series
    from lineage
   group by family_root
)
select l.id, l.project_code, l.project_name, l.client, l.rerun_number,
       f.family_series::uuid as should_join_series
  from lineage l
  join families f on f.family_root = l.family_root
 where l.series_id is null
   and f.family_series is not null;

comment on view public.orphaned_series_members is
  'Live projects whose rerun family belongs to a first-class series but which are not in it themselves, so the client page renders them as a loose row beside the group they belong to. Expected to be EMPTY. Anything listed needs series_id set to should_join_series. Caused historically by merge_projects dropping the column (fixed in 087) and by there being no way to attach an existing project to an existing series.';

grant select on public.orphaned_series_members to authenticated;

commit;
