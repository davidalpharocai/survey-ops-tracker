-- Client notes: a dated, attributed log of free-text notes about a client, shown
-- as bullets (newest first). Mirrors project_steps (minus the done/checkbox) so
-- notes read and behave the same way everywhere in the app.

create table if not exists public.client_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  body text not null,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists client_notes_client_idx on public.client_notes (client_id, created_at desc);

alter table public.client_notes enable row level security;
revoke all on public.client_notes from anon;
drop policy if exists "analyst all client_notes" on public.client_notes;
create policy "analyst all client_notes" on public.client_notes
  for all using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');
drop policy if exists "service role full client_notes" on public.client_notes;
create policy "service role full client_notes" on public.client_notes
  for all to service_role using (true) with check (true);
