-- ============ Replace open policies with role-scoped ones ============

-- team_members: internal only now
drop policy "authenticated users can read team members" on public.team_members;
create policy "analysts read team members"
  on public.team_members for select to authenticated
  using (public.my_role() = 'analyst');

-- survey_projects: analysts keep full access; compliance gets NO direct
-- table access (they use the portal_projects view below)
drop policy "authenticated users can read projects" on public.survey_projects;
drop policy "authenticated users can insert projects" on public.survey_projects;
drop policy "authenticated users can update projects" on public.survey_projects;

create policy "analysts read projects"
  on public.survey_projects for select to authenticated
  using (public.my_role() = 'analyst');
create policy "analysts insert projects"
  on public.survey_projects for insert to authenticated
  with check (public.my_role() = 'analyst');
create policy "analysts update projects"
  on public.survey_projects for update to authenticated
  using (public.my_role() = 'analyst');

-- ============ New tables ============

-- Submission -> client lookup for policies (security definer: avoids
-- re-evaluating question_submissions RLS inside the questions policy)
create or replace function public.submission_client_id(sid uuid)
returns uuid language sql stable security definer set search_path = public as
$$ select p.client_id from public.question_submissions qs
   join public.survey_projects p on p.id = qs.project_id
   where qs.id = sid $$;

-- Storage-path -> client lookup. Compares id::text so malformed folder
-- names return NULL (fail closed) instead of raising a uuid cast error.
create or replace function public.path_project_client_id(folder text)
returns uuid language sql stable security definer set search_path = public as
$$ select client_id from public.survey_projects where id::text = folder $$;

revoke execute on function public.submission_client_id(uuid) from anon, public;
revoke execute on function public.path_project_client_id(text) from anon, public;
grant execute on function public.submission_client_id(uuid) to authenticated;
grant execute on function public.path_project_client_id(text) to authenticated;

-- clients
create policy "analysts full read clients" on public.clients for select to authenticated
  using (public.my_role() = 'analyst');
create policy "analysts insert clients" on public.clients for insert to authenticated
  with check (public.my_role() = 'analyst');
create policy "compliance reads own client" on public.clients for select to authenticated
  using (id = public.my_client_id());

-- profiles: users read their own row; analysts read all
create policy "read own profile" on public.profiles for select to authenticated
  using (id = auth.uid());
create policy "analysts read profiles" on public.profiles for select to authenticated
  using (public.my_role() = 'analyst');

-- question_submissions
create policy "analysts read submissions" on public.question_submissions for select to authenticated
  using (public.my_role() = 'analyst');
create policy "compliance reads own submissions" on public.question_submissions for select to authenticated
  using (public.my_role() = 'compliance'
         and public.project_client_id(project_id) = public.my_client_id());
create policy "compliance decides pending submissions" on public.question_submissions
  for update to authenticated
  using (public.my_role() = 'compliance'
         and status = 'pending_review'
         and public.project_client_id(project_id) = public.my_client_id())
  with check (public.project_client_id(project_id) = public.my_client_id()
              and reviewed_by = auth.uid());

-- Column-level safety: authenticated users may only update decision fields.
-- (Analysts never update submissions; new versions are new rows via service role.)
revoke update on public.question_submissions from authenticated;
grant update (status, reviewed_by, reviewed_at, review_note)
  on public.question_submissions to authenticated;

-- questions (insert happens via service role in API routes)
create policy "analysts read questions" on public.questions for select to authenticated
  using (public.my_role() = 'analyst');
create policy "compliance reads own questions" on public.questions for select to authenticated
  using (public.my_role() = 'compliance'
         and public.submission_client_id(submission_id) = public.my_client_id());

-- project_recipients: analysts only (managed in internal app)
create policy "analysts manage recipients" on public.project_recipients for all to authenticated
  using (public.my_role() = 'analyst')
  with check (public.my_role() = 'analyst');

-- notification_log: analysts read; writes via service role only
create policy "analysts read notification log" on public.notification_log for select to authenticated
  using (public.my_role() = 'analyst');

-- ============ Portal view: safe columns only ============
-- Owned by postgres => bypasses survey_projects RLS, so the WHERE clause
-- does the scoping. Exposes no budget/spend/internal fields.
create view public.portal_projects
with (security_barrier) as
select id, project_name, client_id, submitted_date, launch_date, due_date, created_at
from public.survey_projects
where public.my_role() = 'compliance'
  and client_id = public.my_client_id();

grant select on public.portal_projects to authenticated;
revoke all on public.portal_projects from anon;

-- ============ Storage bucket for questionnaire files ============
insert into storage.buckets (id, name, public) values ('questionnaires', 'questionnaires', false)
on conflict (id) do nothing;

-- Path convention: {project_id}/{timestamp}-{filename}
-- Analysts read and upload; deletes/updates stay with the service role so
-- audit-referenced source files can't be removed from the client side
create policy "analysts read questionnaire files" on storage.objects
  for select to authenticated
  using (bucket_id = 'questionnaires' and public.my_role() = 'analyst');

create policy "analysts upload questionnaire files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'questionnaires' and public.my_role() = 'analyst');

create policy "compliance reads own client files" on storage.objects
  for select to authenticated
  using (bucket_id = 'questionnaires'
         and public.my_role() = 'compliance'
         and public.path_project_client_id((storage.foldername(name))[1]) = public.my_client_id());
