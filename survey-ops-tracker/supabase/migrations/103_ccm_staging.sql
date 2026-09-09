-- 103: park the CCM export where it survives, without importing it.
--
-- David: "ccm contract: hold for now, but make sure the metadata is saved
-- somewhere so we can import if/when ready."
--
-- WHY THE DATABASE AND NOT THE REPO. This repo commits no CSV, no XLSX and has
-- no data/ directory — data lives in Postgres, code lives in git, and a
-- spreadsheet of client contacts and contract values is exactly the thing not to
-- break that convention for. Postgres is also backed up, whereas the source file
-- currently exists only in one Downloads folder.
--
-- INERT BY DESIGN. Nothing reads these tables. No view, no policy for
-- authenticated, no app code. They hold the export so that promoting it later is
-- a SQL step against data we already have, rather than re-parsing a spreadsheet
-- that may have moved.
--
-- WHAT THE EXPORT ACTUALLY CONTAINS (measured against ccm-data-2026-07-20.xlsx
-- and today's production, not assumed):
--
--   Contracts  48 rows — ALL 48 match a live SOCC client.
--                        28 carry credits; 46,085 credits in total.
--                        Only 4 of 48 carry a contract date.
--                        0 of 48 carry a dollar value.
--   Users     138 rows — 81 are contacts SOCC does not already have.
--   Clients    75 rows — all 75 already exist in SOCC; nothing to import. The
--                        Relationship Manager column was already imported
--                        separately (scripts/import-ccm-account-owners.mjs).
--   Studies   221 rows — 205 match a live survey, and EVERY ONE HAS Cost = 0.
--
-- THAT LAST LINE IS THE IMPORTANT ONE, so it is recorded here rather than
-- rediscovered: there is NO per-survey credit consumption in CCM. Not "sparse" —
-- zero, across all 221 rows. So importing CCM gives us the ALLOWANCE side (what
-- each client bought) and nothing at all of the CONSUMPTION side (what each
-- survey drew down). Consumption has to be captured going forward, which matches
-- the decision already taken — credits are entered when scope is confirmed.
-- There is deliberately no staging table for Studies: a table of 221 zeroes
-- would imply there is something to migrate.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable, creates no
-- rows — scripts/load-ccm-staging.mjs fills them.
begin;

-- ---------------------------------------------------------------------------
-- 1) Contracts — the future client_terms.
--
--    socc_client_id is resolved AT LOAD TIME and stored, rather than being
--    matched again at promote time: the client list drifts (renames, merges),
--    and a match made against today's names is the one that was actually
--    verified. promoted_at records that a row became a real term, so a re-run
--    cannot create it twice.
-- ---------------------------------------------------------------------------
create table if not exists public.ccm_contract_staging (
  ccm_contract_id  int primary key,
  ccm_client_id    int,
  client_name      text not null,
  client_code      text,
  socc_client_id   uuid references public.clients(id) on delete set null,
  contract_name    text,
  project_code     text,
  contract_date    date,
  renewal_date     date,
  -- NULL, not 0, where CCM recorded nothing. 20 of the 48 have no credits and
  -- that is "not recorded on this contract", not "this contract bought none" —
  -- the distinction this codebase keeps paying for getting wrong.
  credits          int,
  dollars          numeric(12,2),
  promoted_at      timestamptz,
  promoted_term_id uuid references public.client_terms(id) on delete set null,
  imported_at      timestamptz not null default now(),
  source_file      text
);

comment on table public.ccm_contract_staging is
  'Inert landing table for the CCM contract export (48 rows, 46,085 credits). Nothing reads it. Promote into client_terms when David gives the word; only 4 of 48 carry a date, so a promote needs a decision about undated terms.';

-- ---------------------------------------------------------------------------
-- 2) Users — the future client_contacts. 81 of the 138 are new to SOCC.
-- ---------------------------------------------------------------------------
create table if not exists public.ccm_contact_staging (
  ccm_user_id        int primary key,
  ccm_client_id      int,
  client_name        text not null,
  client_code        text,
  socc_client_id     uuid references public.clients(id) on delete set null,
  full_name          text,
  email              text,
  -- Whether SOCC already had this email when the export was staged. Recorded
  -- rather than recomputed so the promote step can report "81 new" without
  -- re-deriving it against a roster that has moved on since.
  already_in_socc    boolean not null default false,
  promoted_at        timestamptz,
  promoted_contact_id uuid references public.client_contacts(id) on delete set null,
  imported_at        timestamptz not null default now(),
  source_file        text
);

comment on table public.ccm_contact_staging is
  'Inert landing table for the CCM user export (138 rows, 81 not already in SOCC). Nothing reads it. Promote into client_contacts when wanted.';

-- ---------------------------------------------------------------------------
-- 3) LOCK BOTH DOWN.
--
--    RLS on, and the ONLY policy is service_role. No authenticated policy at
--    all, so every signed-in user — analyst, sales, compliance — is denied by
--    default. These carry client contact emails and contract values; the app has
--    no reason to read them and neither does anyone's browser.
-- ---------------------------------------------------------------------------
alter table public.ccm_contract_staging enable row level security;
alter table public.ccm_contact_staging  enable row level security;

drop policy if exists ccm_contract_staging_service on public.ccm_contract_staging;
create policy ccm_contract_staging_service on public.ccm_contract_staging
  for all to service_role using (true) with check (true);

drop policy if exists ccm_contact_staging_service on public.ccm_contact_staging;
create policy ccm_contact_staging_service on public.ccm_contact_staging
  for all to service_role using (true) with check (true);

-- Belt and braces: RLS protects rows, but a table-level grant to `authenticated`
-- would still let PostgREST answer (with 0 rows). Revoking makes the intent
-- unambiguous and means a future policy added by mistake grants nothing.
revoke all on public.ccm_contract_staging from anon, authenticated;
revoke all on public.ccm_contact_staging  from anon, authenticated;

commit;

-- Load with:  node scripts/load-ccm-staging.mjs "<path to ccm-data.xlsx>"
--             node scripts/load-ccm-staging.mjs "<path>" --apply
--
-- Verify it stayed private (both should return 0 rows / an error, never data):
--   curl -s "$SUPABASE_URL/rest/v1/ccm_contract_staging?select=*" \
--     -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
