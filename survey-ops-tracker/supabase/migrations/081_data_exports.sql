-- 081: data_exports — a log of who pulled data OUT of SOCC.
--
-- Financial visibility (client price per N, margin) is a SOFT gate: the money
-- columns are hidden from everyone outside finance in the UI, but any analyst can
-- hit an export route, so an export is the obvious way around it. Hard-blocking
-- exports would break everyday CSV work, so instead every export is recorded —
-- who, what route, how many rows, the filters that produced it, and whether the
-- payload actually carried the restricted columns.
--
-- WRITES ARE SERVICE-ROLE ONLY, and that is the whole point. This table audits the
-- same analysts who can read it, and actor_email is the only attribution it carries.
-- If `authenticated` could INSERT, an analyst could log their own export under a
-- colleague's address — actor_email is free text, not an identity — so the trail
-- would fail exactly when someone had a reason to falsify it. mcp_tool_calls (045)
-- takes this same posture: it grants authenticated SELECT and nothing else, and
-- every write goes through the server.
--
-- Append-only for everyone else: analysts may SELECT, and there is no UPDATE or
-- DELETE grant or policy, so nobody can quietly edit their own trail. The service
-- role keeps full access, so retention/pruning stays a deliberate server-side job
-- rather than something RLS decides.
--
-- HONEST LIMIT: this proves nothing about exports that were never logged. An analyst
-- who pulls a CSV without going through the logging path simply leaves no row, and
-- nothing in the schema can detect that absence — the log is only ever as complete as
-- the code that writes it. That argues for logging INSIDE the export path (same
-- request that builds the payload), not in a separate call the client can skip.
-- Apply in the Supabase SQL editor.

create table if not exists public.data_exports (
  id uuid primary key default gen_random_uuid(),
  actor_email text not null,             -- display/logging ONLY, never authorization; set server-side (see grants)
  route text not null,                   -- what was exported: '/api/export/projects' | 'client-csv' | ...
  row_count integer not null default 0,
  filters jsonb,                         -- the query behind the payload (null = not recorded)
  included_restricted boolean not null default false,
  created_at timestamptz not null default now()
);
-- The admin listing is "most recent exports first".
create index if not exists data_exports_created_idx on public.data_exports (created_at desc);

comment on column public.data_exports.included_restricted is
  'True when the exported payload carried the finance-restricted columns (client price per N, margin, revenue). Finance visibility is only a soft gate in the UI, so this is how an ordinary CSV pull is told apart from one that carried the money columns out of the app.';

alter table public.data_exports enable row level security;
revoke all on public.data_exports from anon, authenticated;
grant select on public.data_exports to authenticated;
grant all on public.data_exports to service_role;

drop policy if exists "service_role all" on public.data_exports;
create policy "service_role all" on public.data_exports for all to service_role using (true) with check (true);

drop policy if exists "analysts read exports" on public.data_exports;
create policy "analysts read exports" on public.data_exports for select to authenticated
  using (public.my_role() = 'analyst');

-- No insert grant and no insert policy, deliberately. Whoever wires the export
-- route MUST write this log with createAdminClient() (lib/supabase/admin.ts) on the
-- server, taking actor_email from the session — supabase.auth.getUser() — and never
-- from the request body or the browser client, which the audited party controls.
-- app/api/activity/delete/route.ts is the shape to copy: requireAnalyst() to
-- authorize, then the service-role client for the write, because the table has no
-- matching RLS policy for `authenticated`.
-- The drop below is for anyone who already applied the first draft of this
-- migration, which did grant analysts INSERT; it is a no-op on a fresh apply.
drop policy if exists "analysts log exports" on public.data_exports;
