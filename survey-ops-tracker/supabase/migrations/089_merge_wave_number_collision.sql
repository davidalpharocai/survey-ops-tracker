-- 089: fix the merge carry-over 087 introduced - it could abort the whole merge.
--
-- WHAT WENT WRONG
--
-- 087 taught merge_projects to carry the loser's series membership to the
-- survivor, which was the right fix for a real bug. It was written without
-- accounting for migration 073's partial unique index:
--
--   create unique index survey_projects_series_wave_uidx
--     on survey_projects(series_id, rerun_number)
--     where series_id is not null and deleted_at is null;
--
-- No two LIVE waves in one series may share a wave number. Two consequences,
-- both of which turn a working merge into a failed one:
--
--   1. 087 ran the carry-over BEFORE soft-deleting the loser, so the loser was
--      still live and still occupying its slot in its own series.
--   2. `rerun_number = coalesce(s.rerun_number, l.rerun_number)` is dead code:
--      the column is `integer not null default 1`, so the coalesce always
--      resolves to the survivor's own number. The survivor therefore gained the
--      loser's series while keeping its own number - typically 1, which such a
--      series almost always already has.
--
-- Either one makes the UPDATE violate the index, and since the whole function is
-- one transaction, the ENTIRE merge aborts. Net effect of 087 alone: merges that
-- used to succeed (while silently dropping the series link) would now fail
-- outright. Louder than the original bug, but still broken.
--
-- This was found by an adversarial review of the series attach/detach feature on
-- 2026-08-27, before anyone hit it in production.
--
-- THE FIX
--
-- Retire the loser FIRST, which drops it out of the partial index and frees its
-- slot, then have the survivor take that exact slot - correct, because it is
-- taking the loser's place in the series. Everything else in 087 is unchanged.
--
-- Safe to reorder: every statement after the delete addresses rows by
-- project_id and none of them filters on deleted_at, and the not-found guards at
-- the top of the function have already run by then.
--
-- Apply by hand in the Supabase SQL editor (David), AFTER 087. Re-runnable.
begin;

-- 087's function with the delete moved above the carry-over and the dead
-- coalesce replaced. Extracted from 087 programmatically and re-spliced, not
-- retyped - the same discipline 087 and 088 used, and verified the same way.
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



  -- 089: the loser is retired HERE, before the carry-over below, and the order
  -- is the entire point. 073 has a partial unique index on
  -- (series_id, rerun_number) WHERE deleted_at is null, so while the loser is
  -- still live it occupies its own slot in its own series. Carrying that series
  -- onto the survivor first therefore collided - with the loser itself, or with
  -- whichever wave already held the survivor's number - and aborted the merge.
  -- Soft-deleting first drops the loser out of the index and frees the slot.
  --
  -- Safe to move: nothing between here and the end of the function filters on
  -- deleted_at (every remaining statement addresses rows by project_id), and the
  -- not-found guards at the top of the function have already run.
  update survey_projects set deleted_at = now() where id = p_loser;

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
         -- 089: take the loser's WAVE NUMBER, not a coalesce.
         -- rerun_number is `integer not null default 1`, so coalesce(s.…, l.…)
         -- could never be anything but the survivor's own value - the line below
         -- was dead. Worse than dead: the survivor kept its own number (usually
         -- 1) while gaining the loser's series, and 073's partial unique index on
         -- (series_id, rerun_number) for live rows then rejected the UPDATE, so
         -- the WHOLE merge aborted. Only when it is genuinely inheriting the
         -- series does the survivor take the loser's slot - which is correct,
         -- since it is taking the loser's place in that series - and the delete
         -- moved above has already freed it.
         rerun_number    = case
           when s.series_id is null and l.series_id is not null then l.rerun_number
           else s.rerun_number
         end
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

commit;
