-- 123: the two single-table sales views become read-only, and mean it.
--
-- WHY. Supabase's default privileges hand every new object in the public
-- schema ALL rights: SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and
-- TRIGGER, to anon, authenticated and service_role alike (111 notes the same
-- default). 105 and 118 granted SELECT and revoked anon, but never took the
-- write rights away from authenticated.
--
-- That matters for exactly two views. Postgres makes a view writable on its
-- own when it reads one table with no join, aggregate or DISTINCT, and a
-- definer view (the default) writes to its table AS ITS OWNER, past the
-- table's row-level security:
--   - sales_clients (105; display_name added in 122) reads clients alone. A
--     signed-in salesperson could most likely PATCH display_name (the name
--     printed on every client document), name, code or salesperson (moving an
--     account into another book), and INSERT or DELETE accounts, with no
--     analyst involved.
--   - sales_deliverables (118) reads deliverables alone (its scope is an
--     EXISTS condition, which does not stop a view being writable). The same
--     salesperson could rewrite a filed deliverable's link, rename it, or
--     delete it.
-- The other sales views join or group (sales_projects, sales_contacts,
-- sales_terms, sales_n_collected_freshness), so Postgres never lets them be
-- written through, and they are left alone.
--
-- Nothing in the app or the connector writes through either view: every use is
-- a select (checked 2026-09-27). The write was not proven with a real request,
-- because proving it would take one; the revoke is right either way, and
-- section 2 asserts the end state.
--
-- This was drafted as a section 2b of 122, AFTER 122 had already been applied,
-- so it lives here instead: an applied migration file is never edited.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable, no data change.
begin;

-- ---------------------------------------------------------------------------
-- 1) Revoke everything, grant back SELECT alone. Inside this transaction there
--    is no moment where a signed-in user cannot read the view.
-- ---------------------------------------------------------------------------
revoke all on public.sales_clients from anon, authenticated, public;
grant select on public.sales_clients to authenticated;

revoke all on public.sales_deliverables from anon, authenticated, public;
grant select on public.sales_deliverables to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Prove it, inside the transaction, so a failure rolls everything back.
--    has_table_privilege answers for the role as it actually is, including
--    anything it holds through PUBLIC, which a grants listing may not show.
-- ---------------------------------------------------------------------------
do $check$
declare
  v text;
  p text;
begin
  foreach v in array array['public.sales_clients', 'public.sales_deliverables'] loop
    foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('authenticated', v, p) then
        raise exception '123: authenticated still holds % on %', p, v;
      end if;
      if has_table_privilege('anon', v, p) then
        raise exception '123: anon still holds % on %', p, v;
      end if;
    end loop;
    if not has_table_privilege('authenticated', v, 'SELECT') then
      raise exception '123: authenticated lost select on %', v;
    end if;
    if has_table_privilege('anon', v, 'SELECT') then
      raise exception '123: anon can read %', v;
    end if;
  end loop;
end $check$;

commit;

notify pgrst, 'reload schema';

-- VERIFY (reading, not trusting; the asserts above already ran). In the SQL
-- editor, expect exactly two rows, both SELECT:
--   select table_name, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and grantee = 'authenticated'
--      and table_name in ('sales_clients', 'sales_deliverables');
