-- 051_rerun_accountability.sql — the "Accountability Layer" for rerun tracking.
-- Builds on 050's Cadence Layer: adds ownership (owner + backup), a prep-nudge
-- lead time + nudge-dedup state, and a weekly rerun-review ritual log. The view
-- gains a prep-window flag so the app + the (flag-gated) per-owner nudge cron
-- can find "due soon" studies without re-deriving the date math.
-- Additive; the sheet stays the source of truth. Applied manually by David.
begin;

-- 1) Ownership + nudge config + per-wave nudge-dedup state on the durable meta.
--    prep_nudged_for / overdue_nudged_for hold the effective_due we last nudged
--    for; when a wave is logged (effective_due moves), the next wave re-arms.
alter table public.rerun_meta add column if not exists backup_owner_email text;
alter table public.rerun_meta add column if not exists lead_days integer;        -- prep-nudge lead; NULL = global default (7)
alter table public.rerun_meta add column if not exists prep_nudged_for date;
alter table public.rerun_meta add column if not exists overdue_nudged_for date;

-- 2) Weekly rerun-review ritual log: who cleared the board + the counts at the
--    time, so the app can show "reviewed <date> by <who>" and arm the next one.
create table if not exists public.rerun_review_log (
  id              uuid primary key default gen_random_uuid(),
  reviewed_by     text,
  overdue_count   integer,
  undefined_count integer,
  due_soon_count  integer,
  note            text,
  created_at      timestamptz not null default now()
);

alter table public.rerun_review_log enable row level security;
revoke all on public.rerun_review_log from anon, authenticated;
grant select, insert on public.rerun_review_log to authenticated;   -- analysts read history + record a review
grant all on public.rerun_review_log to service_role;

drop policy if exists rerun_review_analyst_rw on public.rerun_review_log;
create policy rerun_review_analyst_rw on public.rerun_review_log
  for all to authenticated using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');
drop policy if exists rerun_review_service_all on public.rerun_review_log;
create policy rerun_review_service_all on public.rerun_review_log
  for all to service_role using (true) with check (true);

create index if not exists rerun_review_log_created_idx on public.rerun_review_log (created_at desc);

-- 3) Extend the read model: surface ownership + nudge state, and compute the
--    prep window (due soon, not yet overdue) using the same done/closed guards
--    as is_overdue so a "done" inferred-date study never nags early either.
-- DROP first: CREATE OR REPLACE VIEW can only APPEND columns, and we're inserting
-- new ones mid-list (backup_owner_email/lead_days/... before is_paused, days_to_due
-- before is_overdue), which Postgres rejects. Nothing in SQL depends on this view
-- (the app/badge/digest read it over PostgREST), so a drop+recreate is safe; the
-- SELECT grant is re-applied below.
drop view if exists public.rerun_status;
create view public.rerun_status
with (security_invoker = true) as
with base as (
  select
    s.*,
    m.display_name,
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
  (effective_due - current_date) as days_to_due,      -- date − date = integer; NULL when no due date
  (
    not is_paused
    and effective_due is not null
    and effective_due < current_date
    and coalesce(status_class, '') <> 'closed'
    and (has_cadence_due or coalesce(status_class, '') <> 'done')
  ) as is_overdue,
  -- Prep window: not overdue, but due within the lead time (per-study override
  -- or the 7-day default). Same closed/done guards as is_overdue.
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
