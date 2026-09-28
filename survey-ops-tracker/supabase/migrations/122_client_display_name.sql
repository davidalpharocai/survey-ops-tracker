-- 122: the client's name as printed on client documents.
--
-- WHY. The Survey Activity Statement and the Survey List go to the client, and
-- they print "Prepared for <name>" in the letterhead and in the footer of every
-- page. Until now the only name on an account was our INTERNAL label: "DE Shaw",
-- where the client calls itself "The D. E. Shaw Group". The print page asks the
-- salesperson to type the proper name each time, and forgets it. This column
-- keeps it: an analyst sets it once on the client page, and every print fills
-- it in.
--
-- NULL means "not set": the documents print the internal name and the pre-send
-- checklist says so. A blank string is not allowed, so "set to nothing" cannot
-- masquerade as a name.
--
-- WHO SEES IT. Analysts read and write it on clients (008 read, 038 update).
-- The sales tier reads it through sales_clients (105), which is an explicit
-- column allowlist: a column added to clients is invisible to sales until a
-- migration adds it there, which is what section 2 does. It is the client's
-- own public name, so it is safe for sales to see.
--
-- NOTHING DEPENDS ON THIS HAVING RUN. The app reads clients and sales_clients
-- with select('*') and treats a missing display_name as "not set", and every
-- write path (the client page, the connector) refuses with a clear message
-- before this is applied rather than failing silently.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable, no data change.
begin;

-- ---------------------------------------------------------------------------
-- 1) The column, with a guard against blank and absurd values.
-- ---------------------------------------------------------------------------
alter table public.clients add column if not exists display_name text;

alter table public.clients drop constraint if exists clients_display_name_sane;
alter table public.clients add constraint clients_display_name_sane
  check (display_name is null or (length(btrim(display_name)) between 1 and 200));

comment on column public.clients.display_name is
  'Name as printed on client documents (the Survey Activity Statement and the Survey List), for example The D. E. Shaw Group. Null means print the internal name. Set by analysts on the client page or via the connector update_client tool; read by the sales tier through sales_clients (122).';

-- ---------------------------------------------------------------------------
-- 2) Expose it to the sales tier.
--
--    CREATE OR REPLACE, not drop and create: replacing keeps the view's grants,
--    where drop and create resets them to PUBLIC defaults. Postgres only lets a
--    replacement ADD columns at the END, with the existing ones unchanged in
--    name, type and order, so display_name goes last. The body is otherwise 105
--    exactly: definer view, security_barrier, self-scoped to this salesperson.
-- ---------------------------------------------------------------------------
create or replace view public.sales_clients
with (security_barrier) as
select c.id, c.name, c.code, c.salesperson, c.created_at, c.display_name
  from public.clients c
 where public.my_role() = 'sales'
   and c.deleted_at is null
   and c.salesperson = public.my_salesperson_name();

comment on view public.sales_clients is
  'Column-restricted, self-scoped projection of clients for the sales tier (105, display_name added in 122). Definer + security_barrier, mirroring sales_projects. Excludes the compliance_* group and drive_folder_id. Adding a column here makes it visible to every salesperson.';

-- The same grants as 105, re-issued anyway: cheap, and it means a view that was
-- ever dropped and recreated by hand ends in the right state regardless.
grant select on public.sales_clients to authenticated;
revoke all on public.sales_clients from anon;

-- ---------------------------------------------------------------------------
-- 3) Prove it, inside the transaction, so a failure rolls everything back.
-- ---------------------------------------------------------------------------
do $check$
declare n int;
begin
  -- The column exists on clients, as text.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'clients'
     and column_name = 'display_name' and data_type = 'text';
  if n <> 1 then raise exception '122: clients.display_name is missing or not text'; end if;

  -- The view exposes it, LAST, after the five columns 105 defined.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'sales_clients'
     and column_name = 'display_name' and ordinal_position = 6;
  if n <> 1 then raise exception '122: sales_clients does not expose display_name as its sixth column'; end if;

  -- And nothing else crept in: exactly the allowlist.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'sales_clients';
  if n <> 6 then raise exception '122: sales_clients has % columns, expected 6', n; end if;

  -- The withheld group is still withheld.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'sales_clients'
     and (column_name like 'compliance%' or column_name = 'drive_folder_id');
  if n <> 0 then raise exception '122: sales_clients exposes % withheld column(s)', n; end if;

  -- Still a security_barrier view.
  select count(*) into n from pg_class
   where oid = 'public.sales_clients'::regclass
     and reloptions @> array['security_barrier=true'];
  if n <> 1 then raise exception '122: sales_clients lost security_barrier'; end if;

  -- Signed-in users can read it; anon cannot.
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'sales_clients'
     and grantee = 'authenticated' and privilege_type = 'SELECT';
  if n <> 1 then raise exception '122: authenticated cannot select sales_clients'; end if;

  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'sales_clients' and grantee = 'anon';
  if n <> 0 then raise exception '122: anon still holds % grant(s) on sales_clients', n; end if;
end $check$;

commit;

-- The view changed SHAPE, so PostgREST's cached schema would otherwise answer
-- "column sales_clients.display_name does not exist" to the next request.
notify pgrst, 'reload schema';

-- VERIFY (reading, not trusting; the asserts above already ran):
--
--   As an analyst, on the client page: set "Name as printed on client
--   documents" for DE Shaw to The D. E. Shaw Group, reload, and it is still there.
--
--   As Alex (scripts/_alex-link.mjs mints a JWT):
--     GET /rest/v1/sales_clients?select=id,name,display_name&limit=3
--       -> 200, display_name present (null on accounts nobody has set).
--     GET /rest/v1/sales_clients?select=compliance_notes
--       -> 42703, still withheld.
--
--   Then open /sales/accounts/<DE Shaw id>/print: the name field is pre-filled
--   and the "No client-facing name" item is gone from the checklist.
