# In-App Assistant — Agentic Upgrade (Design)

**Date:** 2026-07-16
**Status:** Approved (design), pending spec review → plan → build
**Scope:** This spec covers ONLY the in-app assistant upgrade. The Calendar tab is a separate spec.

## Goal

Make the in-app `✦ Assistant` as capable as the MCP connector — full read **and** write over projects, clients, contacts, steps, blasts, reminders, status/stage, compliance — with preview-then-confirm safety, but with **zero external setup** (no OAuth; it uses the logged-in session). Reuse the connector's tool implementations so there is one source of truth.

## Background (current state)

- `app/api/assistant/route.ts` — read-only. Serializes the **entire** dataset (all projects + recent activity + steps + data-changes) into the system prompt, streams one Opus answer. No tools, no writes. Doesn't scale as data grows.
- `app/api/mcp/route.ts` — a ~30-tool agentic surface (read + write) backed by `lib/mcp/data.ts` (reads) and `lib/mcp/writes.ts` (writes). Preview-then-confirm on mutating tools, compliance gate on stage moves, idempotency on blasts, `mcp_tool_calls` telemetry, clean error messages. Tool *definitions* are inline in the route; the *logic* is already in the shared libs.
- `components/assistant/AssistantPanel.tsx` — floating bottom-right panel, streams raw text from `/api/assistant`.

## Decisions (from brainstorming)

