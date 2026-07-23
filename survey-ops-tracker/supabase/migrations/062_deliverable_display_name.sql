-- 062: Deliverable display-name override.
-- Analysts can rename what the tracker shows for a deliverable without touching
-- the real file in the client's Shared Drive. null = fall back to the auto name
-- (file_name / original_file_name). This is a display label, not a filename.
alter table public.deliverables
  add column if not exists display_name text;
