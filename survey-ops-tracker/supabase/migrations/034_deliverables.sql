-- 033: Deliverables depository.
-- Drive holds files; this table is the searchable index + audit. Analyst-only
-- RLS (mirrors 030) — external compliance reviewers must never read it.

create type public.deliverable_source as enum ('email','upload');
create type public.deliverable_kind   as enum ('file','link');
create type public.deliverable_status as enum ('filed','review','duplicate','unsorted');

-- client → Shared Drive top-level folder (resolved by ID, never by display name)
alter table public.clients
  add column if not exists drive_folder_id text;

-- cached project subfolder id, so we never re-create or re-search
alter table public.survey_projects
  add column if not exists drive_folder_id text;

create table public.deliverables (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id),
  project_id uuid references public.survey_projects(id),
  kind public.deliverable_kind not null,
  drive_file_id text,                 -- the file, or the shortcut/bookmark for a link
  drive_folder_id text,
  file_name text,                     -- final name as stored in Drive
  original_file_name text,
  file_hash text,                     -- SHA-256 of bytes (null for links)
  source_url text,                    -- original link for kind='link'
  mime_type text,
  size_bytes bigint,
  source public.deliverable_source not null,
  status public.deliverable_status not null,
  match_confidence numeric,
  match_method text,                  -- 'code'|'contact_email'|'domain'|'name'|'ai'|'upload_context'
  match_candidates jsonb not null default '[]',
  duplicate_of uuid references public.deliverables(id),
  gmail_message_id text,
  email_subject text,
  email_from text,
  email_date timestamptz,
  forwarded_by text,
  filed_by uuid references public.profiles(id),
  filed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz default now()
);

-- idempotency + dedup
create unique index deliverables_gmail_msg_idx
  on public.deliverables (gmail_message_id) where gmail_message_id is not null;
create unique index deliverables_file_dedup_idx
  on public.deliverables (file_hash, drive_folder_id)
  where file_hash is not null and drive_folder_id is not null and status <> 'duplicate';
create unique index deliverables_link_dedup_idx
  on public.deliverables (source_url, drive_folder_id)
  where source_url is not null and drive_folder_id is not null and status <> 'duplicate';
create index deliverables_status_idx  on public.deliverables (status) where deleted_at is null;
create index deliverables_project_idx on public.deliverables (project_id) where deleted_at is null;
create index deliverables_client_idx  on public.deliverables (client_id) where deleted_at is null;
create index deliverables_filed_idx   on public.deliverables (filed_at desc) where deleted_at is null;

-- RLS: analyst-only (mirror migration 030). Inserts happen via service-role
-- (ingest core) which bypasses RLS; analysts may also read/write in-app.
alter table public.deliverables enable row level security;
create policy "analysts full access deliverables" on public.deliverables
  for all to authenticated
  using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');
