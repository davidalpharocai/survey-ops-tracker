-- 059: PS suppliers get a per-supplier "N collected", so actual supplier spend =
-- Σ(CPI × N collected) rather than the cap-based estimate. That real cost is fed
-- into survey_projects.actual_spend (combined with any B2B blast spend), so the
-- hero budget, Insights, and exports reflect true PS cost.
-- Applied manually in the Supabase SQL editor (David).

alter table public.project_suppliers add column if not exists n_collected integer not null default 0;

-- One source of truth for a project's actual spend:
--   blasts   → Σ($/bid × # people)
--   suppliers→ Σ(CPI × N collected)
create or replace function public.recompute_project_spend(pid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.survey_projects set actual_spend =
      coalesce((select sum(bid * people) from public.project_blasts where project_id = pid), 0)
    + coalesce((select sum(cpi * n_collected) from public.project_suppliers where project_id = pid), 0)
  where id = pid;
end $$;
revoke execute on function public.recompute_project_spend(uuid) from public, anon, authenticated;

-- Both spend sources recompute the same combined total.
create or replace function public.sync_blast_spend() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_project_spend(coalesce(NEW.project_id, OLD.project_id));
  return null;
end $$;

create or replace function public.sync_supplier_spend() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_project_spend(coalesce(NEW.project_id, OLD.project_id));
  return null;
end $$;
drop trigger if exists project_suppliers_spend on public.project_suppliers;
create trigger project_suppliers_spend
  after insert or update or delete on public.project_suppliers
  for each row execute function public.sync_supplier_spend();
