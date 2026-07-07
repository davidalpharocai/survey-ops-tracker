# Claude Connector (MCP) — Phase 1 Design

**Date:** 2026-07-06 · **Status:** direction approved by David (architecture + OAuth-from-day-one). Hardened after a 3-lens adversarial review (protocol, security, codebase-fit; 30 findings folded in). Awaiting David's spec approval → implementation plan.

## Goal

Any AlphaROC analyst connects **their own Claude** — claude.ai web & mobile, Claude Desktop, or Claude Code — to the Survey Ops Command Center as a **custom connector**, then asks questions about projects/clients and manages personal reminders in plain chat. No pasted tokens: a **"Log in with Survey Ops"** OAuth flow. Phase 1 is **read-only on tracker data** plus a new **reminders** capability (read/write). Phase 2 (later): record writes.

**Decisions locked (David, 2026-07-06):**
1. All three Claude surfaces from day one → **OAuth, no manual tokens**.
2. Scope: **read tools + reminders** first; writes in Phase 2.
3. **Internal @alpharoc.ai analysts only.** Portal/compliance users cannot connect.

## Architecture

Everything lives inside the existing Next.js app on Vercel — no new service.

```
User's Claude ──HTTPS──▶ /api/mcp  (MCP endpoint, streamable HTTP ONLY)
                          │  Authorization: Bearer <opaque token>
                          ▼
              token lookup (sha256) → LIVE profiles re-check → analyst gate
                          ▼
              tool handlers → Supabase (service-role, scoped by our checks)

Connect flow ──▶ /.well-known discovery ──▶ /api/oauth/register (DCR, allowlisted)
             ──▶ /oauth/authorize (consent page on existing Supabase login)
             ──▶ /api/oauth/token (code/refresh exchange)
```

