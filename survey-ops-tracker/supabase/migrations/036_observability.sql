-- Observability / safety net: make silent backend failures and AI spend visible
-- to a non-technical owner, and let the AI budget be capped.
--
--  * ai_usage      — one row per Claude API call (tokens + computed cost).
--  * system_events — cron / job outcomes (ok / partial / error) so a failed
--                    nightly sync surfaces in the app instead of failing silently.
--  * app_config    — singleton of tunables (AI monthly cap + hard-stop toggle),
--                    editable from Admin like sprint_config.

-- ---------------------------------------------------------------------------
-- AI usage log
-- ---------------------------------------------------------------------------
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  endpoint text not null,                 -- 'assistant' | 'parse-project' | ...
  user_email text,                        -- who triggered it (null for system)
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_creation_tokens integer not null default 0,
  cost_usd numeric(10,4) not null default 0
);
create index if not exists ai_usage_created_idx on public.ai_usage (created_at desc);

alter table public.ai_usage enable row level security;
-- Internal team can read usage; only the service role writes it.
create policy "analyst read ai_usage" on public.ai_usage
  for select using (public.my_role() = 'analyst');
create policy "service role full ai_usage" on public.ai_usage
  for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- System events (cron / job heartbeat + errors)
-- ---------------------------------------------------------------------------
create table if not exists public.system_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null,                   -- 'sync-survey-ids' | 'daily-digest' | ...
  status text not null default 'ok',      -- 'ok' | 'partial' | 'error'
  detail text,
  meta jsonb
);
create index if not exists system_events_created_idx on public.system_events (created_at desc);
create index if not exists system_events_source_idx on public.system_events (source, created_at desc);

alter table public.system_events enable row level security;
create policy "analyst read system_events" on public.system_events
  for select using (public.my_role() = 'analyst');
create policy "service role full system_events" on public.system_events
  for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- App config singleton (AI budget controls)
-- ---------------------------------------------------------------------------
create table if not exists public.app_config (
  id integer primary key default 1,
  ai_monthly_cap_usd numeric(10,2) not null default 50,
  ai_hard_stop boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint app_config_singleton check (id = 1)
);
insert into public.app_config (id) values (1) on conflict (id) do nothing;

alter table public.app_config enable row level security;
-- Internal team can read and adjust the budget; service role reads it server-side.
create policy "analyst read app_config" on public.app_config
  for select using (public.my_role() = 'analyst');
create policy "analyst update app_config" on public.app_config
  for update using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');
create policy "service role full app_config" on public.app_config
  for all to service_role using (true) with check (true);
