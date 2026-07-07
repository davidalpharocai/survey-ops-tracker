-- Phase 2 connector writes: attribution GUC, write audit substrate, idempotency,
-- contact attribution, and SECURITY DEFINER write RPCs.

-- 1) Contact attribution (client_contacts had no created_by).
alter table public.client_contacts add column if not exists created_by text;

-- 2) Queryable write-audit substrate on the existing tool-call log.
alter table public.mcp_tool_calls
  add column if not exists detail jsonb,
  add column if not exists project_id uuid,
  add column if not exists client_id uuid,
  add column if not exists error_code text,
  add column if not exists error_message text;
create index if not exists mcp_tool_calls_project_idx on public.mcp_tool_calls(project_id);
create index if not exists mcp_tool_calls_client_idx  on public.mcp_tool_calls(client_id);

-- 3) Race-safe idempotency for money appends.
alter table public.project_blasts add column if not exists idem_key text;
alter table public.project_bids   add column if not exists idem_key text;
create unique index if not exists project_blasts_idem_uq
  on public.project_blasts(project_id, idem_key) where idem_key is not null;
create unique index if not exists project_bids_idem_uq
  on public.project_bids(project_id, idem_key) where idem_key is not null;
