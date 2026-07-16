-- 052_rerun_meta_note.sql — surface the durable per-study meta NOTE in the
-- rerun_status read model, aliased as meta_note so it stays distinct from the
-- sheet's own `note` (s.note). The meta note is already writable via
-- /api/reruns/meta (rerun_meta.note); this just lets the app DISPLAY it.
-- Additive; drop+recreate because CREATE OR REPLACE VIEW can't insert a column
-- mid-list. Nothing in SQL depends on the view (app/badge/digest read it over
-- PostgREST). Applied manually by David in the Supabase SQL editor.
begin;

drop view if exists public.rerun_status;
create view public.rerun_status
with (security_invoker = true) as
with base as (
  select
    s.*,
    m.display_name,
    m.note as meta_note,
    m.cadence_months,
    m.last_wave_on,
    m.expected_next_on,
    m.owner_email,
    m.backup_owner_email,
    m.lead_days,
    m.prep_nudged_for,
    m.overdue_nudged_for,
    coalesce(m.paused, false) as is_paused,
    (m.rerun_key is not null) as is_defined,
    (m.cadence_months is not null and m.last_wave_on is not null) as has_cadence_due,
    case
      when coalesce(m.paused, false) then null
      when m.cadence_months is not null and m.last_wave_on is not null
        then (m.last_wave_on + (m.cadence_months || ' months')::interval)::date
      when m.expected_next_on is not null then m.expected_next_on
      else s.next_run_date
    end as effective_due
  from public.rerun_snapshot s
  left join public.rerun_meta m on m.rerun_key = s.rerun_key
)
select
  base.*,
  (effective_due - current_date) as days_to_due,
  (
    not is_paused
    and effective_due is not null
    and effective_due < current_date
    and coalesce(status_class, '') <> 'closed'
    and (has_cadence_due or coalesce(status_class, '') <> 'done')
  ) as is_overdue,
  (
    not is_paused
    and effective_due is not null
    and effective_due >= current_date
    and effective_due <= (current_date + coalesce(lead_days, 7))
    and coalesce(status_class, '') <> 'closed'
    and (has_cadence_due or coalesce(status_class, '') <> 'done')
  ) as in_prep_window,
  (
    not is_paused
    and effective_due is null
    and coalesce(status_class, '') not in ('done', 'closed')
  ) as needs_definition
from base;

grant select on public.rerun_status to authenticated, service_role;

commit;
