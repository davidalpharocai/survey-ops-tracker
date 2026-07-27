-- 065: allow one email (Message-ID) to be logged on more than one project.
--
-- Case (David, 2026-07-24): a single email chain references two surveys — an
-- analyst can "Also log here" from a project's Activity timeline to copy the
-- email onto a second survey. Uniqueness moves from a GLOBAL external_id to
-- per-(project_id, external_id): a forward still can't double-log within one
-- project, but a deliberate copy can land on a second project.
--
-- 013 created project_activity_external_idx as UNIQUE(external_id) WHERE
-- external_id IS NOT NULL. Swap it for the composite. Idempotent.

drop index if exists public.project_activity_external_idx;

create unique index if not exists project_activity_project_external_idx
  on public.project_activity (project_id, external_id)
  where external_id is not null;
