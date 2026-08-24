-- 080: flat vendor cost lines on a project — "SMS/Email Blast" (the platform /
-- delivery fee for pushing a send out the door) and "Contacts Export" (a bought
-- contact pull: ZoomInfo, Apollo, …).
--
-- These are FLAT FEES with a description, NOT quantity × rate: the user types the
-- dollar amount and that IS the number. Deliberate, because the Money card writes
-- this table straight from the browser the way useProjectBlasts does — no RPC in
-- the path — so nothing here may depend on a function to resolve `amount`.
--
-- They are NOT respondent rewards. A respondent reward stays $/bid × # completes
-- on project_blasts; the SMS/Email Blast line is what the sending platform bills
-- us for the send itself, payable whether or not a single person responds. (And
-- it is NOT project_blasts.blast_cost — that 043 column once meant "fixed blast $"
-- and has been dead since 058. See the column comment; do not conflate them.)
--
-- These costs DO count as money spent, so recompute_project_spend gains a third
-- term and project_costs gets its own spend trigger (mirroring project_blasts_spend
-- / project_suppliers_spend). merge_projects is rebuilt from 067 with the one extra
-- re-point so a merge can't strand cost lines on the retired copy.
-- Apply in the Supabase SQL editor (David).
begin;

-- 1) The cost lines. Modelled on project_suppliers (054) / project_blasts (043):
--    analyst-editable, cascade off the project, created_by for attribution.
create table if not exists public.project_costs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.survey_projects(id) on delete cascade,
  kind        text not null,
  amount      numeric(10,2) not null default 0,
  description text,
  incurred_on date,
  created_by  text,
  created_at  timestamptz not null default now(),
  constraint project_costs_kind_chk check (kind in ('sms_email_blast', 'contacts_export'))
);
alter table public.project_costs enable row level security;
revoke all on public.project_costs from anon, authenticated;
grant select, insert, update, delete on public.project_costs to authenticated;
grant all on public.project_costs to service_role;
drop policy if exists project_costs_analyst_rw on public.project_costs;
create policy project_costs_analyst_rw on public.project_costs for all to authenticated
  using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');
drop policy if exists project_costs_service_all on public.project_costs;
create policy project_costs_service_all on public.project_costs for all to service_role using (true) with check (true);
-- Listed per project oldest-first, same as blasts.
create index if not exists project_costs_project_idx on public.project_costs (project_id, created_at);

comment on column public.project_costs.kind is
  'Stored slug; the UI relabels it (same pattern as status Closed → "Archived"). sms_email_blast = the platform/delivery fee for a send, owed whether or not anyone responds — NOT a respondent reward (those are bid × completes on project_blasts) and NOT project_blasts.blast_cost, the dead 043 "fixed blast $" column. contacts_export = a purchased contact list (ZoomInfo, Apollo, …).';
comment on column public.project_costs.amount is
  'The flat vendor fee in dollars, typed by the user — there is no quantity × rate to resolve. The browser INSERTs/UPDATEs this column directly (no RPC), so nothing may depend on a function to populate it.';

