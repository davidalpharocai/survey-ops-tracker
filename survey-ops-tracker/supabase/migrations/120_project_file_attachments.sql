-- 120_project_file_attachments.sql
--
-- Attach a FILE to a survey record, beside the links it already holds.
--
-- David, 2026-09-23: "for linking docs on a survey record, can we make it so one
-- can attach something as well?"
--
-- ALREADY APPLIED IN EFFECT. The bucket below was created on 2026-09-23 with
-- the service role via scripts/create-project-files-bucket.mjs, so the feature
-- works without waiting on a paste. This file is the record, and re-running it
-- is a no-op. Run it anyway when convenient, so the schema history is complete.
--
-- ── WHY A NEW BUCKET AND NOT public.deliverables ────────────────────────────
-- `deliverables` is the CLIENT-FACING register: files filed into the client's
-- own Shared Drive folder, logged as outbound activity, and -- since migration
-- 118 -- readable by the salesperson who owns the account. Measured today, a
-- sales session can read 103 of them.
--
-- An attachment is the opposite thing: a questionnaire draft, a screenshot, a
-- half-finished tab plan. Filing those into `deliverables` would have published
-- every one of them to sales the moment it was uploaded, on an in-flight survey,
-- whatever the UI chose to render. So they go somewhere sales cannot reach at
-- all.
--
-- ── WHY NO STORAGE POLICIES ─────────────────────────------------------------
-- Nothing but the server ever touches this bucket. app/api/project-files
-- uploads and signs with the service role after checking the caller is an
-- analyst, exactly as app/api/parse-questionnaire does for the `questionnaires`
-- bucket. No browser holds a credential for it, so there is no client-side
-- request for a policy to govern.
--
-- That is a deliberate difference from 008, which DID write policies for
-- `questionnaires` because the compliance portal reads that bucket directly.
-- Nothing reads this one directly, and adding a permissive policy "to be safe"
-- would be the only way a sales or compliance session could ever see these
-- files. If a later change does need direct reads, the policy must test
-- `public.my_role() = 'analyst'` -- and only that.
--
-- ── WHAT IS STORED, AND WHERE THE REFERENCE LIVES ───────────────────────────
-- Bytes here; the reference is an ordinary entry in
-- `survey_projects.linked_documents`, shaped `{name, url, fmt}` like every
-- pasted link, with url = '/api/project-files?path=<storage path>'. No new
-- column and no new table -- which is what lets rename, remove and reorder keep
-- working unchanged. An entry carrying extra fields would have lost them the
-- first time anyone renamed it, because the rename handler rebuilds an entry
-- from exactly those three.
--
-- Path convention: {project_id}/{timestamp}-{safe filename}, matching 008.

begin;

insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', false)
on conflict (id) do nothing;

do $a$
declare is_public boolean;
begin
  select public into is_public from storage.buckets where id = 'project-files';

  if is_public is null then
    raise exception '120: the project-files bucket was not created';
  end if;

  -- The one property that matters. A public bucket would serve every internal
  -- working file to anyone holding the url, with no session at all.
  if is_public then
    raise exception '120: the project-files bucket is PUBLIC; these are internal files';
  end if;

  -- No policy may hand this bucket to a non-analyst. Nothing should reference it
  -- at all today, so any match is a mistake worth stopping for.
  if exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and (coalesce(qual, '') like '%project-files%' or coalesce(with_check, '') like '%project-files%')
       and coalesce(qual, '') || coalesce(with_check, '') not like '%analyst%'
  ) then
    raise exception '120: a storage policy exposes project-files without an analyst check';
  end if;
end $a$;

commit;

-- VERIFY:
--   select id, public from storage.buckets where id = 'project-files';  -- f
--   Then attach a file on any project and confirm the row renders with a 📎
--   rather than a 📄, and that the link opens for you and 404s for a sales login.
