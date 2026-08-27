-- 090: stop auto-setting voter_survey_qa and citation_language_needed.
--      The columns and every value in them STAY.
--
-- WHY THIS EXISTS
--
-- David, 2026-08-26: "you can remove. it should just be standard that all PS
-- polling surveys in Occam have the Margin of Error (MOE) statement."
--
-- The behaviour the citation flag pointed at is now simply how we work. A flag
-- whose answer is always yes carries no information, and a per-project toggle
-- for it invites the opposite reading -- that a project WITHOUT the flag needs
-- no MOE statement. So the flag goes, and with it the last reason the 009
-- trigger had to keep firing.
--
-- WHAT 009 DID
--
-- 009 added five columns (longitudinal, salesperson, voter_survey_qa,
-- citation_language_needed, n_actual) plus a BEFORE INSERT trigger,
-- survey_projects_voter_flags -> set_voter_flags(), which guessed at a
-- voter/polling survey -- salesperson ilike '%jenna%', or 'vote' in the project
-- name or the client -- and, when either column arrived null, set BOTH to that
-- guess. Setting those two columns is the trigger's ONLY effect: it touches
-- nothing else on NEW and returns it unchanged otherwise. Nothing to preserve,
-- so both the trigger and its function are dropped rather than emptied out --
-- a no-op function firing on every project insert is just a thing for the next
-- reader to trip over.
--
-- The voter_survey_qa TAG came out of the UI on 2026-08-24 (commit f3d1991),
-- but the trigger had to stay then, because the same function also set
-- citation_language_needed, which was still live. Both are retired now.
--
-- WHAT THIS FILE DOES NOT DO
--
-- It does NOT drop either column, and it does not touch a single row. David
-- wants historical values to stay readable, and the audit trigger
-- (audit_survey_project, latest version in 088) keeps logging both -- so every
-- past value and every past change to it remains queryable. New projects will
-- simply insert NULL, which reads as "nobody said", the honest answer once the
-- guess is gone.
--
-- It also leaves the columns writable through mcp_write_project
-- (PROJECT_WRITE_FIELDS / UNDOABLE_FIELDS in lib/mcp/writes.ts), for the same
-- reason 8/24 did: undo_last_change works off audit rows, and an audit row for
-- a retired column should still be undoable.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable, and reversible
-- by re-running 009's trigger block.

begin;

drop trigger if exists survey_projects_voter_flags on public.survey_projects;
drop function if exists public.set_voter_flags();

comment on column public.survey_projects.voter_survey_qa is
  'RETIRED 2026-08-24 (UI) / 2026-08-26 (auto-set, migration 090). Historical values only -- nothing writes this now. Kept so past values and their audit history stay readable.';
comment on column public.survey_projects.citation_language_needed is
  'RETIRED 2026-08-26 (migration 090). The MOE/citation statement is now standard on all PS polling surveys in Occam, so there is nothing per-project to flag. Historical values only.';

commit;
