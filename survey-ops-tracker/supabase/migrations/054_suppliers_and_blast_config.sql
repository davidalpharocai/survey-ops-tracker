-- 054_suppliers_and_blast_config.sql — PS Suppliers model + B2B blast lifecycle.
-- Adds a global suppliers catalog + per-project supplier CPI/cap (PS planning),
-- and blast reward/schedule/status (B2B create-then-send). Rewires actual_spend to
-- count only SENT blasts and include the per-respondent incentive. Additive; the
-- old project_bids ($/bid log) table is left dormant. Applied manually by David.
begin;

-- 1) Global suppliers catalog (PureSpectrum sample suppliers). Analyst-editable.
create table if not exists public.suppliers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);
alter table public.suppliers enable row level security;
revoke all on public.suppliers from anon, authenticated;
grant select, insert, update on public.suppliers to authenticated;
grant all on public.suppliers to service_role;
drop policy if exists suppliers_analyst_rw on public.suppliers;
create policy suppliers_analyst_rw on public.suppliers for all to authenticated
  using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');
drop policy if exists suppliers_service_all on public.suppliers;
create policy suppliers_service_all on public.suppliers for all to service_role using (true) with check (true);
insert into public.suppliers (name) values
  ('Branded Research'), ('DISQO'), ('Fusion'), ('Prime Insights API')
  on conflict (name) do nothing;

-- 2) Per-project supplier selection with CPI + completes cap.
create table if not exists public.project_suppliers (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.survey_projects(id) on delete cascade,
  supplier_id   uuid not null references public.suppliers(id),
  cpi           numeric(10,2) not null default 0,
  completes_cap integer not null default 1000,
  created_by    text,
  created_at    timestamptz not null default now(),
  unique (project_id, supplier_id)
);
alter table public.project_suppliers enable row level security;
revoke all on public.project_suppliers from anon, authenticated;
grant select, insert, update, delete on public.project_suppliers to authenticated;
grant all on public.project_suppliers to service_role;
drop policy if exists project_suppliers_analyst_rw on public.project_suppliers;
create policy project_suppliers_analyst_rw on public.project_suppliers for all to authenticated
  using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');
drop policy if exists project_suppliers_service_all on public.project_suppliers;
create policy project_suppliers_service_all on public.project_suppliers for all to service_role using (true) with check (true);
create index if not exists project_suppliers_project_idx on public.project_suppliers (project_id);

-- audit: supplier_added / supplier_changed / supplier_removed (mirrors audit_project_blast)
create or replace function public.audit_project_supplier() returns trigger language plpgsql security definer
set search_path = public as $$
declare pid uuid; sname text; act text; detail text;
begin
  pid := coalesce(new.project_id, old.project_id);
  select name into sname from public.suppliers where id = coalesce(new.supplier_id, old.supplier_id);
  if tg_op = 'INSERT' then act := 'supplier_added'; detail := sname || ' @ $' || new.cpi || ' cap ' || new.completes_cap;
  elsif tg_op = 'DELETE' then act := 'supplier_removed'; detail := sname;
  else act := 'supplier_changed'; detail := sname || ' @ $' || new.cpi || ' cap ' || new.completes_cap;
  end if;
  insert into public.project_audit (project_id, field, new_value, changed_by)
    values (pid, act, detail, coalesce(auth.email(), 'system'));
  return coalesce(new, old);
end $$;
drop trigger if exists trg_audit_project_supplier on public.project_suppliers;
create trigger trg_audit_project_supplier after insert or update or delete on public.project_suppliers
  for each row execute function public.audit_project_supplier();

-- 3) Blast lifecycle + incentive. status defaults 'sent' so existing rows keep
--    counting with no backfill; new queued/scheduled blasts don't count until sent.
alter table public.project_blasts add column if not exists reward       numeric(10,2) not null default 0;
alter table public.project_blasts add column if not exists scheduled_at timestamptz;
alter table public.project_blasts add column if not exists status       text not null default 'sent';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'project_blasts_status_chk') then
    alter table public.project_blasts add constraint project_blasts_status_chk
      check (status in ('queued','scheduled','sent'));
  end if;
end $$;

-- 4) Spend = SENT blasts only, now including the per-respondent incentive.
create or replace function public.sync_blast_spend() returns trigger language plpgsql security definer
set search_path = public as $$
declare pid uuid;
begin
  pid := coalesce(new.project_id, old.project_id);
  update public.survey_projects set actual_spend = coalesce((
    select sum(delivered * bid + blast_cost + delivered * reward)
    from public.project_blasts where project_id = pid and status = 'sent'
  ), 0) where id = pid;
  return null;
end $$;

commit;
