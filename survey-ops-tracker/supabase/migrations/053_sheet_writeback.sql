-- 053_sheet_writeback.sql — sync state for the SOCC->Surveys write-back.
-- sheet_synced_hash = FNV hash of the last-written mapped payload (change detection);
-- null = never written. sheet_synced_at = last successful write (observability). Additive.
-- Applied manually by David in the Supabase SQL editor (feature stays dark until then).
alter table public.survey_projects add column if not exists sheet_synced_at   timestamptz;
alter table public.survey_projects add column if not exists sheet_synced_hash text;
