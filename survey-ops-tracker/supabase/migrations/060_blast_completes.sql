-- 060: a B2B blast now tracks BOTH the # of people it went to (reach) AND the
-- # of those who COMPLETED the survey. The bid is a per-completion reward, so a
-- blast's cost — and the project's blast spend — is $/bid × # of completes (we
-- don't pay people who didn't take the survey or who terminated). `people` stays
-- as an informational reach count. project_blasts is empty, so nothing to
-- backfill. Applied manually in the Supabase SQL editor (David).

alter table public.project_blasts add column if not exists completes integer not null default 0;

-- Combined actual spend: blast side now multiplies bid × COMPLETES (was people).
--   blasts    → Σ($/bid × # completes)
--   suppliers → Σ(CPI × N collected)
create or replace function public.recompute_project_spend(pid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.survey_projects set actual_spend =
      coalesce((select sum(bid * completes) from public.project_blasts where project_id = pid), 0)
    + coalesce((select sum(cpi * n_collected) from public.project_suppliers where project_id = pid), 0)
  where id = pid;
end $$;
revoke execute on function public.recompute_project_spend(uuid) from public, anon, authenticated;

-- Audit feed shows "C completes / P people @ $bid", and fires when completes change.
create or replace function public.audit_project_blast()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text := coalesce(nullif(auth.email(), ''), nullif(current_setting('app.actor', true), ''), 'system');
begin
  if (TG_OP = 'INSERT') then
    insert into public.project_audit(project_id, field, new_value, changed_by)
    values (NEW.project_id, 'blast_added',
      NEW.completes::text || ' completes / ' || NEW.people::text || ' people @ $' || NEW.bid::text, actor);
  elsif (TG_OP = 'DELETE') then
    insert into public.project_audit(project_id, field, old_value, changed_by)
    values (OLD.project_id, 'blast_removed',
      OLD.completes::text || ' completes / ' || OLD.people::text || ' people @ $' || OLD.bid::text, actor);
    return OLD;
  elsif (TG_OP = 'UPDATE') then
    if (NEW.people, NEW.completes, NEW.bid, NEW.blast_at) is distinct from (OLD.people, OLD.completes, OLD.bid, OLD.blast_at) then
      insert into public.project_audit(project_id, field, old_value, new_value, changed_by)
      values (NEW.project_id, 'blast_changed',
        OLD.completes::text || ' completes / ' || OLD.people::text || ' people @ $' || OLD.bid::text,
        NEW.completes::text || ' completes / ' || NEW.people::text || ' people @ $' || NEW.bid::text, actor);
    end if;
  end if;
  return NEW;
end $$;

-- log_blast RPC gains p_completes (drop the prior signature, add the new one).
drop function if exists public.mcp_log_blast(uuid, numeric, int, timestamptz, text, text, text, text);
create or replace function public.mcp_log_blast(
  p_project uuid, p_bid numeric, p_people int, p_completes int, p_blast_at timestamptz,
  p_note text, p_created_by text, p_idem text, p_actor text
) returns public.project_blasts language plpgsql security definer set search_path = public as $$
declare r public.project_blasts;
begin
  perform set_config('app.actor', p_actor, true);
  insert into project_blasts (project_id, bid, people, completes, blast_at, note, created_by, idem_key)
    values (p_project, p_bid, p_people, p_completes, p_blast_at, p_note, p_created_by, p_idem) returning * into r;
  return r;
exception when unique_violation then
  select * into r from project_blasts where project_id = p_project and idem_key = p_idem; -- idempotent no-op
  return r;
end $$;
revoke execute on function public.mcp_log_blast(uuid, numeric, int, int, timestamptz, text, text, text, text) from public, anon, authenticated;
grant  execute on function public.mcp_log_blast(uuid, numeric, int, int, timestamptz, text, text, text, text) to service_role;
