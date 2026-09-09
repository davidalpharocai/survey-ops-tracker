-- 107: APPLY THIS FIRST. Migration 030 was never run, and the leak it was
-- written to close is open right now.
--
-- WHAT IS EXPOSED, verified on 2026-09-09 with real user JWTs, not inferred:
--
--   eric.albert@holoceneadvisors.com  (role: compliance — an EXTERNAL reviewer
--   at a client firm) and alex@alpharoc.ai (role: sales) can both read, for
--   EVERY client, not merely their own:
--
--     project_activity      full inbound and outbound email bodies
--     project_audit         the entire change history, budget and spend included
--     project_steps         internal next steps
--     project_bids          legacy rate rows
--     project_data_changes  engineer notes
--     project_seen          who looked at what, and when
--
--   Sampled rows came back for all six, for both accounts.
--
-- WHY IT IS OPEN. Migration 008 scoped the PARENT tables and built the
-- portal_projects view, but these child tables were created with
-- `to authenticated using (true)`. 030 was written in response and, on the
-- evidence above, never applied — the file has been sitting in the repo
-- unapplied while the standing note recorded 001-100 as applied.
--
-- An external compliance reviewer holds a real authenticated session. So does
-- anyone who obtains one of their magic links. This is a cross-tenant leak to a
-- party outside the company, and it is the reason this migration jumps the
-- queue.
--
-- THIS IS 030's CONTENT, unchanged in effect, re-issued under a number that
-- reflects what actually ran. Its `my_role() = 'analyst'` test is still exactly
-- right: the tiers that exist now are analyst, compliance and sales, and only
-- the first has any business in these tables.
--
-- SAFE TO APPLY IMMEDIATELY — checked, not assumed:
--   * The compliance portal reads only questions, question_submissions,
--     portal_projects, questionnaires and profiles. None of the six.
--   * The sales portal reads only the sales_* views (102, 105). None of the six.
--   * Inserts happen either from the browser as an analyst, or from
--     security-definer triggers and service-role paths, which bypass RLS.
--   * project_audit keeps its existing "service role full audit" policy; only
--     the authenticated READ is narrowed.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable, no data change.
begin;

-- project_activity — full email bodies.
drop policy if exists "authenticated can read activity" on public.project_activity;
drop policy if exists "authenticated can insert activity" on public.project_activity;
drop policy if exists "analysts read activity" on public.project_activity;
drop policy if exists "analysts insert activity" on public.project_activity;
create policy "analysts read activity" on public.project_activity
  for select to authenticated using (public.my_role() = 'analyst');
create policy "analysts insert activity" on public.project_activity
  for insert to authenticated with check (public.my_role() = 'analyst');

-- project_bids — the dead rate table (015). Locked anyway: dead is not the same
-- as harmless, and it still carries per-project money.
drop policy if exists "authenticated full access bids" on public.project_bids;
drop policy if exists "analysts full access bids" on public.project_bids;
create policy "analysts full access bids" on public.project_bids
  for all to authenticated
  using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');

-- project_steps — internal next steps, written by analysts for analysts.
drop policy if exists "authenticated full access steps" on public.project_steps;
drop policy if exists "analysts full access steps" on public.project_steps;
create policy "analysts full access steps" on public.project_steps
  for all to authenticated
  using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');

-- project_data_changes — engineer notes.
drop policy if exists "authenticated full access data changes" on public.project_data_changes;
drop policy if exists "analysts full access data changes" on public.project_data_changes;
create policy "analysts full access data changes" on public.project_data_changes
  for all to authenticated
  using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');

-- project_seen — NEW-badge bookkeeping. Low value on its own, but it reveals who
-- is looking at which client and when.
drop policy if exists "authenticated full access seen" on public.project_seen;
drop policy if exists "analysts full access seen" on public.project_seen;
create policy "analysts full access seen" on public.project_seen
  for all to authenticated
  using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');

-- project_audit — the change history, and the most sensitive of the six: it
-- carries every budget and spend movement in old_value/new_value as text, which
-- is precisely what 086 and 102 went to such lengths to keep from these tiers.
-- Reads narrow to analysts; the service-role policy that lets the definer
-- triggers write is untouched.
drop policy if exists "authenticated read audit" on public.project_audit;
drop policy if exists "analysts read audit" on public.project_audit;
create policy "analysts read audit" on public.project_audit
  for select to authenticated using (public.my_role() = 'analyst');

-- 030 also added these. `if not exists` makes it free if they are already there.
create index if not exists survey_projects_created_idx    on public.survey_projects (created_at desc);
create index if not exists survey_projects_captain_idx    on public.survey_projects (captain_id);
create index if not exists survey_projects_client_idx     on public.survey_projects (client_id);
create index if not exists survey_projects_cocaptains_idx on public.survey_projects using gin (co_captain_ids);

commit;

-- VERIFY with real JWTs — scripts/_030-check.mjs does exactly this. Every one of
-- the six must return 0 rows for BOTH alex@alpharoc.ai and
-- eric.albert@holoceneadvisors.com. Anything else means a policy survived.
--
-- Then confirm nothing broke: sign in as an analyst and open a project's
-- Activity tab and its history, and open the compliance portal as
-- eric.albert@holoceneadvisors.com and load a review.
