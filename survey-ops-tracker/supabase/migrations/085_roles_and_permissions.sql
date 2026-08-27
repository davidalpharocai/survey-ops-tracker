-- 085: Roles as permission bundles — the half migration 079 could not build.
--
-- WHERE THIS COMES FROM
--
-- 079 needed finance-only visibility and could not add a 'finance' role, because
-- 73 policy references across 98 policies test `my_role() = 'analyst'` for EXACT
-- equality: a third tier would have locked those three people out of the whole
-- tool. So it granted a capability DIRECTLY to each person instead. That was the
-- right call under the constraint, and it is also half of the standard shape —
-- permissions with no roles to bundle them. This file adds the other half.
--
-- The layering, which is what keeps the role count from exploding:
--
--   TIER      profiles.role      "which app do you land in"   analyst | compliance
--   ROLE      profile_roles      "what are you accountable for" finance | admin | sales
--   SCOPE     (later, 087)       "whose records"                own clients | all
--
-- Tier stays a two-value enum and is a ROUTING boundary, not a permission set.
-- Roles are bundles of permissions and are many-to-many with a person. Scope is
-- kept OUT of roles on purpose: "Alex, but only his own clients" must not become
-- a fourth role, because that is how you end up with forty of them.
--
-- 'sales' IS added to the tier enum here (see step 0) but is deliberately
-- UNUSED — no profile gets it in this file. Adding the value is safe precisely
-- because every one of those 73 policies tests for 'analyst': a sales tier is
-- denied by default, everywhere, by omission. That is the opposite of 079's
-- problem. 079 needed a tier that could still do everything an analyst does;
-- sales needs a tier that can do nothing until told otherwise.
--
-- WHAT THIS FILE DOES NOT DO
--
-- · It does not migrate the three existing profile_capabilities rows into roles.
--   Direct grants REMAIN a first-class mechanism (a one-off exception should not
--   require inventing a role), so can() below answers from the UNION of the two.
--   Deleting those rows and re-granting via a role would be a strictly riskier
--   way to reach the same answer.
-- · It does not touch profiles, my_role(), or any existing policy. Nothing that
--   works today changes behaviour when this is applied.
-- · It does not build the sales portal or the salesperson→profile foreign key.
--   Those are 086/087 and need a surface and a name reconciliation respectively.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable.

-- ── STEP 0: the tier enum value ────────────────────────────────────────────────
-- OUTSIDE the transaction below, and nothing in this file may USE the value.
-- Postgres refuses to let a newly added enum value be used in the same
-- transaction that added it ("unsafe use of new value of enum type"), and the
-- Supabase SQL editor may wrap a whole script in one implicit transaction. So:
-- add it here, reference it for the first time in 086. `if not exists` keeps
-- this file re-runnable.
alter type public.profile_role add value if not exists 'sales';

begin;

-- ── STEP 1: the permission catalogue ──────────────────────────────────────────
-- A TABLE, not an enum. Granting a new permission must be a row, never a
-- migration + a deploy — 079 made the same call for capability names and it has
-- held. `is_sensitive` drives the extra confirmation in the admin UI and marks
-- what a quarterly access review should look at first.
create table if not exists public.permissions (
  name         text primary key,
  description  text not null,
  is_sensitive boolean not null default false
);
comment on table public.permissions is
  'Catalogue of every permission the app checks. Rows are documentation + the admin UI''s list; the authority is still whatever can() returns.';

insert into public.permissions (name, description, is_sensitive) values
  ('view_financials',   'See client pricing, contract value and margin. Does NOT include cost-to-run, which everyone internal sees.', true),
  ('manage_permissions','Grant and revoke roles and permissions for other people.', true),
  ('export_data',       'Download project or client data as a file. Every export is logged to data_exports (081).', false),
  ('view_all_clients',  'See every client, not only the ones this person is the salesperson for. Analysts hold this implicitly; it exists for scoped tiers.', false)
on conflict (name) do update set
  description = excluded.description, is_sensitive = excluded.is_sensitive;

-- ── STEP 2: roles, and what each bundles ──────────────────────────────────────
create table if not exists public.roles (
  name        text primary key,
  description text not null
);
comment on table public.roles is
  'A named bundle of permissions. Roles describe accountability ("finance"), never one person''s exception — use a direct profile_capabilities grant for that.';

