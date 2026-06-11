-- Hard gate: the database itself refuses to create accounts
-- outside the alpharoc.ai domain (defense in depth — the app
-- also enforces this server-side on every request).
create or replace function public.enforce_alpharoc_domain()
returns trigger as $$
begin
  if new.email is null or lower(new.email) not like '%@alpharoc.ai' then
    raise exception 'Only alpharoc.ai accounts are allowed';
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists enforce_domain on auth.users;
create trigger enforce_domain
  before insert on auth.users
  for each row execute function public.enforce_alpharoc_domain();
