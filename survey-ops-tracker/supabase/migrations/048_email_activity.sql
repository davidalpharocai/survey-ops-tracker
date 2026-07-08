-- 048_email_activity.sql — email→activity timeline: review queue, delivered_at, soft-delete, search
-- Applied manually by David in the Supabase SQL editor. See
-- docs/superpowers/specs/2026-07-07-email-to-activity-design.md (Review resolutions).
begin;

-- 1) delivered_at: stamp when a project enters the 'Delivery' (Delivered) column.
--    The existing audit trigger is AFTER UPDATE and cannot set NEW, so use a
--    dedicated BEFORE UPDATE trigger.
alter table public.survey_projects add column if not exists delivered_at timestamptz;

create or replace function public.stamp_delivered_at() returns trigger as $$
begin
  if new.board_column = 'Delivery'
     and (old.board_column is distinct from 'Delivery')
     and new.delivered_at is null then
    new.delivered_at := now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists survey_projects_delivered_at on public.survey_projects;
create trigger survey_projects_delivered_at
  before update on public.survey_projects
  for each row execute function public.stamp_delivered_at();

-- One-time backfill from the audit log (board_column IS audited): earliest
-- transition into 'Delivery'. Already-delivered projects that never logged a
-- transition stay NULL (matcher treats NULL-on-Delivered as past-sweep → review).
update public.survey_projects p set delivered_at = a.first_delivered
from (
  select project_id, min(changed_at) as first_delivered
  from public.project_audit
  where field = 'board_column' and new_value = 'Delivery'
  group by project_id
) a
where a.project_id = p.id and p.delivered_at is null;

-- 2) project_activity: soft-delete + trigram search over subject+body.
alter table public.project_activity add column if not exists deleted_at timestamptz;

create extension if not exists pg_trgm;
create index if not exists project_activity_search_idx
  on public.project_activity
  using gin ((coalesce(subject, '') || ' ' || coalesce(body, '')) gin_trgm_ops);
create index if not exists project_activity_project_occurred_idx
  on public.project_activity (project_id, occurred_at desc);

-- 3) email_inbox: the review queue + pending-no-project store.
do $$ begin
  create type public.email_inbox_status as enum ('review', 'pending_no_project', 'filed', 'ignored');
exception when duplicate_object then null; end $$;

create table if not exists public.email_inbox (
  id uuid primary key default gen_random_uuid(),
  external_id text not null,                       -- 'email:<RFC-822 Message-ID>'
  status public.email_inbox_status not null default 'review',
  project_id uuid references public.survey_projects(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  direction text,                                  -- 'inbound' | 'outbound'
  from_email text,
  to_emails text[],
  subject text,
  snippet text,
  body text,
  occurred_at timestamptz not null default now(),
  gmail_message_id text,                           -- per-mailbox id, debug only
  source text not null default 'email-timeline',
  match_candidates jsonb,
  matched_confidence numeric,
  created_at timestamptz not null default now()    -- drives the retention TTL
);

create unique index if not exists email_inbox_external_id_key on public.email_inbox (external_id);
create index if not exists email_inbox_status_idx on public.email_inbox (status);
create index if not exists email_inbox_project_idx on public.email_inbox (project_id);
create index if not exists email_inbox_client_idx on public.email_inbox (client_id);
create index if not exists email_inbox_created_idx on public.email_inbox (created_at);

-- RLS: deny-by-default; service_role does ingest writes (bypasses RLS); analysts
-- may read + triage (mirrors the 045/036 split, not 034's single "for all" policy).
alter table public.email_inbox enable row level security;
revoke all on public.email_inbox from anon, authenticated;

drop policy if exists email_inbox_analyst_select on public.email_inbox;
create policy email_inbox_analyst_select on public.email_inbox
  for select using (public.my_role() = 'analyst');

drop policy if exists email_inbox_analyst_update on public.email_inbox;
create policy email_inbox_analyst_update on public.email_inbox
  for update using (public.my_role() = 'analyst')
  with check (public.my_role() = 'analyst');

commit;