insert into public.roles (name, description) values
  ('finance', 'Sees the money: client pricing, contract value, margin.'),
  ('admin',   'Administers access — grants and revokes other people''s roles.'),
  ('sales',   'Sales. Pipeline and delivery status for their own clients; cost-to-run but never pricing or margin.')
on conflict (name) do update set description = excluded.description;

create table if not exists public.role_permissions (
  role       text not null references public.roles(name) on delete cascade,
  permission text not null references public.permissions(name) on delete cascade,
  primary key (role, permission)
);

-- 'sales' intentionally bundles NOTHING yet. It is not an oversight: the sales
-- surface does not exist, and a role that grants nothing is exactly right until
-- it does. Cost-to-run needs no permission — it is what everyone outside the
-- finance three already sees, so there is nothing to grant.
insert into public.role_permissions (role, permission) values
  ('finance', 'view_financials'),
  ('admin',   'manage_permissions')
on conflict do nothing;

-- ── STEP 3: who holds which role ──────────────────────────────────────────────
create table if not exists public.profile_roles (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       text not null references public.roles(name) on delete cascade,
  granted_by text,
  granted_at timestamptz not null default now(),
  primary key (profile_id, role)
);
comment on table public.profile_roles is
  'Role assignments. Many-to-many: one person may hold finance AND admin. Writes are service-role only and go through grant_role()/revoke_role(), which audit.';

-- Same posture as 079's profile_capabilities, for the same reason: there must be
-- no path from a browser to granting yourself a role. profiles itself has no
-- INSERT or UPDATE policy for `authenticated` at all (008 gives it SELECT only),
-- so this table matches that and is belt-and-braces at BOTH the grant and the
-- policy level.
alter table public.profile_roles enable row level security;
revoke all on public.profile_roles from anon, authenticated;
grant select on public.profile_roles to authenticated;
grant all on public.profile_roles to service_role;

drop policy if exists profile_roles_read_own on public.profile_roles;
create policy profile_roles_read_own on public.profile_roles for select to authenticated
  using (profile_id = auth.uid());
drop policy if exists profile_roles_analyst_read on public.profile_roles;
create policy profile_roles_analyst_read on public.profile_roles for select to authenticated
  using (public.my_role() = 'analyst');
drop policy if exists profile_roles_service_all on public.profile_roles;
create policy profile_roles_service_all on public.profile_roles
  for all to service_role using (true) with check (true);

-- The catalogues are readable by anyone signed in (the admin UI lists them) and
-- writable by nobody but the service role. They are reference data.
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
revoke all on public.permissions, public.roles, public.role_permissions from anon, authenticated;
grant select on public.permissions, public.roles, public.role_permissions to authenticated;
grant all on public.permissions, public.roles, public.role_permissions to service_role;

drop policy if exists permissions_read on public.permissions;
create policy permissions_read on public.permissions for select to authenticated using (true);
drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles for select to authenticated using (true);
drop policy if exists role_permissions_read on public.role_permissions;
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);

drop policy if exists permissions_service_all on public.permissions;
create policy permissions_service_all on public.permissions for all to service_role using (true) with check (true);
drop policy if exists roles_service_all on public.roles;
create policy roles_service_all on public.roles for all to service_role using (true) with check (true);
drop policy if exists role_permissions_service_all on public.role_permissions;
create policy role_permissions_service_all on public.role_permissions for all to service_role using (true) with check (true);

-- ── STEP 4: can() now answers from BOTH mechanisms ────────────────────────────
-- Same signature, same grants, same security-definer posture as 079 — this is a
-- true replace, so every existing caller (can_view_financials, and any policy
-- that grows one later) picks up role-derived permissions with no edit.
--
-- The UNION is the whole point: a permission is held if it came from a role OR
-- was granted directly. `can.capability` is still spelled with the function
-- prefix because `capability` is also a column of profile_capabilities and would
-- otherwise resolve to the column.
--
-- Still answers for auth.uid(), so still FALSE on a service-role connection
-- (no JWT). Server code running as the admin client must check the acting user
-- in app code — see lib/auth/capabilities.ts, which is where that lives.
create or replace function public.can(capability text)
returns boolean language sql stable security definer set search_path = public as
$$
  select exists (
    select 1 from public.profile_capabilities pc
    where pc.profile_id = auth.uid() and pc.capability = can.capability
  ) or exists (
    select 1
    from public.profile_roles pr
    join public.role_permissions rp on rp.role = pr.role
    where pr.profile_id = auth.uid() and rp.permission = can.capability
  )