1. **Power:** Full read + write, **preview-then-confirm** (mirrors the connector's safety).
2. **Confirm model:** **UI-gated.** The model can only ever *preview* a write. The actual commit happens only when the user clicks **Confirm** in the panel. The model cannot save a change on its own.
3. **Surfaces:** upgraded **floating panel on every page** + **⌘/Ctrl-K** to open, **and** a dedicated full-page **`/assistant`** tab. Same engine behind both.
4. **Context-aware:** on a project/client page the assistant is told the current PR/Cl code so "advance this to fielding" / "log a blast here" resolves without naming it.
5. **Identity:** logged-in Supabase session; writes attributed `"<email> via in-app assistant"`.

## Architecture

### 1. Shared tool registry (`lib/mcp/registry.ts`)

Extract the tools currently inline in `app/api/mcp/route.ts` into one exported array. Each entry:

```ts
export type ToolCtx = { userId: string; userEmail: string }
export type ToolMeta = { project_id?: string; client_id?: string; detail?: unknown }
export interface AssistantTool {
  name: string
  description: string
  schema: z.ZodRawShape          // same shapes used today
  kind: 'read' | 'write'         // write = mutating (needs UI confirm in-app)
  // For write tools that lack an internal confirm/preview path (append tools),
  // a one-line human summary of what committing will do.
  previewSummary?: (args: Record<string, unknown>) => string
  handler: (args: Record<string, unknown>, ctx: ToolCtx, meta: ToolMeta) => Promise<unknown>
}
export const TOOLS: AssistantTool[]
```

The tool bodies are the *same code* that runs today — the only change is they receive `ctx` (instead of calling `authIdentity(extra)`) and mutate the passed-in `meta`. Shared helpers used by the tools (`confirmable`, `describeChanges`, `fieldLabel`, `fmtChangeVal`, `todayEastern`, `fetchDocTitle`, field allow-lists, `MCP_INSTRUCTIONS`) move into `registry.ts` (or a sibling `lib/mcp/toolHelpers.ts`) so both callers import them.

`kind` classification:
- **read:** `search_projects, get_project, pipeline_summary, get_me, get_client_history, get_project_history, search_clients, get_client, list_activity, get_email, decode_survey_id, list_reminders`
- **write:** everything else (`create_project, update_project, advance_project, set_project_status, approve_scoping, move_to_scoping, set_compliance_override, set_requested_by, log_blast, add_next_step, complete_next_step, edit_next_step, add_note, add_client_note, link_document, update_client, rename_client, create_client, add_contact, edit_contact, archive_contact, add_team_member, set_client_preference, create_reminder, complete_reminder, delete_reminder`). Reminder writes are personal + low-risk but still routed through confirm for consistency.

### 2. MCP route becomes a thin adapter

`app/api/mcp/route.ts` iterates `TOOLS` and registers each via `server.tool(t.name, t.description, t.schema, (args, extra) => json(await logged(extra, t.name, () => t.handler(args, authIdentity(extra), meta), meta)))`. **No behavior change** — the connector keeps working exactly as today (append tools still commit directly there; confirmable tools still key off `args.confirm`). Covered by existing connector expectations + a smoke test that the registry length and names match.

### 3. In-app agent loop (`app/api/assistant/route.ts`, rewritten)

- Auth: Supabase session (`isAllowedEmail`), same budget guard + `logAiUsage` as today.
- Resolve `ctx` from the session: `userId` = the Supabase **auth user id** (`session.user.id`) and `userEmail` = `session.user.email` — the same two values the connector's OAuth path puts in `authInfo.extra`, so every tool (reminders keyed on `user_id`, `getMe`, `mine:true` filters) behaves identically whether called via the connector or in-app.
- Build Anthropic `tools` from `TOOLS` (name, description, `zodToJsonSchema(schema)`).
- System prompt = a trimmed version of `MCP_INSTRUCTIONS` + in-app specifics (context-awareness note, "you cannot commit writes yourself — previews are confirmed by the user in the UI"). Optional small context block: the current page's PR/Cl code when provided by the client.
- Run the **tool-use loop** (Opus 4.8, adaptive thinking, streaming):
  - **read tool call** → execute `handler(args, ctx, meta)` inline, feed result back to the model, continue.
  - **write tool call** → the server **does not commit**. It produces a preview:
    - confirmable tools → run `handler` with `confirm:false` (existing preview path);
    - append/other writes → synthesize a preview via `previewSummary(args)`.
    It then mints a **signed action token** `sign({ tool, args, userEmail, exp })` (HMAC with a server secret; ~10-min expiry; stateless — safe for serverless), emits a `pending_action` stream event `{ id, tool, summary, preview, token }`, and feeds the preview back to the model as the tool result so it can narrate. The loop pauses awaiting the user (the model's turn ends after narrating).
- **Streaming protocol:** newline-delimited JSON events, replacing today's raw-text stream:
  - `{ type:'text', delta }` — assistant text
  - `{ type:'tool', name, phase:'start'|'done' }` — tool activity (panel shows "🔧 searching projects…")
  - `{ type:'pending', id, tool, summary, preview, token }` — a write awaiting confirmation
  - `{ type:'done' }` / `{ type:'error', message }`

### 4. Commit endpoint (`app/api/assistant/act/route.ts`, new)

- `POST { token }`. Verify HMAC + expiry, and that `token.userEmail === session email` (a token can only be redeemed by the user it was minted for). Re-resolve `ctx` from the session.
- Run the write for real: confirmable tools → `handler({ ...args, confirm:true }, ctx, meta)`; append tools → `handler(args, ctx, meta)`. Same audit logging, compliance gate, idempotency, and `mcp_tool_calls` telemetry as the connector.
- Return the commit result. The panel marks the pending action **✓ Done** (or shows the error, e.g. a blocked compliance gate).
- **Cancel** is client-only — drop the token, no server call.

This is the crux of UI-gated safety: **writes only ever execute here, and only with a user-redeemed token.** The chat model never receives or sends `confirm:true`.

### 5. Panel + surfaces

- `AssistantPanel.tsx`: parse the event stream; render text bubbles, a subtle tool-activity line, and a **pending-action card** (summary + preview details + **Confirm** / **Cancel**). On Confirm → POST `/api/assistant/act`, then show ✓/error. Keep the existing look; add message roles for tool/pending.
- Pass the current page context (PR/Cl code) into the request when on a project/client page.
- **⌘/Ctrl-K**: global listener opens the panel (and focuses input).
- **`/assistant` full page**: a route under `(app)` that renders the same chat engine full-width with history for the session; add a nav entry. Panel and page share a `useAssistantChat` hook holding the send/stream/confirm logic so there's no duplication.

## Data flow (write example)

1. On PR00228's page: "advance this to fielding."
2. Loop: model calls `advance_project { project:'PR00228', to_column:'Fielding' }`. Server runs preview (compliance gate checked), mints token, streams `pending` with the preview. Model streams "I'll advance PR00228 to Fielding — confirm below."
3. Panel shows the preview + Confirm/Cancel.
4. Confirm → `POST /api/assistant/act { token }` → server commits via `runProjectWrite` → audit + telemetry → returns result → panel shows ✓.
5. (If the gate blocks) the `act` response carries the block reason; the panel surfaces it and the user can ask the assistant to override with a reason (a fresh preview/confirm cycle).

## Error handling

- Missing/invalid API key, budget-blocked, rate-limit → same user-facing messages as today (503 / inline).
- Tool errors → `cleanErrorMessage` (never leak DB internals), surfaced as a tool result to the model and, for commits, as an error on the pending-action card.
- Token invalid/expired/mismatched user → `act` returns a clear "This confirmation expired — ask again" and no write happens.
- Compliance-gate block on commit → returned as a structured block, not an error.

## Security / safety

- Writes execute **only** in `/api/assistant/act`, **only** with a valid HMAC token bound to the session user. Prompt-injection or model error cannot commit a change — there is no code path where the model's output triggers a write.
- Same `isAllowedEmail` gate as today on both endpoints.
- Reuses the compliance gate, idempotency (blasts), and `mcp_tool_calls`/audit logging unchanged.

## Testing

- `registry.test.ts`: every tool has name/description/schema/kind; names are unique; the set equals what the MCP route registers (guards against drift).
- Token: sign→verify round-trip; rejects tampered, expired, wrong-user tokens.
- Loop (unit, mocked Anthropic stream): read tool executes inline; write tool does **not** execute, emits `pending` with a token; `act` with that token commits exactly once.
- Adapter: MCP route still registers all tools and a confirmable tool still previews without `confirm`.
- Manual: end-to-end read ("what's overdue"), a confirmable write (update a field), an append write (add a next step), a compliance-gated advance (blocked → override), on both the floating panel and `/assistant`.

## Out of scope

Calendar tab (next spec); any new tools beyond the connector's; voice; shared/multi-user chat history; changing connector behavior.