-- 2) Combined actual spend gains a third term (extends 060 — blasts × completes,
--    suppliers × collected — with the flat vendor fees):
--   blasts    → Σ($/bid × # completes)
--   suppliers → Σ(CPI × N collected)
--   costs     → Σ(flat vendor fee)
create or replace function public.recompute_project_spend(pid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.survey_projects set actual_spend =
      coalesce((select sum(bid * completes) from public.project_blasts where project_id = pid), 0)
    + coalesce((select sum(cpi * n_collected) from public.project_suppliers where project_id = pid), 0)
    + coalesce((select sum(amount) from public.project_costs where project_id = pid), 0)
  where id = pid;
end $$;
revoke execute on function public.recompute_project_spend(uuid) from public, anon, authenticated;

-- Third writer of the same combined total (mirrors sync_blast_spend / sync_supplier_spend).
create or replace function public.sync_cost_spend() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_project_spend(coalesce(NEW.project_id, OLD.project_id));
  return null;
end $$;
drop trigger if exists project_costs_spend on public.project_costs;
create trigger project_costs_spend
  after insert or update or delete on public.project_costs
  for each row execute function public.sync_cost_spend();

-- 3) Funnel cost-line changes into the project_audit feed, like audit_project_blast (060).
--    Resolve the slug to its label first so the feed reads "SMS/Email Blast $250.00",
--    the same readability reason 028 resolves captain_id → a name.
create or replace function public.cost_kind_label(k text) returns text
language sql immutable as $$
  select case k
    when 'sms_email_blast' then 'SMS/Email Blast'
    when 'contacts_export' then 'Contacts Export'
    else coalesce(k, '—') end
$$;

create or replace function public.audit_project_cost()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text := coalesce(nullif(auth.email(), ''), nullif(current_setting('app.actor', true), ''), 'system');
begin
  if (TG_OP = 'INSERT') then
    insert into public.project_audit(project_id, field, new_value, changed_by)
    values (NEW.project_id, 'cost_added',
      public.cost_kind_label(NEW.kind) || ' $' || NEW.amount::text || coalesce(' — ' || NEW.description, ''), actor);
  elsif (TG_OP = 'DELETE') then
    insert into public.project_audit(project_id, field, old_value, changed_by)
    values (OLD.project_id, 'cost_removed',
      public.cost_kind_label(OLD.kind) || ' $' || OLD.amount::text || coalesce(' — ' || OLD.description, ''), actor);
    return OLD;
  elsif (TG_OP = 'UPDATE') then
    if (NEW.kind, NEW.amount, NEW.description, NEW.incurred_on)
       is distinct from (OLD.kind, OLD.amount, OLD.description, OLD.incurred_on) then
      insert into public.project_audit(project_id, field, old_value, new_value, changed_by)
      values (NEW.project_id, 'cost_changed',
        public.cost_kind_label(OLD.kind) || ' $' || OLD.amount::text || coalesce(' — ' || OLD.description, ''),
        public.cost_kind_label(NEW.kind) || ' $' || NEW.amount::text || coalesce(' — ' || NEW.description, ''), actor);
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists project_costs_audit on public.project_costs;
create trigger project_costs_audit
  after insert or update or delete on public.project_costs
  for each row execute function public.audit_project_cost();

-- 4) merge_projects re-points a FIXED LIST of child tables, so it is blind to every
--    new one — 067 had to go back and add launches/suppliers for exactly this reason.
--    Add project_costs now, or a merge would leave the retired copy's cost lines on
--    the soft-deleted loser and drop them out of the survivor's actual_spend.
--
--    Safety: project_costs has NO per-project uniqueness (a project can carry many
--    cost lines, and the same `kind` any number of times), so a plain re-point can't
--    collide — unlike project_recipients, which needs its de-dupe delete first.
--    Rebuilt verbatim from 067; only the one UPDATE below is new. The existing
--    recompute at the end now picks up the merged-in costs via the third term above.
create or replace function public.merge_projects(p_survivor uuid, p_loser uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  actor text := coalesce(nullif(auth.email(), ''), 'system');
  survivor_code text;
  loser_code text;
  ver_offset int;
begin
  if public.my_role() <> 'analyst' then raise exception 'Not authorized'; end if;
  if p_survivor = p_loser then raise exception 'Cannot merge a project into itself'; end if;
  if not exists (select 1 from survey_projects where id = p_survivor and deleted_at is null)
    then raise exception 'Survivor project not found'; end if;
  if not exists (select 1 from survey_projects where id = p_loser and deleted_at is null)
    then raise exception 'Loser project not found'; end if;

  -- Discard the retired duplicate's N segments (survivor's N wins).
  delete from project_segments where project_id = p_loser;

  update project_bids         set project_id = p_survivor where project_id = p_loser;
  update project_blasts       set project_id = p_survivor where project_id = p_loser;
  update project_costs        set project_id = p_survivor where project_id = p_loser;
  update project_steps        set project_id = p_survivor where project_id = p_loser;
  update project_activity     set project_id = p_survivor where project_id = p_loser;
  update project_data_changes set project_id = p_survivor where project_id = p_loser;
  update deliverables         set project_id = p_survivor where project_id = p_loser;
  update project_audit        set project_id = p_survivor where project_id = p_loser;

  -- PS: re-point launches first (ids unchanged → the suppliers' launch_id FK stays
  -- valid), then the supplier rows themselves.
  update project_launches     set project_id = p_survivor where project_id = p_loser;
  update project_suppliers    set project_id = p_survivor where project_id = p_loser;

  select coalesce(max(version), 0) into ver_offset
    from question_submissions where project_id = p_survivor;
  update question_submissions qs
    set project_id = p_survivor, version = ver_offset + r.rn
    from (
      select id, row_number() over (order by version, id) as rn
      from question_submissions where project_id = p_loser
    ) r
    where qs.id = r.id;

  delete from project_recipients l
    where l.project_id = p_loser
      and exists (select 1 from project_recipients s
                  where s.project_id = p_survivor and s.email = l.email and s.role = l.role);
  update project_recipients set project_id = p_survivor where project_id = p_loser;

  delete from project_seen where project_id = p_loser;

  update survey_projects set deleted_at = now() where id = p_loser;

  select project_code into survivor_code from survey_projects where id = p_survivor;
  select project_code into loser_code   from survey_projects where id = p_loser;
  insert into project_audit(project_id, field, new_value, changed_by)
    values (p_survivor, 'merged_in', coalesce(loser_code, p_loser::text), actor);
  insert into project_audit(project_id, field, new_value, changed_by)
    values (p_loser, 'merged_into', coalesce(survivor_code, p_survivor::text), actor);

  -- Reflect the merged-in supplier/blast/cost spend in the survivor's actual_spend.
  perform public.recompute_project_spend(p_survivor);
end $$;

grant execute on function public.merge_projects(uuid, uuid) to authenticated;

commit;
