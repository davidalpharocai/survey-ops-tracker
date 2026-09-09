-- 105: the same column leak 102 closed, on the other three sales tables.
--
-- 102 fixed survey_projects and stopped there. The identical hole is open on
-- clients, client_contacts and client_terms, because 100 granted the sales tier
-- the ROW on each and RLS cannot hide a column. Verified with Alex's own JWT on
-- 2026-09-09, after 102 was applied:
--
--   GET /rest/v1/clients?select=name,compliance_notes,compliance_contact,drive_folder_id
--     -> 200, readable
--        {"name":"Citadel","compliance_notes":null,"compliance_contact":null,
--         "drive_folder_id":"1IQnLLyuTcLruLegxq0fkbOwix3RNIZiA"}
--   GET /rest/v1/client_contacts?select=first_name,occam_invited,occam_invited_by,created_by
--     -> 200, readable
--
-- The values sampled are mostly NULL today, which is exactly why this has not
-- bitten yet and exactly why it should be closed now: `compliance_notes` is
-- free-form internal text about a client's compliance posture, and it is empty
-- only because nobody has filled it in. 102 called this class "the group most
-- likely to embarrass somebody".
--
-- No page reads these columns. The hole is in the database, which is the same
-- thing that was true of budget and n_internal_target the day before 102.
--
-- Same pattern as 102, deliberately — one mechanism for this, not two:
--   * a definer view (NOT security_invoker) so it reads past the base-table RLS,
--   * `with (security_barrier)` so a caller-supplied qual cannot be pushed below
--     the scoping,
--   * an explicit column ALLOWLIST, so a column added by a future migration is
--     invisible until someone decides it is safe,
--   * and DROPPING the base-table sales policies, which is the half that
--     actually closes anything.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable, no data change.
--
-- SHIPS WITH THE PAGES THAT READ IT. Nothing reads clients/client_contacts as a
-- sales user today, so unlike 102 there is no ordering hazard: applying this
-- before the deploy breaks nothing.
begin;

-- ---------------------------------------------------------------------------
-- 1) ACCOUNTS.
--
--    IN:  identity, the owner, and when we started working with them.
--    OUT: compliance_before_fielding / compliance_after_fielding /
--         compliance_contact / compliance_notes — our internal compliance
--         posture on that client, including free text written by analysts for
--         analysts; and drive_folder_id, an internal storage handle that is
--         useless to sales and is a live Google Drive id.
-- ---------------------------------------------------------------------------
drop view if exists public.sales_clients;
create view public.sales_clients
with (security_barrier) as
select c.id, c.name, c.code, c.salesperson, c.created_at
  from public.clients c
 where public.my_role() = 'sales'
   and c.deleted_at is null
   and c.salesperson = public.my_salesperson_name();

comment on view public.sales_clients is
  'Column-restricted, self-scoped projection of clients for the sales tier (105). Definer + security_barrier, mirroring sales_projects. Excludes the compliance_* group and drive_folder_id. Adding a column here makes it visible to every salesperson.';

grant select on public.sales_clients to authenticated;
revoke all on public.sales_clients from anon;

-- ---------------------------------------------------------------------------
-- 2) CONTACTS.
--
--    IN:  who they are and how to reach them — the whole point of the page.
--    OUT: occam_invited / occam_invited_at / occam_invited_by (an internal
--         onboarding gate, 071) and created_by (which analyst added the row).
--         `archived` is out too: the view filters on it instead, so an archived
--         contact simply is not there.
--
--    Scoped through the account, since a contact has no salesperson of its own.
-- ---------------------------------------------------------------------------
drop view if exists public.sales_contacts;
create view public.sales_contacts
with (security_barrier) as
select ct.id, ct.client_id, ct.first_name, ct.last_name, ct.email, ct.title,
       ct.phone, ct.created_at
  from public.client_contacts ct
  join public.clients c on c.id = ct.client_id
 where public.my_role() = 'sales'
   and coalesce(ct.archived, false) = false
   and c.deleted_at is null
   and c.salesperson = public.my_salesperson_name();

comment on view public.sales_contacts is
  'Column-restricted, self-scoped projection of client_contacts for the sales tier (105). Scoped through the owning account. Excludes the occam_invited_* onboarding gate and created_by, and filters archived contacts out entirely.';

grant select on public.sales_contacts to authenticated;
revoke all on public.sales_contacts from anon;

-- ---------------------------------------------------------------------------
-- 3) TERMS — the credit allowance a salesperson shows their client.
--
--    IN:  name, credits_total, the dates, and the owning account.
--    OUT: `note` (internal) and `source` (which stamps the import transaction).
--         The DOLLARS are not here to exclude: 100 deliberately put them in
--         client_term_financials, which is finance-gated and already returns 0
--         rows for sales. This view must never grow a dollars column.
--
--    client_terms has 0 rows today, so this ships empty. Built now anyway, in
--    the same migration, so there is one pattern rather than a fourth table
--    added later by a different hand.
-- ---------------------------------------------------------------------------
drop view if exists public.sales_terms;
create view public.sales_terms
with (security_barrier) as
select t.id, t.client_id, t.name, t.credits_total, t.starts_on, t.renews_on, t.created_at
  from public.client_terms t
  join public.clients c on c.id = t.client_id
 where public.my_role() = 'sales'
   and t.deleted_at is null
   and c.deleted_at is null
   and c.salesperson = public.my_salesperson_name();

comment on view public.sales_terms is
  'Column-restricted, self-scoped projection of client_terms for the sales tier (105). CREDITS ONLY — the dollar value of a term lives in client_term_financials, which is finance-gated (086/100). Never add a dollars column here.';

grant select on public.sales_terms to authenticated;
revoke all on public.sales_terms from anon;

-- ---------------------------------------------------------------------------
-- 4) Drop the three base-table sales policies.
--
--    THIS IS THE HALF THAT CLOSES THE LEAK. The views above are a safe door;
--    without this they stand beside an open window.
--
--    After this a sales session reaches these tables only through the views.
--    Analyst policies test my_role() = 'analyst' for exact equality and are
--    untouched; server paths use createAdminClient() and bypass RLS entirely.
-- ---------------------------------------------------------------------------
drop policy if exists clients_sales_read on public.clients;
drop policy if exists client_contacts_sales_read on public.client_contacts;
drop policy if exists client_terms_sales_read on public.client_terms;

commit;

-- VERIFY AS ALEX, with a real user JWT. scripts/_client-column-probe.mjs does this.
--
--   1. The base tables must now be EMPTY for him:
--        GET /rest/v1/clients?select=id          -> []
--        GET /rest/v1/client_contacts?select=id  -> []
--      Anything else means a policy still grants rows.
--
--   2. The withheld columns must be GONE from the views, not null:
--        GET /rest/v1/sales_clients?select=compliance_notes  -> 42703
--        GET /rest/v1/sales_contacts?select=occam_invited    -> 42703
--        GET /rest/v1/sales_terms?select=note                -> 42703
--
--   3. The scope must be unchanged — he owns 27 accounts:
--        GET /rest/v1/sales_clients?select=id    -> 27 rows
