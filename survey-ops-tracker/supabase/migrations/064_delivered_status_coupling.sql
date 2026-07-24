-- 064: couple the Delivery stage with archived status.
--
-- Rule (David, 2026-07-24): a project marked Delivered is done — it should be
-- Closed (archived) and can't be reopened EXCEPT by moving it back out of the
-- Delivery stage (which happens occasionally when we reopen to collect more N).
--
-- Invariant enforced here: board_column = 'Delivery'  ⟺  status = 'Closed'.
-- The trigger is the single source of truth, so it holds across every write path
-- (pipeline spine, board drag, the assistant's advance_project / set_project_status,
-- and direct edits). BEFORE UPDATE mutating NEW.*, same pattern as 048's
-- stamp_delivered_at (which sorts before this by name, so delivered_at is stamped
-- first on entry, then status is set here).

create or replace function public.couple_delivered_status()
returns trigger as $$
begin
  if new.board_column = 'Delivery' then
    -- In (or entering) the Delivery stage → archived, always. This also REPAIRS
    -- any attempt to reopen by flipping status alone (set_project_status, the
    -- header Resume button, a raw edit) — those would otherwise leave the invalid
    -- "Delivered + Open" state. To truly reopen, move it out of Delivery (below).
    new.status := 'Closed';
  elsif old.board_column = 'Delivery' and new.board_column is distinct from 'Delivery' then
    -- Moved back out of Delivery → reopen (if it was the auto-close) and clear
    -- delivered_at so a later re-delivery records a fresh timestamp.
    if old.status = 'Closed' then
      new.status := 'Open';
    end if;
    new.delivered_at := null;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists survey_projects_delivered_status on public.survey_projects;
create trigger survey_projects_delivered_status
  before update on public.survey_projects
  for each row execute function public.couple_delivered_status();

-- Backfill: bring already-delivered projects into the new invariant. Only the
-- clear case (Delivery + Open) — leave any Hold-in-Delivery for a human to judge.
update public.survey_projects
  set status = 'Closed'
  where board_column = 'Delivery' and status = 'Open';
