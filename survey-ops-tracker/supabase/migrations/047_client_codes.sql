-- Client codes: today `clients.code` (the sheet's "Cl00001"-style Unique
-- Clients id) is populated only by the sheet import — there is no
-- auto-generation, so app- and trigger-created clients (new-client modal,
-- MCP create_client, and the sync_project_client auto-create-on-new-firm
-- trigger) sit codeless forever. Mirror the project_code_seq / assign_project_code
-- pattern from 027_project_codes_and_client_codes.sql: a sequence + BEFORE
-- INSERT trigger that assigns the next "Cl#####" whenever code is null,
-- leaving sheet-provided codes untouched. From this migration on, the app is
-- authoritative for new client codes — the sequence is seeded above the
-- current max sheet-assigned number so it can never collide.
create sequence if not exists public.client_code_seq minvalue 0 start 0;

create or replace function public.assign_client_code()
returns trigger as $$
begin
  if new.code is null then
    new.code := 'Cl' || lpad(nextval('public.client_code_seq')::text, 5, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists clients_client_code on public.clients;
create trigger clients_client_code
  before insert on public.clients
  for each row execute function public.assign_client_code();

-- Seed the sequence one past the highest existing "Cl#####" code (sheet-
-- imported clients use this exact format — see lib/deliverables/matcher.test.ts
-- and scripts/merge-clients*.mjs) so the first app-assigned code can never
-- clash with the sheet's numbering. Codeless existing clients are left as-is;
-- they only get a code if/when re-inserted (they won't be — this only fires
-- on insert).
select setval('public.client_code_seq',
  greatest(
    coalesce((select max(substring(code from 3)::int) from public.clients where code ~ '^Cl[0-9]+$'), 0),
    0
  ) + 1,
  false);
