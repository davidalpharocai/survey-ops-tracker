-- 030: SECURITY — close the cross-tenant leak on the project child tables,
-- and add the missing survey_projects indexes.
--
-- Migration 008 scoped the parent tables (survey_projects, clients, …) to
-- analysts and built the safe portal_projects view, but the child tables were
-- created with open `to authenticated using (true)` policies. External
-- compliance reviewers hold real authenticated sessions, so they (or anyone
-- with a leaked magic link) could read every client's bids, email bodies,
-- internal notes, and the full budget/spend audit history via the REST API.
-- Lock all of these to analysts only — compliance has no business here.
-- (Inserts on these tables happen via the browser as an analyst, or via
-- service-role triggers/webhooks which bypass RLS.)

-- project_activity (full email bodies)
drop policy if exists "authenticated can read activity" on public.project_activity;
drop policy if exists "authenticated can insert activity" on public.project_activity;
create policy "analysts read activity" on public.project_activity
  for select to authenticated using (public.my_role() = 'analyst');
create policy "analysts insert activity" on public.project_activity
  for insert to authenticated with check (public.my_role() = 'analyst');

-- project_bids (rates)
drop policy if exists "authenticated full access bids" on public.project_bids;
create policy "analysts full access bids" on public.project_bids
  for all to authenticated
  using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');

-- project_steps (next steps)
drop policy if exists "authenticated full access steps" on public.project_steps;
create policy "analysts full access steps" on public.project_steps
  for all to authenticated
  using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');

-- project_data_changes (engineer notes)
drop policy if exists "authenticated full access data changes" on public.project_data_changes;
create policy "analysts full access data changes" on public.project_data_changes
  for all to authenticated
  using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');

-- project_seen (NEW! badge bookkeeping)
drop policy if exists "authenticated full access seen" on public.project_seen;
create policy "analysts full access seen" on public.project_seen
  for all to authenticated
  using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');

-- project_audit (the financial change history — most sensitive of all).
-- Inserts come only from security-definer triggers; the existing
-- "service role full audit" policy stays. Reads → analysts only.
drop policy if exists "authenticated read audit" on public.project_audit;
create policy "analysts read audit" on public.project_audit
  for select to authenticated using (public.my_role() = 'analyst');

-- ---- Missing indexes on survey_projects (only the PK existed) ----
create index if not exists survey_projects_created_idx on public.survey_projects (created_at desc);
create index if not exists survey_projects_captain_idx on public.survey_projects (captain_id);
create index if not exists survey_projects_client_idx on public.survey_projects (client_id);
create index if not exists survey_projects_cocaptains_idx on public.survey_projects using gin (co_captain_ids);
