-- 049_rerun_snapshot.sql — point-in-time mirror of Sree's "Manual Rerun(sree)" sheet tab.
-- Feeds the read-only Rerun Radar (/reruns). Written by the sync job (service role,
-- app/api/cron/sync-reruns); read by internal analysts via the browser client (RLS).
-- No FK to survey_projects: the sheet's free-text client/study strings don't map 1:1
-- to armed DB projects. Overdue/upcoming is computed at read time from next_run_date.
-- Applied manually by David in the Supabase SQL editor.
begin;

create table if not exists public.rerun_snapshot (
  id            uuid primary key default gen_random_uuid(),
  sheet_row     integer,
  client        text,
  next_cadence  text,
  work          text,
  freq          text,
  platform      text,
  cadence       text,
  n             text,          -- kept text: the sheet holds ranges like "500-700", "Buyer - 50"
  template      text,
  note          text,
  status_raw    text,          -- verbatim sheet Status (e.g. "May Pending", "June Done")
  survey_ids    text,
  next_run_date date,          -- derived by the sync from status/next-cadence text (nullable)
  status_class  text,          -- derived: done | closed | pending | active | unknown
  synced_at     timestamptz not null default now()
);

create index if not exists rerun_snapshot_next_run_idx on public.rerun_snapshot (next_run_date);
create index if not exists rerun_snapshot_synced_idx   on public.rerun_snapshot (synced_at desc);

-- RLS: deny-by-default; internal analysts read (browser client), service_role
-- (sync job) writes. Mirrors the 048/045/036 convention. my_role()='analyst'
-- correctly excludes compliance-portal users from internal cadence data.
alter table public.rerun_snapshot enable row level security;
revoke all on public.rerun_snapshot from anon, authenticated;
grant select on public.rerun_snapshot to authenticated;   -- RLS needs a base grant before a policy can pass
grant all    on public.rerun_snapshot to service_role;     -- sync job (bypasses RLS anyway)

drop policy if exists rerun_snapshot_analyst_select on public.rerun_snapshot;
create policy rerun_snapshot_analyst_select on public.rerun_snapshot
  for select using (public.my_role() = 'analyst');

drop policy if exists rerun_snapshot_service_all on public.rerun_snapshot;
create policy rerun_snapshot_service_all on public.rerun_snapshot
  for all to service_role using (true) with check (true);

-- Atomic replace used by the sync job: delete-all + insert in ONE transaction,
-- serialized by an advisory lock so overlapping syncs can't wipe each other and
-- readers never observe an empty or duplicated mirror. service_role only.
create or replace function public.replace_rerun_snapshot(rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
set sql_safe_updates = 'off'   -- allow the intentional full-table delete below
as $$
declare inserted integer;
begin
  perform pg_advisory_xact_lock(hashtext('rerun_snapshot_sync'));
  delete from public.rerun_snapshot;
  insert into public.rerun_snapshot (
    sheet_row, client, next_cadence, work, freq, platform, cadence, n,
    template, note, status_raw, survey_ids, next_run_date, status_class
  )
  select
    (r->>'sheet_row')::int, r->>'client', r->>'next_cadence', r->>'work',
    r->>'freq', r->>'platform', r->>'cadence', r->>'n', r->>'template',
    r->>'note', r->>'status_raw', r->>'survey_ids',
    nullif(r->>'next_run_date', '')::date, r->>'status_class'
  from jsonb_array_elements(rows) as r;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

revoke execute on function public.replace_rerun_snapshot(jsonb) from public, anon, authenticated;
grant  execute on function public.replace_rerun_snapshot(jsonb) to service_role;

commit;
