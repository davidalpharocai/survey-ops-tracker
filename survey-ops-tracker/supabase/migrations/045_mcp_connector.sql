-- Claude connector (MCP): OAuth storage, reminders, tool-call audit.

create table public.oauth_clients (
  id text primary key,
  name text not null default 'Claude',
  redirect_uris jsonb not null,
  created_at timestamptz not null default now()
);

create table public.oauth_codes (
  code_hash text primary key,
  client_id text not null references public.oauth_clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  scope text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table public.oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text unique not null,
  refresh_hash text unique,
  client_id text not null references public.oauth_clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null,          -- display/logging ONLY, never authorization
  scope text not null default 'read reminders:write',
  expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  rotated_at timestamptz,
  replaced_by uuid,
  grace_used boolean not null default false,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index oauth_tokens_user_idx on public.oauth_tokens(user_id);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null,
  text text not null,
  due_date date not null,
  project_id uuid references public.survey_projects(id) on delete set null,
  done boolean not null default false,
  done_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index reminders_user_due_idx on public.reminders(user_id, due_date);
create index reminders_project_idx on public.reminders(project_id);

create table public.mcp_tool_calls (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  tool text not null,
  duration_ms int,
  ok boolean not null,
  created_at timestamptz not null default now()
);
create index mcp_tool_calls_created_idx on public.mcp_tool_calls(created_at);

-- RLS: deny-by-default everywhere; service_role explicit; reminders owner-scoped;
-- mcp_tool_calls analyst-readable (mirrors system_events).
alter table public.oauth_clients  enable row level security;
alter table public.oauth_codes    enable row level security;
alter table public.oauth_tokens   enable row level security;
alter table public.reminders      enable row level security;
alter table public.mcp_tool_calls enable row level security;
revoke all on public.oauth_clients, public.oauth_codes, public.oauth_tokens,
           public.reminders, public.mcp_tool_calls from anon, authenticated;

create policy "service_role all" on public.oauth_clients  for all to service_role using (true) with check (true);
create policy "service_role all" on public.oauth_codes    for all to service_role using (true) with check (true);
create policy "service_role all" on public.oauth_tokens   for all to service_role using (true) with check (true);
create policy "service_role all" on public.reminders      for all to service_role using (true) with check (true);
create policy "service_role all" on public.mcp_tool_calls for all to service_role using (true) with check (true);

grant select, insert, update, delete on public.reminders to authenticated;
create policy "own reminders" on public.reminders for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select on public.mcp_tool_calls to authenticated;
create policy "analysts read tool calls" on public.mcp_tool_calls for select to authenticated
  using (public.my_role() = 'analyst');

-- reminders is a new child of survey_projects: recreate merge_projects (044) with
-- the reminders re-point added, so merges don't strand reminders on the loser.
create or replace function public.merge_projects(p_survivor uuid, p_loser uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  actor text := coalesce(nullif(auth.email(), ''), 'system');
  survivor_code text;
  loser_code text;
  ver_offset int;
begin
  if public.my_role() <> 'analyst' then raise exception 'Not authorized'; end if;
  if p_survivor = p_loser then raise exception 'Cannot merge a project into itself'; end if;
  if not exists (select 1 from survey_projects where id = p_survivor and deleted_at is null)
    then raise exception 'Survivor project not found'; end if;
  if not exists (select 1 from survey_projects where id = p_loser and deleted_at is null)
    then raise exception 'Loser project not found'; end if;
  if exists (select 1 from project_segments where project_id in (p_survivor, p_loser))
    then raise exception 'Un-split segmented N before merging'; end if;

  update project_bids        set project_id = p_survivor where project_id = p_loser;
  update project_blasts       set project_id = p_survivor where project_id = p_loser;
  update project_steps        set project_id = p_survivor where project_id = p_loser;
  update project_activity     set project_id = p_survivor where project_id = p_loser;
  update project_data_changes set project_id = p_survivor where project_id = p_loser;
  update deliverables         set project_id = p_survivor where project_id = p_loser;
  update project_audit        set project_id = p_survivor where project_id = p_loser;
  update reminders            set project_id = p_survivor where project_id = p_loser;

  select coalesce(max(version), 0) into ver_offset
    from question_submissions where project_id = p_survivor;
  update question_submissions qs
    set project_id = p_survivor, version = ver_offset + r.rn
    from (
      select id, row_number() over (order by version, id) as rn
      from question_submissions where project_id = p_loser
    ) r
    where qs.id = r.id;

  delete from project_recipients l
    where l.project_id = p_loser
      and exists (select 1 from project_recipients s
                  where s.project_id = p_survivor and s.email = l.email and s.role = l.role);
  update project_recipients set project_id = p_survivor where project_id = p_loser;

  delete from project_seen where project_id = p_loser;

  update survey_projects set deleted_at = now() where id = p_loser;

  select project_code into survivor_code from survey_projects where id = p_survivor;
  select project_code into loser_code   from survey_projects where id = p_loser;
  insert into project_audit(project_id, field, new_value, changed_by)
    values (p_survivor, 'merged_in', coalesce(loser_code, p_loser::text), actor);
  insert into project_audit(project_id, field, new_value, changed_by)
    values (p_loser, 'merged_into', coalesce(survivor_code, p_survivor::text), actor);
end $$;
