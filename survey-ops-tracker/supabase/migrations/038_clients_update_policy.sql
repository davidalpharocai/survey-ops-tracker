-- The in-app client editor (compliance flags, contact, notes on the client page)
-- needs UPDATE on public.clients. Migration 008 granted analysts SELECT + INSERT
-- but no UPDATE, so edits were silently denied by RLS (0 rows changed, no error)
-- and the checkbox snapped back. Add the missing analyst UPDATE policy.
create policy "analysts update clients" on public.clients for update to authenticated
  using (public.my_role() = 'analyst')
  with check (public.my_role() = 'analyst');
