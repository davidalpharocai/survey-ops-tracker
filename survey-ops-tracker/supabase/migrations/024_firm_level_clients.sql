-- Compliance reviewers see ALL of their firm's projects, not just one
-- contact's. The free-text client field follows a "FIRM - contact" pattern
-- ("BAM - James Cook"), which migration 005 turned into contact-level client
-- rows. Normalize to firm level: "BAM - James Cook" and "BAM - jared khoo"
-- both map to firm client "BAM".

create or replace function public.client_firm_name(raw text)
returns text language sql immutable as
$$ select trim(split_part(raw, ' - ', 1)) $$;

-- Create firm-level client rows where missing
insert into public.clients (name)
select distinct public.client_firm_name(name) from public.clients
where public.client_firm_name(name) <> name
  and public.client_firm_name(name) <> ''
on conflict (name) do nothing;

-- Repoint projects from contact-level to firm-level clients
update public.survey_projects sp
set client_id = f.id
from public.clients c
join public.clients f on f.name = public.client_firm_name(c.name)
where sp.client_id = c.id
  and public.client_firm_name(c.name) <> c.name;

-- Repoint compliance reviewer profiles the same way
update public.profiles p
set client_id = f.id
from public.clients c
join public.clients f on f.name = public.client_firm_name(c.name)
where p.client_id = c.id
  and public.client_firm_name(c.name) <> c.name;

-- Remove now-orphaned contact-level client rows
delete from public.clients c
where public.client_firm_name(c.name) <> c.name
  and not exists (select 1 from public.survey_projects where client_id = c.id)
  and not exists (select 1 from public.profiles where client_id = c.id);

-- New projects link to the FIRM client from now on (replaces 005's trigger fn)
create or replace function public.sync_project_client()
returns trigger language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if new.client is null or trim(new.client) = '' then
    return new;
  end if;
  insert into public.clients (name) values (public.client_firm_name(new.client))
  on conflict (name) do update set name = excluded.name
  returning id into cid;
  new.client_id = cid;
  return new;
end $$;
