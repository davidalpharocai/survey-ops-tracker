-- Make internal access self-serve: every @alpharoc.ai account automatically
-- gets an 'analyst' profile (which is what grants access to the whole tool).
-- Without this, a newly-added employee has no profile row and the app bounces
-- them to /login. External compliance reviewers (non-alpharoc emails) are
-- provisioned explicitly by the recipients API as 'compliance' and are skipped.

-- 1) Backfill: catch any internal user added since migration 006 who is
--    missing a profile (this also un-sticks anyone currently locked out).
insert into public.profiles (id, email, role)
select id, email, 'analyst'
from auth.users
where email is not null
  and lower(email) like '%@alpharoc.ai'
on conflict (id) do nothing;

-- 2) Going forward: auto-provision on account creation.
create or replace function public.provision_internal_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and lower(new.email) like '%@alpharoc.ai' then
    insert into public.profiles (id, email, role)
    values (new.id, new.email, 'analyst')
    on conflict (id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists provision_profile on auth.users;
create trigger provision_profile
  after insert on auth.users
  for each row execute function public.provision_internal_profile();
