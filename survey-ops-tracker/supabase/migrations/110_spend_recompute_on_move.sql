-- 110: moving a blast, supplier or cost line between projects left the OLD
--      project overstated. Recompute both sides.
--
-- FOUND BY DOING IT. Splitting the POS 3.0 fielding across its two monthly
-- projects moved 17 blasts off PR00352 onto PR00443. PR00443 came out correct at
-- $2,863.68. PR00352 stayed at $4,373.92 — the total for all 26 blasts, 9 of
-- which is all it still holds. It should have been $1,510.24, and the
-- reconciliation script caught it: 1 of 396 projects disagreeing.
--
-- THE CAUSE. All three sync functions resolve exactly one project:
--
--   perform public.recompute_project_spend(coalesce(NEW.project_id, OLD.project_id));
--
-- On INSERT and DELETE that is right, because only one of the two is non-null.
-- On UPDATE both are populated, coalesce takes NEW, and when the update MOVED the
-- row the project it moved away from is never recomputed. Its stored spend keeps
-- the departed rows in it, silently and for good: nothing recomputes a project
-- except a write to one of its own child rows, so a project that has just lost
-- its last blast can sit on a stale total indefinitely.
--
-- WHY IT WENT UNNOTICED. Nothing in the app moves a blast between projects
-- today, so until now the only writes were inserts, deletes and edits in place —
-- every one of which this coalesce handles correctly. merge_projects reassigns
-- child rows in bulk and is the one existing path that could hit this; it is
-- worth a look, though the loser project is soft-deleted immediately afterwards
-- so a stale total on it is invisible rather than wrong-looking.
--
-- THE FIX. Recompute the other side too, and only when it is genuinely a move.
-- `is distinct from` rather than `<>` so a null on either side compares sanely.
--
-- Re-runnable. No data change: it replaces three function bodies. Existing rows
-- already made stale by a past move are NOT repaired here — run
-- scripts/_blast-backfill-state.mjs to list any, then touch one child row on
-- each to fire the corrected trigger.
--
-- Apply by hand in the Supabase SQL editor (David).
begin;

create or replace function public.sync_blast_spend() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_project_spend(coalesce(NEW.project_id, OLD.project_id));
  -- A row that MOVED leaves the project it came from holding spend it no longer
  -- has. Recompute that side as well, or the old total stands forever.
  if TG_OP = 'UPDATE' and NEW.project_id is distinct from OLD.project_id then
    perform public.recompute_project_spend(OLD.project_id);
  end if;
  return null;
end $$;

create or replace function public.sync_supplier_spend() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_project_spend(coalesce(NEW.project_id, OLD.project_id));
  if TG_OP = 'UPDATE' and NEW.project_id is distinct from OLD.project_id then
    perform public.recompute_project_spend(OLD.project_id);
  end if;
  return null;
end $$;

create or replace function public.sync_cost_spend() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_project_spend(coalesce(NEW.project_id, OLD.project_id));
  if TG_OP = 'UPDATE' and NEW.project_id is distinct from OLD.project_id then
    perform public.recompute_project_spend(OLD.project_id);
  end if;
  return null;
end $$;

comment on function public.sync_blast_spend is
  'Recomputes actual_spend when a blast changes. Recomputes BOTH projects when an update moves the row between them (110): coalesce(NEW, OLD) alone takes NEW and leaves the source overstated, which is what happened when the POS 3.0 blasts were split across their June and July projects.';

commit;

-- VERIFY. Move a blast and check both ends, inside a transaction you roll back:
--
--   begin;
--   select project_code, actual_spend from public.survey_projects
--     where project_code in ('PR00352','PR00443');
--   update public.project_blasts set project_id =
--     (select id from public.survey_projects where project_code = 'PR00443')
--     where id = (select id from public.project_blasts where project_id =
--       (select id from public.survey_projects where project_code = 'PR00352') limit 1);
--   -- BOTH totals must have changed. Before 110 only PR00443 moved.
--   select project_code, actual_spend from public.survey_projects
--     where project_code in ('PR00352','PR00443');
--   rollback;
