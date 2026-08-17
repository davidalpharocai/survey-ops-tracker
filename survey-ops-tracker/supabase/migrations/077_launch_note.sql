-- 077: PS launches get a freeform note — parity with a blast's "description"
-- and a rerun series' "notes". project_launches previously only had
-- label / launch_date / target. Nullable, no backfill. Apply in the Supabase
-- SQL editor.
alter table public.project_launches add column if not exists note text;
