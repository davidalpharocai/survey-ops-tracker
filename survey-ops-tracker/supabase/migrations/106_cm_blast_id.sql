-- 106: a stable key for blasts imported from Campaign Manager.
--
-- The CSV export carries `blast_id`, Campaign Manager's own unique id for a
-- blast. Storing it makes the bulk import re-runnable and — more importantly —
-- lets it recognise a blast SOCC already has instead of adding a second copy.
--
-- WHY NOT REUSE `idem_key`. project_blasts already has one, and it very nearly
-- fits. Two reasons it does not:
--
--   1. idem_key is unique per (project_id, idem_key). A Campaign Manager blast
--      id is unique GLOBALLY, and that difference is load-bearing here: two SOCC
--      projects currently share the survey id B2B_BFCOATUEAIBUYER20260601
--      (PR00003 "AI Infrastructure - 1st Run" and PR00202 "2nd Run"). A
--      per-project key would happily write the same 15 blasts to both and double
--      $9,700 of spend. A global unique index makes that attempt fail loudly
--      instead.
--   2. idem_key is already in use, and its values are human conventions like
--      "mBmOEVt7Mj79#Blast4". Overloading it with a machine id would make the
--      column mean two things, and the hand-logged blasts this import must ADOPT
--      are exactly the rows already carrying the human form.
--
-- So the two coexist: idem_key stays the connector's caller-chosen key, and
-- cm_blast_id is the platform's identity. A hand-logged blast that the import
-- matches keeps its idem_key and GAINS a cm_blast_id.
--
-- Nullable, because every blast logged in the app or through the connector has
-- no Campaign Manager id and never will. The unique index is PARTIAL for the
-- same reason 101's was: it constrains only the rows that carry one.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable, no data change.
begin;

alter table public.project_blasts
  add column if not exists cm_blast_id integer;

comment on column public.project_blasts.cm_blast_id is
  'Campaign Manager''s own unique blast id, set only by the CSV bulk import (scripts/import-cm-blasts.mjs). Globally unique where present, so the same platform blast cannot be written to two SOCC projects — which matters because some survey ids currently map to two projects. NULL for every blast logged in the app or via the connector.';

create unique index if not exists project_blasts_cm_blast_id_uq
  on public.project_blasts (cm_blast_id)
  where cm_blast_id is not null;

commit;

-- Verify:
--   select count(*) filter (where cm_blast_id is not null) as imported,
--          count(*)                                        as total
--     from public.project_blasts;
--   -> 0 | 109   before the import runs.
