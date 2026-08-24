-- 079: Capabilities — finance-only visibility WITHOUT a third role.
--
-- profile_role has exactly two values ('analyst', 'compliance'), and ~25 RLS
-- policies, merge_projects() and six app gates test `my_role() = 'analyst'` for
-- EXACT equality. A third role ('finance') would therefore lock that person out
-- of the whole tool. So capabilities ride ALONGSIDE the role in their own table:
-- David/Shanu/Vineet stay analysts and additionally hold 'view_financials',
-- which the price/margin surfaces check. Nothing about the existing role checks
-- changes.
--
-- Apply in the Supabase SQL editor (David). Standalone + re-runnable: the app
-- ships before this runs and must survive the gap, so lib/auth/capabilities.ts
-- treats a missing table as "no capabilities" rather than an error.
begin;

create table if not exists public.profile_capabilities (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  capability  text not null,
  granted_by  text,
  granted_at  timestamptz not null default now(),
  primary key (profile_id, capability)
);
-- The PK is also the hot lookup (all capabilities for one profile), so no extra
-- index. `capability` is free text — granting a new one is a row, not a
-- migration, and an unknown string simply never matches a gate.
comment on table public.profile_capabilities is
  'Additive per-user permissions alongside profiles.role. One row per (profile, capability). Writes are service-role only.';

alter table public.profile_capabilities enable row level security;

-- Writes are service-role only. `profiles` deliberately has no INSERT/UPDATE
-- policy for authenticated — a user must not be able to promote themselves —
-- and this table is the same story: belt-and-braces at BOTH the grant and the
-- policy level, so there is no path from the browser to granting yourself
-- financial visibility.
revoke all on public.profile_capabilities from anon, authenticated;
grant select on public.profile_capabilities to authenticated;
grant all on public.profile_capabilities to service_role;

-- Reads mirror profiles (008): you read your own row, analysts read all of them
-- (the UI needs to know its own capabilities; a future admin surface needs the
-- rest). A compliance reviewer only ever matches their own — empty — set.
drop policy if exists "read own capabilities" on public.profile_capabilities;
create policy "read own capabilities" on public.profile_capabilities for select to authenticated
  using (profile_id = auth.uid());
drop policy if exists "analysts read capabilities" on public.profile_capabilities;
create policy "analysts read capabilities" on public.profile_capabilities for select to authenticated
  using (public.my_role() = 'analyst');
drop policy if exists "service role full capabilities" on public.profile_capabilities;
create policy "service role full capabilities" on public.profile_capabilities
  for all to service_role using (true) with check (true);

-- Security-definer helpers so policies and views can test a capability without
-- a recursive RLS lookup — same shape as my_role() in 006. The parameter is
-- written as can.capability because `capability` is also a column of the table
-- being scanned, which would otherwise be ambiguous.
create or replace function public.can(capability text)
returns boolean language sql stable security definer set search_path = public as
$$ select exists (
     select 1 from public.profile_capabilities pc
     where pc.profile_id = auth.uid() and pc.capability = can.capability
   ) $$;

create or replace function public.can_view_financials()
returns boolean language sql stable security definer set search_path = public as
$$ select public.can('view_financials') $$;

-- Same grant posture as the 006 helpers: authenticated policy evaluation only,
-- never anon. Both answer for auth.uid(), so they are always false on a
-- service-role connection (no JWT) — server code running as the admin client
-- must check the acting user's capabilities in app code, not through these.
revoke execute on function public.can(text) from anon, public;
revoke execute on function public.can_view_financials() from anon, public;
grant execute on function public.can(text) to authenticated;
grant execute on function public.can_view_financials() to authenticated;

-- Seed: the three people who may see money. Matched by email against profiles
-- (profiles.id IS auth.users.id), so an email with no account yet matches
-- nothing — 0 rows inserted, no error. Vineet may not have signed in.
--
-- If he signs in later, migration 031's provision_profile trigger gives him an
-- 'analyst' profile but NOT this grant: re-run the insert below (idempotent) or
-- add the row from the SQL editor. There is deliberately no trigger that hands
-- out capabilities by email — a money grant should be a deliberate act, never
-- something an account creation can conjure.
insert into public.profile_capabilities (profile_id, capability, granted_by)
select p.id, 'view_financials', 'migration 079'
from public.profiles p
where lower(p.email) in ('david@alpharoc.ai', 'shanu@alpharoc.ai', 'vineet@alpharoc.ai')
on conflict (profile_id, capability) do nothing;

commit;
