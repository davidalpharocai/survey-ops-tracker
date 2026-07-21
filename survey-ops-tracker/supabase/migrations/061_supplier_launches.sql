-- 061: PS projects get multiple LAUNCHES (mirror of B2B multi-blast). Each launch
-- owns a set of project_suppliers rows plus its own target N; a project's ESTIMATE
-- = the sum of each launch's range. ACTUAL spend is unchanged — recompute_project_spend
-- still sums Σ(cpi × n_collected) across ALL of a project's supplier rows, so launches
-- are purely a grouping/estimate layer. Applied manually in the Supabase SQL editor (David).
begin;

-- 1) Launches. Display "Launch 1/2/3" is the ordinal position by created_at; `label`
--    gives stable naming when it matters. Analyst-editable (mirrors project_suppliers).
create table if not exists public.project_launches (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.survey_projects(id) on delete cascade,
  label       text,
  launch_date date,
  target      integer,
  created_by  text,
  created_at  timestamptz not null default now()
);
alter table public.project_launches enable row level security;
revoke all on public.project_launches from anon, authenticated;
grant select, insert, update, delete on public.project_launches to authenticated;
grant all on public.project_launches to service_role;
drop policy if exists project_launches_analyst_rw on public.project_launches;
create policy project_launches_analyst_rw on public.project_launches for all to authenticated
  using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');
drop policy if exists project_launches_service_all on public.project_launches;
create policy project_launches_service_all on public.project_launches for all to service_role using (true) with check (true);
create index if not exists project_launches_project_idx on public.project_launches (project_id);

-- 2) Each supplier row now belongs to a launch. Cascade: removing a launch removes its
--    rows (which then re-fires sync_supplier_spend → actual_spend recomputes correctly).
alter table public.project_suppliers
  add column if not exists launch_id uuid references public.project_launches(id) on delete cascade;
create index if not exists project_suppliers_launch_idx on public.project_suppliers (launch_id);

-- 3) Backfill: one launch per project that has launch-less supplier rows; seed its target
--    from the project's internal target (fallback N target) so the current estimate is
--    preserved. Disable the supplier audit trigger for the backfill so it doesn't emit
--    spurious "supplier_changed" rows (the spend trigger stays on; it's idempotent here).
insert into public.project_launches (project_id, target, created_by, created_at)
select distinct ps.project_id, coalesce(sp.n_internal_target, sp.n_target), 'migration 061', now()
from public.project_suppliers ps
join public.survey_projects sp on sp.id = ps.project_id
where ps.launch_id is null;

alter table public.project_suppliers disable trigger trg_audit_project_supplier;
update public.project_suppliers ps
set launch_id = pl.id
from public.project_launches pl
where ps.launch_id is null and pl.project_id = ps.project_id;
alter table public.project_suppliers enable trigger trg_audit_project_supplier;

-- 4) A supplier may now recur ACROSS launches (re-fielded), just not twice within one
--    launch. Swap the old project-wide uniqueness for per-launch uniqueness. (Safe after
--    backfill: each project's rows are in one launch and were unique by supplier there.)
alter table public.project_suppliers drop constraint if exists project_suppliers_project_id_supplier_id_key;
alter table public.project_suppliers add constraint project_suppliers_launch_supplier_key unique (launch_id, supplier_id);

commit;