$$;

revoke execute on function public.can(text) from anon, public;
grant execute on function public.can(text) to authenticated;

-- Convenience twins, so a policy or a view reads as English. can_view_financials
-- already exists from 079 and is unchanged — it calls can(), so it inherits the
-- union for free.
create or replace function public.can_manage_permissions()
returns boolean language sql stable security definer set search_path = public as
$$ select public.can('manage_permissions') $$;
revoke execute on function public.can_manage_permissions() from anon, public;
grant execute on function public.can_manage_permissions() to authenticated;

-- ── STEP 5: the audit log ─────────────────────────────────────────────────────
-- Append-only by grant, not merely by convention: `authenticated` gets SELECT
-- and nothing else, and there is no UPDATE or DELETE grant for anyone but the
-- service role. An access-review question ("who could see margin in March, and
-- who let them?") has to be answerable a year later.
create table if not exists public.permission_audit (
  id          bigint generated by default as identity primary key,
  at          timestamptz not null default now(),
  actor       text not null,
  action      text not null check (action in ('grant_role','revoke_role','grant_capability','revoke_capability')),
  subject_id  uuid,
  subject     text not null,
  target      text not null,
  reason      text
);
comment on table public.permission_audit is
  'Append-only history of every access change. subject = the person whose access changed, target = the role or capability, actor = who did it.';
create index if not exists permission_audit_at_idx on public.permission_audit (at desc);
create index if not exists permission_audit_subject_idx on public.permission_audit (subject_id, at desc);

alter table public.permission_audit enable row level security;
revoke all on public.permission_audit from anon, authenticated;
grant select on public.permission_audit to authenticated;
grant all on public.permission_audit to service_role;
drop policy if exists permission_audit_analyst_read on public.permission_audit;
create policy permission_audit_analyst_read on public.permission_audit for select to authenticated
  using (public.my_role() = 'analyst');
drop policy if exists permission_audit_service_all on public.permission_audit;
create policy permission_audit_service_all on public.permission_audit
  for all to service_role using (true) with check (true);

-- ── STEP 6: the only sanctioned way to change access ──────────────────────────
-- security definer + service-role-only EXECUTE. These are called from a server
-- route that has already established the actor holds manage_permissions; the
-- functions then enforce the invariants that must hold no matter who calls.
--
-- THE SELF-GRANT GUARD. p_actor_id is the caller's own profile id and the guard
-- is on the pair (actor, target), not on the action: nobody may hand THEMSELVES
-- manage_permissions or view_financials, whether directly or by way of a role
-- that contains it. Without this, one compromised admin session is a permanent
-- promotion, and the audit row it writes would read as routine. Granting those
-- to SOMEONE ELSE is fine and is the normal path — which is also why there must
-- always be at least two admins, or a lockout is one revoke away.
create or replace function public.grant_role(
  p_actor_id uuid, p_actor text, p_subject_id uuid, p_role text, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_subject text; v_sensitive boolean;
begin
  select email into v_subject from public.profiles where id = p_subject_id;
  if v_subject is null then raise exception 'No profile %', p_subject_id; end if;
  if not exists (select 1 from public.roles where name = p_role) then
    raise exception 'No such role: %', p_role;
  end if;

  select exists (
    select 1 from public.role_permissions rp
    join public.permissions pm on pm.name = rp.permission
    where rp.role = p_role and pm.is_sensitive
  ) into v_sensitive;
  if p_actor_id = p_subject_id and v_sensitive then
    raise exception 'Refusing self-grant: % contains a sensitive permission. Ask the other admin.', p_role;
  end if;

  insert into public.profile_roles (profile_id, role, granted_by)
  values (p_subject_id, p_role, p_actor)
  on conflict (profile_id, role) do nothing;

  insert into public.permission_audit (actor, action, subject_id, subject, target, reason)
  values (p_actor, 'grant_role', p_subject_id, v_subject, p_role, p_reason);
end $$;

create or replace function public.revoke_role(
  p_actor_id uuid, p_actor text, p_subject_id uuid, p_role text, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_subject text; v_admins int;
begin
  select email into v_subject from public.profiles where id = p_subject_id;
  if v_subject is null then raise exception 'No profile %', p_subject_id; end if;

  -- Never leave the tool with nobody who can administer it. Losing the last
  -- admin is only fixable from the SQL editor, and the person who needs to fix
  -- it is exactly the person who just lost the ability to.
  if p_role = 'admin' then
    select count(*) into v_admins from public.profile_roles where role = 'admin';
    if v_admins <= 1 then
      raise exception 'Refusing to revoke the last admin. Grant admin to someone else first.';
    end if;
  end if;

  delete from public.profile_roles where profile_id = p_subject_id and role = p_role;

  insert into public.permission_audit (actor, action, subject_id, subject, target, reason)
  values (p_actor, 'revoke_role', p_subject_id, v_subject, p_role, p_reason);
end $$;

-- Direct capability grants get the same treatment, so the audit log is complete
-- whichever mechanism was used. Same self-grant guard, keyed off is_sensitive.
create or replace function public.grant_capability(
  p_actor_id uuid, p_actor text, p_subject_id uuid, p_capability text, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_subject text; v_sensitive boolean;
begin
  select email into v_subject from public.profiles where id = p_subject_id;
  if v_subject is null then raise exception 'No profile %', p_subject_id; end if;

  select coalesce(bool_or(is_sensitive), false) into v_sensitive
  from public.permissions where name = p_capability;
  if p_actor_id = p_subject_id and v_sensitive then
    raise exception 'Refusing self-grant of %. Ask the other admin.', p_capability;
  end if;

  insert into public.profile_capabilities (profile_id, capability, granted_by)
  values (p_subject_id, p_capability, p_actor)
  on conflict (profile_id, capability) do nothing;

  insert into public.permission_audit (actor, action, subject_id, subject, target, reason)
  values (p_actor, 'grant_capability', p_subject_id, v_subject, p_capability, p_reason);
end $$;

create or replace function public.revoke_capability(
  p_actor_id uuid, p_actor text, p_subject_id uuid, p_capability text, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_subject text;
begin
  select email into v_subject from public.profiles where id = p_subject_id;
  if v_subject is null then raise exception 'No profile %', p_subject_id; end if;

  delete from public.profile_capabilities
  where profile_id = p_subject_id and capability = p_capability;

  insert into public.permission_audit (actor, action, subject_id, subject, target, reason)
  values (p_actor, 'revoke_capability', p_subject_id, v_subject, p_capability, p_reason);
end $$;

-- No `authenticated` EXECUTE on any of the four. The browser cannot call these
-- even with a forged body; the server route is the only caller, and it checks
-- manage_permissions first. Two independent gates, neither sufficient alone.
revoke execute on function public.grant_role(uuid, text, uuid, text, text)         from anon, authenticated, public;
revoke execute on function public.revoke_role(uuid, text, uuid, text, text)        from anon, authenticated, public;
revoke execute on function public.grant_capability(uuid, text, uuid, text, text)   from anon, authenticated, public;
revoke execute on function public.revoke_capability(uuid, text, uuid, text, text)  from anon, authenticated, public;
grant execute on function public.grant_role(uuid, text, uuid, text, text)          to service_role;
grant execute on function public.revoke_role(uuid, text, uuid, text, text)         to service_role;
grant execute on function public.grant_capability(uuid, text, uuid, text, text)    to service_role;
grant execute on function public.revoke_capability(uuid, text, uuid, text, text)   to service_role;

-- ── STEP 7: seed the roles onto the people who already have the access ────────
-- Additive and idempotent. The three finance holders keep their 079 direct
-- grants AND gain the role — can() unions the two, so this changes nothing about
-- what they can see today. It exists so the admin UI shows "finance" against
-- their names instead of a bare capability, and so revoking finance from someone
-- later is one role removal rather than a hunt through direct grants.
--
-- admin goes to David and Shanu (his decision, 2026-08-27). Two, deliberately:
-- one admin plus a self-grant guard equals nobody who can grant a sensitive
-- permission at all. Vineet holds finance but not admin.
insert into public.profile_roles (profile_id, role, granted_by)
select p.id, 'finance', 'migration 085'
from public.profiles p
where lower(p.email) in ('david@alpharoc.ai', 'shanu@alpharoc.ai', 'vineet@alpharoc.ai')
on conflict do nothing;

insert into public.profile_roles (profile_id, role, granted_by)
select p.id, 'admin', 'migration 085'
from public.profiles p
where lower(p.email) in ('david@alpharoc.ai', 'shanu@alpharoc.ai')
on conflict do nothing;

insert into public.permission_audit (actor, action, subject_id, subject, target, reason)
select 'migration 085', 'grant_role', p.id, p.email, pr.role,
       'Seeded from the access that already existed (079 direct grants) plus David''s admin decision.'
from public.profiles p
join public.profile_roles pr on pr.profile_id = p.id
where pr.granted_by = 'migration 085'
  and not exists (
    select 1 from public.permission_audit a
    where a.subject_id = p.id and a.target = pr.role and a.actor = 'migration 085'
  );

-- ── STEP 8: provisioning intent — close the auto-analyst hole ─────────────────
-- 031 puts a trigger on auth.users: any @alpharoc.ai signup silently becomes an
-- 'analyst', which is what grants access to everything. That was correct when
-- every internal account was a trusted analyst, and it is the reason internal
-- access is self-serve. It stops being correct the moment the first non-analyst
-- (a salesperson) is invited, because they would land with full analyst access
-- before anyone touched their profile.
--
-- The fix keeps self-serve and removes the dangerous case, rather than trading
-- one for the other: the trigger now CONSULTS this table. An email listed here
-- is provisioned at the tier it names; an email not listed still becomes an
-- analyst exactly as before. So nothing changes for the existing team or the
-- next analyst hire — and a salesperson cannot land as an analyst even if
-- somebody invites them from the Supabase dashboard without reading a runbook.
--
-- Rows for the three known salespeople are NOT inserted here: 'sales' was only
-- just added to the enum (step 0) and Postgres will not let this transaction use
-- it. 086 seeds them, and until then no sales account should be created.
create table if not exists public.profile_provisioning (
  email      text primary key,
  role       public.profile_role not null,
  note       text,
  added_by   text,
  added_at   timestamptz not null default now()
);
comment on table public.profile_provisioning is
  'Pre-registered tier for an email that has not signed up yet. 031''s trigger reads this; an unlisted @alpharoc.ai address still defaults to analyst. Add the row BEFORE inviting anyone who is not an analyst.';

alter table public.profile_provisioning enable row level security;
revoke all on public.profile_provisioning from anon, authenticated;
grant select on public.profile_provisioning to authenticated;
grant all on public.profile_provisioning to service_role;
drop policy if exists profile_provisioning_analyst_read on public.profile_provisioning;
create policy profile_provisioning_analyst_read on public.profile_provisioning for select to authenticated
  using (public.my_role() = 'analyst');
drop policy if exists profile_provisioning_service_all on public.profile_provisioning;
create policy profile_provisioning_service_all on public.profile_provisioning
  for all to service_role using (true) with check (true);

-- The trigger function, replacing 031's. Same name, same trigger, so there is
-- nothing to re-wire. Two changes from 031: it reads profile_provisioning, and
-- it is explicit that an unlisted address falls back to 'analyst' — which is
-- 031's entire behaviour, preserved.
--
-- `security definer` and a pinned search_path are inherited from 031 and matter
-- more here than usual: this runs as a trigger on auth.users, i.e. during signup,
-- under the auth admin's rights.
create or replace function public.provision_internal_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_role public.profile_role;
begin
  if new.email is null then return new; end if;

  select pp.role into v_role
  from public.profile_provisioning pp
  where lower(pp.email) = lower(new.email);

  if v_role is not null then
    -- Pre-registered: provision at exactly the tier that was intended, whatever
    -- the address. This is also the only path by which a non-alpharoc.ai
    -- internal account could ever be created, which is why the row has to be
    -- added deliberately by an admin.
    insert into public.profiles (id, email, role)
    values (new.id, new.email, v_role)
    on conflict (id) do nothing;
  elsif lower(new.email) like '%@alpharoc.ai' then
    -- Unlisted company address: analyst, exactly as 031 did.
    insert into public.profiles (id, email, role)
    values (new.id, new.email, 'analyst')
    on conflict (id) do nothing;
  end if;
  -- Anything else (an external compliance reviewer) is still provisioned
  -- explicitly by the recipients API, not here.
  return new;
end $$;

commit;
