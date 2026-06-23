-- Client contacts: a per-client roster of people (the requester, etc.). A project
-- points at a single "requested by" contact via requested_by_contact_id, plus a
-- denormalized requested_by_name snapshot so the requester still shows even after
-- the contact is permanently deleted or the project moves to another client.
-- Deleting a contact normally means archiving it (archived = true) — it drops out
-- of the picker but existing references still resolve to the full contact.

create table if not exists public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text,
  title text,
  phone text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists client_contacts_client_idx on public.client_contacts (client_id) where archived = false;

alter table public.survey_projects
  add column if not exists requested_by_contact_id uuid references public.client_contacts(id) on delete set null,
  add column if not exists requested_by_name text;

alter table public.client_contacts enable row level security;
revoke all on public.client_contacts from anon;
drop policy if exists "analyst all client_contacts" on public.client_contacts;
create policy "analyst all client_contacts" on public.client_contacts
  for all using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');
drop policy if exists "service role full client_contacts" on public.client_contacts;
create policy "service role full client_contacts" on public.client_contacts
  for all to service_role using (true) with check (true);