**The MCP endpoint is exactly `https://survey-ops-tracker.vercel.app/api/mcp`** — implemented as a **static route** `app/api/mcp/route.ts` using `mcp-handler` with `basePath: '/api'` (mcp-handler matches the pathname, so a static mount works and deliberately does **not** expose an `/sse` route; legacy SSE needs Redis which we don't run — SSE requests fail fast with 404/405 rather than half-connecting). Node runtime, `maxDuration 60`. This URL is the canonical **resource identifier** used consistently in the protected-resource metadata `resource` field, the `WWW-Authenticate` challenge, and the Connect page.

**New dependencies:** `mcp-handler`, `@modelcontextprotocol/sdk`, and `zod` pinned to `^3` (the SDK peer-depends on zod v3; v4 breaks tool registration).

## OAuth 2.1 layer

### Discovery
- `app/.well-known/oauth-protected-resource/[[...resource]]/route.ts` — optional catch-all serving the **same JSON at both** `/.well-known/oauth-protected-resource` **and** `/.well-known/oauth-protected-resource/api/mcp` (RFC 9728 path-aware lookup — some Claude clients only try the path-inserted variant). Fields: `resource` = `https://survey-ops-tracker.vercel.app/api/mcp` (exact), `authorization_servers` = [app base URL], `scopes_supported` = ["read","reminders:write"], `bearer_methods_supported` = ["header"].
- `app/.well-known/oauth-authorization-server/route.ts` — must include **all** of: `issuer` (base URL, exactly matching the metadata host), `authorization_endpoint` (/oauth/authorize), `token_endpoint` (/api/oauth/token), `registration_endpoint` (/api/oauth/register), `response_types_supported` ["code"], `grant_types_supported` ["authorization_code","refresh_token"], `code_challenge_methods_supported` ["S256"], `token_endpoint_auth_methods_supported` **["none"]** (public clients), `scopes_supported` ["read","reminders:write"]. Also alias the same document at `/.well-known/openid-configuration` (some clients probe OIDC discovery first).
- Unauthenticated MCP requests get `401` + `WWW-Authenticate: Bearer resource_metadata="<protected-resource metadata URL>"`.

### Dynamic client registration — `/api/oauth/register`
- RFC 7591, unauthenticated by design, public clients only (no secret), PKCE mandatory.
- **redirect_uris are validated against a strict allowlist** (this is the load-bearing security control — open registration + open redirect_uris = one-click token theft via a spoofed consent page):
  - `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback` (claude.ai web/mobile),
  - `http://localhost:<any-port>/...` and `http://127.0.0.1:<any-port>/...` (Claude Desktop / Claude Code loopback; port is a wildcard, host is not).
  - Anything else → `invalid_redirect_uri`.
- Payload validation: `client_name` ≤ 100 chars, ≤ 5 redirect_uris, each syntactically valid. Response: `201` with `client_id` + echoed metadata.
- Abuse friction: per-IP rate limit (~5/hour; in-memory per instance is acceptable v1) and a cleanup rule — delete `oauth_clients` with no tokens after 30 days.

### Authorize — `app/oauth/authorize/page.tsx`
- Requires a logged-in Supabase session; if absent → `/login?next=<full original authorize URL incl. query>`. **Work item: the main login form currently ignores `?next=` (hard-codes `router.push('/')`) — extend it to honor `next`, validated as a same-origin relative path (starts with `/`, not `//`, no scheme/backslash; the `safeNext` pattern from `app/auth/confirm/route.ts`), falling back to `/`.**
- Consent is **required on every authorize request** (no silent re-approval) and displays the requesting `client_name` **and the redirect host** ("This will return you to claude.ai") so a spoofed client is visible.
- **Allow is a POST** (server action) that re-verifies the Supabase session, `isAllowedEmail`, and `profiles.role='analyst'` **server-side at code-issuance time**. CSRF protection is Next.js server actions' built-in same-origin enforcement (Allow/Deny are server-action POSTs; `serverActions.allowedOrigins` must never be configured) — the accepted v1 substitute for a session-bound CSRF token. Codes are never issued from a GET. The page sets `Content-Security-Policy: frame-ancestors 'none'` (no security headers exist app-wide today — this page sets its own).
- Non-analyst (e.g. portal user) → clear on-page refusal ("internal analysts only") with an option to return via `error=access_denied` redirect.

### Validation checklist (authorize + token) — normative
1. `redirect_uri` in the authorize request must **exact-string-match** one of the client's registered `redirect_uris`; on mismatch render an **error page — never redirect** (redirecting to an unvalidated URI is the code-exfiltration vector).
2. Reject authorize requests missing `code_challenge` or with `code_challenge_method != 'S256'` (explicitly reject `plain`).
3. Round-trip `state` **unmodified** on success (`code=…&state=…`) AND error redirects (`error=access_denied&state=…`); Deny → `error=access_denied`. Claude validates `state` and breaks without it.
4. Accept the RFC 8707 `resource` parameter on both authorize and token requests (Claude sends it); validate it equals the canonical MCP endpoint URL, reject others with `invalid_target`. With exactly one resource, storing it is optional — but do not reject the param as unknown.
5. Token endpoint: verify the code belongs to the presenting `client_id` and that `redirect_uri` equals the one stored with the code; reject exchanges missing `code_verifier`.
6. Token endpoint parses `application/x-www-form-urlencoded` (accept JSON too); responds `{ access_token, token_type: "Bearer", expires_in: 28800, refresh_token, scope }` with `Cache-Control: no-store` + `Pragma: no-cache`.

### Tokens & lifecycle
- Access token `sot_` + 32 random bytes base64url, TTL **8h**; refresh token same entropy, TTL **90 days**; **authorization code same generator**, TTL 5 min. All stored **sha256-hashed only**.
- **Atomic single-use code consumption**: `UPDATE oauth_codes SET consumed_at=now() WHERE code_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING …`; reuse of a consumed code revokes any tokens already issued from it.
- **Refresh rotation with a one-shot ~60s grace retry**: rotation is an atomic single-row update that also expires the superseded access token; within 60s of rotation the previous refresh token may be presented **once more** (atomically claimed via `grace_used`) and mints a fresh pair — absorbing a lost-response retry without forcing re-login; a second within-window presentation returns `invalid_grant`; reuse **after** the window is treated as theft and revokes all live tokens for that (user_id, client_id). User-initiated Revoke (Connect page) is **family-wide** — it kills every generation of that connection's tokens at once. Columns `rotated_at`/`replaced_by`/`grace_used` support this.
- CORS: `Access-Control-Allow-Origin: *` + OPTIONS on the metadata, register, and token endpoints (token auth is body-borne, not cookie-borne, so this is safe there; the authorize *page* is not CORS-exposed).

## Data-access model (per MCP request)

1. Look up the bearer token by hash → reject if missing/expired/revoked; stamp `last_used_at`.
2. **Re-fetch the LIVE `profiles` row by `user_id`** — if the row is missing, `role != 'analyst'`, or the current email fails `isAllowedEmail` → `401` **and set `revoked_at` on the token**. The denormalized `oauth_tokens.user_email` is for display/logging only, never for authorization (a stale snapshot would give ex-employees up to 90 days of access).
3. Tool handlers then use the service-role client. Equivalent to per-user RLS for Phase 1 (analysts have full read access in-app); reminders are always explicitly scoped `user_id = token.user_id`. Phase 2 writes will re-evaluate this.
4. Offboarding = delete the auth user; all tokens/codes/reminders die with it via FK cascade (below).

**Tool-arg hygiene (normative):** never build `.or()` filter strings from raw tool args — issue separate `.ilike()` queries and merge, or strip/escape PostgREST-reserved chars (`, ( ) .`) and LIKE wildcards (`% _ \`) first; cap `query` args at 100 chars. (This pattern gets copied into Phase 2 write tools, so it must be right now.)

## Migration 045 (new tables)

```sql
oauth_clients   (id text pk, name text, redirect_uris jsonb not null,
                 created_at timestamptz default now())

oauth_codes     (code_hash text pk, client_id text references oauth_clients,
                 user_id uuid not null references auth.users(id) on delete cascade,
                 redirect_uri text not null, code_challenge text not null,
                 scope text not null, expires_at timestamptz not null,
                 consumed_at timestamptz)

oauth_tokens    (id uuid pk default gen_random_uuid(),
                 token_hash text unique not null, refresh_hash text unique,
                 client_id text references oauth_clients,
                 user_id uuid not null references auth.users(id) on delete cascade,
                 user_email text not null,           -- display/logging ONLY
                 scope text not null default 'read reminders:write',
                 expires_at timestamptz not null, refresh_expires_at timestamptz not null,
                 rotated_at timestamptz, replaced_by uuid,
                 revoked_at timestamptz, last_used_at timestamptz,
                 created_at timestamptz default now())

reminders       (id uuid pk default gen_random_uuid(),
                 user_id uuid not null references auth.users(id) on delete cascade,
                 user_email text not null, text text not null,
                 due_date date not null,             -- ET semantics
                 project_id uuid references survey_projects(id) on delete set null,
                 done boolean not null default false, done_at timestamptz,
                 notified_at timestamptz, created_at timestamptz default now())

mcp_tool_calls  (id uuid pk default gen_random_uuid(),
                 user_email text not null, tool text not null,
                 duration_ms int, ok boolean not null,
                 created_at timestamptz default now())   -- NO argument payloads
```

**RLS (follows the 007/036 pattern — the load-bearing half):** `alter table … enable row level security` on **all five** tables, `revoke all … from anon`, explicit `for all to service_role` policies, **no** anon/authenticated policies on the oauth tables and `mcp_tool_calls` (deny-by-default; without enabling RLS, Supabase's default grants would let any logged-in user — including portal users — read/write these tables and forge token rows). `reminders` additionally gets owner-only policies (`user_id = auth.uid()`) for a future in-app UI. `mcp_tool_calls` gets an analyst-read policy (mirror `system_events`).

**Merge-feature integration:** `reminders.project_id` is a new child FK on `survey_projects` — migration 045 **recreates `merge_projects()`** (from 044) adding `update reminders set project_id = p_survivor where project_id = p_loser;` to the re-point list, so merges don't strand reminders on a soft-deleted loser.

## The tools (Phase 1)

Compact JSON out (ids, codes, names, dates, Ns, budgets) — the user's Claude does the summarizing.

| Tool | Args | Returns |
|---|---|---|
| `search_projects` | `query?`, `status?` (**Open/Hold/Closed** — the `project_status` enum), `phase?` (**Scoping/Active** — scoping is a *phase*, not a status), `captain?`, `due_before?`, `due_after?`, `limit?` (20) | code, name, client, status, phase (+ `scoping_stage` when Scoping), board column, due date, N collected/target, captain, salesperson |
| `get_project` | `project` (PR-code or name) | Full record + bids, blasts (+spend totals), next steps, latest activity (10), deliverables, segment Ns, compliance state, reminders linked to it (caller's own) |
| `pipeline_summary` | — | Digest shape: overdue, due ≤3 days, fielding-behind-pace, counts by stage/status |
| `search_clients` | `query?`, `limit?` | Cl-code, name, open/closed project counts, compliance flags |
| `get_client` | `client` (Cl-code or name) | Profile + contacts, notes, compliance settings, project list |
| `list_activity` | `project?`, `limit?` (20) | Recent logged activity newest-first |
| `decode_survey_id` | `id` | Deterministic parse: anchor on the 8-digit `YYYYMMDD`; letters after it = region; prefix split by **longest-prefix match against `team_members.initials`** → owner, remainder = client+project abbreviation; if no initials match, return the prefix unsplit with a note |
| `create_reminder` | `text`, `due_date` (YYYY-MM-DD), `project?` | The created reminder |
| `list_reminders` | `include_done?` (false) | Caller's reminders, soonest first |
| `complete_reminder` | `id` | Marks done (caller's own only) |
| `delete_reminder` | `id` | Removes it (caller's own only) |

Shared behavior: resolve `project`/`client` by code first, then case-insensitive name; ambiguous → return candidates, never guess. Closed projects returned as one-line summaries (same shape the in-app assistant uses).

**Relationship to the in-app assistant:** these tools are the your-own-Claude counterpart of `/api/assistant`. Extract the shared serialization (stripped-field list, closed-project summary shape, survey-ID knowledge) from `app/api/assistant/route.ts` into a shared module so the two surfaces can't drift.

## Reminders delivery

- Daily Vercel cron `/api/cron/reminders-due` at **11:30 UTC** (before the 12:00 digest), guarded by `CRON_SECRET` like the existing crons: for each analyst with `due_date <= today`, `done = false`, `notified_at is null` → one email listing them.
- **Stamp `notified_at` ONLY when the send succeeds** (`sendAndLog` returns `false` on failure, it never throws) — on failure leave it null so tomorrow's run retries, and log a `system_events` error row so it surfaces in the digest's health section. Never stamp-then-send.
- **Rollout precondition (blocking):** the email transport must be *proven* before this ships — `lib/email/send.ts` uses Resend, whose alpharoc.ai domain verification previously failed on Wix DNS (SendGrid switch was already decided but not executed), and `RESEND_API_KEY`/`EMAIL_FROM` may not be set in Vercel. Either verify Resend works end-to-end (send one real test email) or execute the SendGrid switch and make `sendAndLog` transport-agnostic first.
- Managing reminders happens through Claude; the email is the delivery. No in-app reminders UI in Phase 1.

## The Connect page

`app/(app)/connect/page.tsx`, linked from the ☰ AppMenu:
- The connector URL (`https://survey-ops-tracker.vercel.app/api/mcp`) in a copy box + per-surface steps (claude.ai web/mobile → Settings → Connectors → Add custom connector; Claude Desktop; Claude Code `claude mcp add`). Note the plan requirement (below).
- **Active connections**: the signed-in user's `oauth_tokens` (client name, created, last used) with **Revoke** (sets `revoked_at`; Claude re-prompts to log in).

## Security summary

- Analyst-only at three layers: consent (server-side re-check at code issuance), token issuance, and a **live** profiles re-check on every MCP request (token auto-revoked if the gate fails).
- Registration redirect_uri allowlist (claude.ai/claude.com callbacks + loopback) kills the spoofed-client/consent-phishing vector; consent shows the client + destination and is never silent.
- Tokens/codes opaque + hashed; PKCE S256 only; atomic single-use codes (reuse revokes descendants); refresh rotation w/ 60s idempotent grace, reuse-after-grace revokes the family; FK cascade kills everything on offboarding.
- Consent is POST + session-bound CSRF token + `frame-ancestors 'none'`.
- Every tool call logged to `mcp_tool_calls` (no argument payloads). No Anthropic API cost server-side.

## Out of scope (Phase 1)

Record writes (Phase 2, with confirmation UX); portal-user access; auto-reminders from due dates; in-app reminders UI; recurring reminders; Slack delivery of reminders; per-user tool permissions; rate limiting beyond the register endpoint.

## Rollout

1. **Preconditions:** (a) email transport proven (see Reminders); (b) confirm the team's claude.ai plan supports member-added custom connectors (Pro/Max do; on Team/Enterprise an owner may need to add it workspace-wide — Claude Desktop/Code unaffected).
2. Migration 045 (David runs in Supabase SQL editor).
3. Deploy. New env vars: none required beyond the (verified) email transport's.
4. David adds the connector in claude.ai → Log in → tests: "what's due this week?", "remind me Friday to chase the Holocene deliverable".
5. Update `USER_GUIDE.md` (+ refresh the Google Doc copy at the milestone) and roll out to the team via the Connect page.

## Test checklist (acceptance)

- Connector added in claude.ai web → Log in → Supabase login (with `?next=` honored) → consent shows "Claude" + destination → connected. Same on Desktop + Claude Code.
- Registration with a non-allowlisted redirect_uri → `invalid_redirect_uri`. Authorize with mismatched redirect_uri → error page, no redirect.
- Portal/compliance account → consent refuses ("internal analysts only").
- `search_projects` (incl. `phase='Scoping'`), `get_project("PR00119")`, `pipeline_summary()` return correct live data; a search `query` containing `,()%_` neither errors nor over-matches.
- `create_reminder` → scoped to caller; cron emails on due date (and only stamps `notified_at` on success); `complete_reminder` stops emails; merging two projects re-points reminders to the survivor.
- Revoke on Connect page → next call 401 → Claude re-prompts. Deleted auth user → tokens dead (cascade).
- Expired access token → silent refresh; a *retried* refresh within 60s still succeeds (idempotent); reuse of an old refresh after the window revokes the family.
