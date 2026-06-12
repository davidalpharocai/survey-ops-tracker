-- Migration 014's hard domain gate blocks ALL non-alpharoc.ai account
-- creation — including the external compliance reviewers the portal must
-- provision. Narrow exception: an email may get an account only if an
-- analyst has already added it as a compliance contact on a project
-- (project_recipients role='compliance'). The recipients API inserts that
-- row BEFORE creating the auth user, so the allowlist entry exists when
-- this trigger fires. Everything else stays blocked.
create or replace function public.enforce_alpharoc_domain()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and lower(new.email) like '%@alpharoc.ai' then
    return new;
  end if;
  if new.email is not null and exists (
    select 1 from public.project_recipients
    where lower(email) = lower(new.email) and role = 'compliance'
  ) then
    return new;
  end if;
  raise exception 'Only alpharoc.ai accounts are allowed';
end;
$$;
