-- 050_rerun_meta.sql — the "Cadence Layer" for rerun tracking.
-- Adds a durable, never-truncated per-study meta table (cadence + last-wave +
-- owner) keyed by a stable rerun_key on the mirror, and a view that computes the
-- EXPECTED-NEXT-WAVE — so a missed rerun is flagged even when the sheet still
-- says "<Month> Done". Additive; the sheet stays the source of truth.
-- Applied manually by David in the Supabase SQL editor.
begin;

-- 1) Stable join key on the mirror (normalized client|cadence). Populated by the
--    sync (lib/reruns/parse.ts + scripts/sync-reruns.mjs + the RPC below).
alter table public.rerun_snapshot add column if not exists rerun_key text;
create index if not exists rerun_snapshot_key_idx on public.rerun_snapshot (rerun_key);

-- 2) Durable enrichment, keyed by rerun_key. NEVER truncated by the sync, so a
--    study's cadence/owner/last-wave survive every re-mirror of the sheet.
create table if not exists public.rerun_meta (
  rerun_key        text primary key,
  display_name     text,
  cadence_months   integer,          -- 1/3/6/12; NULL = ad-hoc / one-off
  last_wave_on     date,             -- when the most recent wave was collected
  expected_next_on date,             -- explicit next date (ad-hoc, or an override)
  owner_email      text,
  paused           boolean not null default false,
  note             text,
  updated_by       text,
  updated_at       timestamptz not null default now()
);

alter table public.rerun_meta enable row level security;
revoke all on public.rerun_meta from anon, authenticated;
grant select, insert, update on public.rerun_meta to authenticated;   -- analysts define/log
grant all on public.rerun_meta to service_role;

drop policy if exists rerun_meta_analyst_rw on public.rerun_meta;
create policy rerun_meta_analyst_rw on public.rerun_meta
  for all to authenticated using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');
drop policy if exists rerun_meta_service_all on public.rerun_meta;
create policy rerun_meta_service_all on public.rerun_meta
  for all to service_role using (true) with check (true);

-- 3) Read model: mirror LEFT JOIN meta + the nothing-missed computation.
--    security_invoker so the caller's own RLS on both tables applies.
create or replace view public.rerun_status
with (security_invoker = true) as
with base as (
  select
    s.*,
    m.display_name,
    m.cadence_months,
    m.last_wave_on,
    m.expected_next_on,
    m.owner_email,
    coalesce(m.paused, false) as is_paused,
    (m.rerun_key is not null) as is_defined,
    (m.cadence_months is not null and m.last_wave_on is not null) as has_cadence_due,
    -- Expected next wave: paused → none; cadence+last-wave → computed; else an
    -- explicit date; else fall back to the free-text-inferred next_run_date.
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
  -- Overdue: a computed cadence due date ignores the last wave's "done"-ness
  -- (the NEXT wave is what's due). Explicit/inferred dates still respect done/closed.
  (
    not is_paused
    and effective_due is not null
    and effective_due < current_date
    and coalesce(status_class, '') <> 'closed'            -- a closed study never nags, even with a cadence
    and (has_cadence_due or coalesce(status_class, '') <> 'done')  -- a cadence re-arms a "done" wave; inferred dates still respect done
  ) as is_overdue,
  -- Needs definition: active, not paused, and no due date can be computed at all.
  (
    not is_paused
    and effective_due is null
    and coalesce(status_class, '') not in ('done', 'closed')
  ) as needs_definition
from base;

grant select on public.rerun_status to authenticated, service_role;

-- 4) Repoint the atomic replace RPC to also populate rerun_key.
create or replace function public.replace_rerun_snapshot(rows jsonb)
returns integer language plpgsql security definer
set search_path = public
as $$
declare inserted integer;
begin
  perform pg_advisory_xact_lock(hashtext('rerun_snapshot_sync'));
  truncate table public.rerun_snapshot;
  insert into public.rerun_snapshot (
    sheet_row, client, next_cadence, work, freq, platform, cadence, n,
    template, note, status_raw, survey_ids, next_run_date, status_class, rerun_key)
  select
    (r->>'sheet_row')::int, r->>'client', r->>'next_cadence', r->>'work',
    r->>'freq', r->>'platform', r->>'cadence', r->>'n', r->>'template',
    r->>'note', r->>'status_raw', r->>'survey_ids',
    nullif(r->>'next_run_date', '')::date, r->>'status_class', r->>'rerun_key'
  from jsonb_array_elements(rows) as r;
  get diagnostics inserted = row_count;
  return inserted;
end $$;
revoke execute on function public.replace_rerun_snapshot(jsonb) from public, anon, authenticated;
grant  execute on function public.replace_rerun_snapshot(jsonb) to service_role;

commit;
