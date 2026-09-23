-- 119_client_terms_writable.sql
--
-- THE ADD-CONTRACT BUTTON HAS NEVER WORKED.
--
-- David, 2026-09-23: "im not able to add contracts on the client page."
--
-- Measured against production with a real analyst JWT, exactly as the browser
-- calls it:
--
--   GET    /rest/v1/client_terms            -> 200, rows
--   POST   /rest/v1/client_terms            -> 403 42501 permission denied
--   PATCH  /rest/v1/client_terms            -> 403 42501 permission denied
--   DELETE /rest/v1/client_terms            -> 403 42501 permission denied
--
-- Postgres printed the fix in its own hint: "GRANT INSERT ON
-- public.client_terms TO authenticated".
--
-- WHY IT BROKE. 100 wrote, at lines 404-406:
--
--     revoke all on public.client_terms from anon, authenticated;
--     grant select on public.client_terms to authenticated;
--
-- and then created exactly one analyst policy, named client_terms_analyst_all
-- but declared `for select`. So the lock was on twice over: the GRANT refuses
-- the write before RLS is consulted, and the policy would refuse it after.
-- The name said "all" and the body said "select", which is why it read as
-- correct in review.
--
-- The sibling table is the control, and it is in the same file: 100 line 165
-- grants `select, insert, update, delete` on client_term_financials, and the
-- same live probe reaches the FK check there (23503) instead of 42501. One
-- table in the pair was writable and the other was not.
--
-- THE CORROBORATION. There is exactly ONE row in client_terms in production,
-- and it carries source='connector'. Every contract that exists was created by
-- the MCP connector, which runs as service_role and bypasses all of this. The
-- form on the client page has never once produced a row.
--
-- WHAT THIS GRANTS, AND WHAT IT DELIBERATELY DOES NOT.
--
--   insert, update  -- yes. The UI needs both: adding a contract inserts, and
--                      "remove" is a SOFT delete, which is an update of
--                      deleted_at like every other record in this app.
--   delete          -- NO. Nothing in the app hard-deletes a contract, and a
--                      contract that surveys point at through term_id must not
--                      be removable out from under them. Least privilege: if a
--                      future hard delete is ever wanted, it should have to
--                      come back here and say so.
--
-- WHO CAN WRITE. Analysts only. The grant is to the coarse `authenticated`
-- role because that is the only role PostgREST connects as; the gate is the
-- policy, which tests my_role() = 'analyst' for exact equality. A sales session
-- fails that test, and 105 already dropped client_terms_sales_read, so sales
-- reaches contracts only through the finance-free sales_terms view and still
-- cannot write one. That is unchanged by this migration and asserted below.

begin;

grant insert, update on public.client_terms to authenticated;

-- The misnamed policy goes. In its place, three that say what they do.
drop policy if exists client_terms_analyst_all on public.client_terms;

drop policy if exists client_terms_analyst_read on public.client_terms;
create policy client_terms_analyst_read on public.client_terms
  for select to authenticated
  using (public.my_role() = 'analyst');

drop policy if exists client_terms_analyst_insert on public.client_terms;
create policy client_terms_analyst_insert on public.client_terms
  for insert to authenticated
  with check (public.my_role() = 'analyst');

-- USING and WITH CHECK both: USING picks which rows may be edited, WITH CHECK
-- what they may be edited into. Without the second an analyst could update a
-- row into a shape the policy would not have admitted.
drop policy if exists client_terms_analyst_update on public.client_terms;
create policy client_terms_analyst_update on public.client_terms
  for update to authenticated
  using (public.my_role() = 'analyst')
  with check (public.my_role() = 'analyst');

-- ---------------------------------------------------------------------------
-- ASSERTS. These run inside the transaction; a failure rolls the whole thing
-- back rather than leaving the table half-opened.
-- ---------------------------------------------------------------------------
do $a$
begin
  if not has_table_privilege('authenticated', 'public.client_terms', 'INSERT') then
    raise exception 'assert failed: authenticated still cannot INSERT client_terms';
  end if;
  if not has_table_privilege('authenticated', 'public.client_terms', 'UPDATE') then
    raise exception 'assert failed: authenticated still cannot UPDATE client_terms';
  end if;
  if not has_table_privilege('authenticated', 'public.client_terms', 'SELECT') then
    raise exception 'assert failed: authenticated lost SELECT on client_terms';
  end if;

  -- Least privilege, stated as a test so a later edit has to break it on purpose.
  if has_table_privilege('authenticated', 'public.client_terms', 'DELETE') then
    raise exception 'assert failed: authenticated has DELETE on client_terms, which nothing needs';
  end if;

  -- anon must stay locked out entirely.
  if has_table_privilege('anon', 'public.client_terms', 'SELECT')
     or has_table_privilege('anon', 'public.client_terms', 'INSERT') then
    raise exception 'assert failed: anon can reach client_terms';
  end if;

  -- RLS still on. A grant without RLS would hand every analyst every client.
  if not (select relrowsecurity from pg_class where oid = 'public.client_terms'::regclass) then
    raise exception 'assert failed: RLS is off on client_terms';
  end if;

  -- The write policies exist and are the analyst ones.
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'client_terms'
         and policyname in ('client_terms_analyst_insert', 'client_terms_analyst_update')) <> 2 then
    raise exception 'assert failed: the analyst write policies are not both present';
  end if;

  -- Nothing readmitted sales to the base table. 105 closed that and this must
  -- not quietly reopen it.
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'client_terms'
                and policyname = 'client_terms_sales_read') then
    raise exception 'assert failed: client_terms_sales_read is back on the base table';
  end if;

  -- And no policy on this table may mention sales at all.
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'client_terms'
                and (coalesce(qual, '') like '%sales%' or coalesce(with_check, '') like '%sales%')) then
    raise exception 'assert failed: a client_terms policy references sales';
  end if;
end $a$;

commit;

notify pgrst, 'reload schema';

-- VERIFY, with a real analyst JWT — scripts/_contract-write-probe.mjs does it:
--
--   POST  /rest/v1/client_terms with a bogus client_id -> 409 23503 (the FK
--         refuses it, so permission passed and nothing was written).
--         42501 means this migration did not land.
--   PATCH /rest/v1/client_terms?id=eq.<bogus>          -> 204.
--
-- And with a SALES JWT, which must be unchanged:
--   GET   /rest/v1/client_terms  -> []
--   POST  /rest/v1/client_terms  -> denied
