-- Soft delete for projects: "Delete" now sets deleted_at instead of removing
-- the row, so a mistaken delete is reversible from the Admin "Recently deleted"
-- view. The app filters deleted_at IS NULL on every project read; the restore
-- view queries deleted_at IS NOT NULL explicitly. A permanent delete (real
-- DELETE) is still available from that view.
alter table public.survey_projects
  add column if not exists deleted_at timestamptz;

-- Partial index: keeps the common "not deleted" reads fast and small.
create index if not exists survey_projects_active_idx
  on public.survey_projects (created_at desc) where deleted_at is null;
