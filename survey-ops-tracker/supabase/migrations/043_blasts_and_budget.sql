-- Money model v2: per-blast cost line items + N internal target + bid-budget log.
-- - project_blasts: the operational sends (# delivered, $/bid used, fixed blast $).
-- - project_bids is repurposed as the "Bid Budget" change log (the allowed $/bid
--   over time); created_by records who greenlit each change.
-- - survey_projects.budget stays as the "Total budget" (typed); actual spend is now
--   computed from the blasts, so the old actual_spend column is left unused.

alter table public.survey_projects
  add column if not exists n_internal_target integer;

alter table public.project_bids
  add column if not exists created_by text;

create table if not exists public.project_blasts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.survey_projects(id) on delete cascade,
  delivered integer not null default 0,
  bid numeric not null default 0,
  blast_cost numeric not null default 0,
  note text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists project_blasts_project_idx on public.project_blasts (project_id, created_at);

alter table public.project_blasts enable row level security;
revoke all on public.project_blasts from anon;
drop policy if exists "analyst all project_blasts" on public.project_blasts;
create policy "analyst all project_blasts" on public.project_blasts
  for all using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');
drop policy if exists "service role full project_blasts" on public.project_blasts;
create policy "service role full project_blasts" on public.project_blasts
  for all to service_role using (true) with check (true);

-- Keep survey_projects.actual_spend = the sum of blast totals, so the hero tile,
-- Insights, Client pages, and CSV export all read one consistent spend number
-- (the same one the Money card computes). Mirrors sync_segment_totals().
create or replace function public.sync_blast_spend()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pid uuid := coalesce(NEW.project_id, OLD.project_id);
  spend numeric;
begin
  select coalesce(sum(delivered * bid + blast_cost), 0) into spend
    from public.project_blasts where project_id = pid;
  update public.survey_projects set actual_spend = spend where id = pid;
  return null;
end $$;
drop trigger if exists project_blasts_spend on public.project_blasts;
create trigger project_blasts_spend
  after insert or update or delete on public.project_blasts
  for each row execute function public.sync_blast_spend();

-- Funnel blast changes into the project_audit feed, like project_bids (029).
create or replace function public.audit_project_blast()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text := coalesce(nullif(auth.email(), ''), 'system');
begin
  if (TG_OP = 'INSERT') then
    insert into public.project_audit(project_id, field, new_value, changed_by)
    values (NEW.project_id, 'blast_added', NEW.delivered::text || ' @ $' || NEW.bid::text || ' + $' || NEW.blast_cost::text, actor);
  elsif (TG_OP = 'DELETE') then
    insert into public.project_audit(project_id, field, old_value, changed_by)
    values (OLD.project_id, 'blast_removed', OLD.delivered::text || ' @ $' || OLD.bid::text || ' + $' || OLD.blast_cost::text, actor);
    return OLD;
  elsif (TG_OP = 'UPDATE') then
    if (NEW.delivered, NEW.bid, NEW.blast_cost) is distinct from (OLD.delivered, OLD.bid, OLD.blast_cost) then
      insert into public.project_audit(project_id, field, old_value, new_value, changed_by)
      values (NEW.project_id, 'blast_changed',
        OLD.delivered::text || ' @ $' || OLD.bid::text || ' + $' || OLD.blast_cost::text,
        NEW.delivered::text || ' @ $' || NEW.bid::text || ' + $' || NEW.blast_cost::text, actor);
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists project_blasts_audit on public.project_blasts;
create trigger project_blasts_audit
  after insert or update or delete on public.project_blasts
  for each row execute function public.audit_project_blast();
