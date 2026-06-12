-- Submissions are held for a recall window before compliance can see them.
-- dispatched_at null = still in the window (or awaiting auto-dispatch).
alter table public.question_submissions add column dispatched_at timestamptz;

-- Everything submitted before this feature was sent immediately
update public.question_submissions set dispatched_at = submitted_at;

create or replace function public.submission_dispatched(sid uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select dispatched_at is not null from public.question_submissions where id = sid $$;
revoke execute on function public.submission_dispatched(uuid) from anon, public;
grant execute on function public.submission_dispatched(uuid) to authenticated;

-- Compliance must not see (or decide) undispatched submissions
drop policy "compliance reads own submissions" on public.question_submissions;
create policy "compliance reads own submissions" on public.question_submissions for select to authenticated
  using (public.my_role() = 'compliance'
         and dispatched_at is not null
         and public.project_client_id(project_id) = public.my_client_id());

drop policy "compliance decides pending submissions" on public.question_submissions;
create policy "compliance decides pending submissions" on public.question_submissions
  for update to authenticated
  using (public.my_role() = 'compliance'
         and status = 'pending_review'
         and dispatched_at is not null
         and public.project_client_id(project_id) = public.my_client_id())
  with check (public.project_client_id(project_id) = public.my_client_id()
              and reviewed_by = auth.uid());

drop policy "compliance reads own questions" on public.questions;
create policy "compliance reads own questions" on public.questions for select to authenticated
  using (public.my_role() = 'compliance'
         and public.submission_client_id(submission_id) = public.my_client_id()
         and public.submission_dispatched(submission_id));
