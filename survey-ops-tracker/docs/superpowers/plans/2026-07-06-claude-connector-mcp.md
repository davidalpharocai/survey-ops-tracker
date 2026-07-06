# Claude Connector (MCP) Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Phase 1 Claude connector: OAuth "Log in with Survey Ops" + `/api/mcp` endpoint with 11 read/reminder tools + reminders email cron + Connect page, per the spec `docs/superpowers/specs/2026-07-06-claude-connector-mcp-design.md` (the spec is AUTHORITATIVE — when this plan and the spec disagree, the spec wins, except where a task below explicitly says otherwise).

**Architecture:** OAuth 2.1 (PKCE, DCR w/ redirect allowlist, opaque hashed tokens) layered on the existing Supabase login; MCP via `mcp-handler` as a static route at exactly `/api/mcp` (streamable HTTP only); tools use the service-role client after a live per-request analyst re-check; reminders delivered by a daily cron through a transport-agnostic `sendAndLog`.

**Tech Stack:** Next.js 15 App Router, Supabase, `mcp-handler` + `@modelcontextprotocol/sdk` + `zod@^3`, `nodemailer` (Gmail SMTP), Vercel cron.

**Conventions:** Run `npx next build` / `npx vitest run` FROM `survey-ops-tracker/`. David applies SQL migrations manually (the app must degrade gracefully until 045 runs: OAuth/MCP routes return clean errors, nothing crashes at build/render time). Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Repo bans `any` (build error). Tailwind v4 arbitrary values only.

**Third-party API caveat:** the exact `mcp-handler` / MCP SDK signatures below are best-known-current. The implementer MUST check the installed package's README + type declarations (`node_modules/mcp-handler/README.md`, `.d.ts`) and adapt call signatures if they differ — while preserving the CONTRACTS (endpoint URL `/api/mcp`, no SSE, bearer auth via `verifyToken` with live re-check, tool names/args/returns).

---

## File structure

- `supabase/migrations/045_mcp_connector.sql` — 5 tables + RLS + merge_projects recreate.
- `lib/oauth/crypto.ts` (+test) — secrets, sha256, PKCE verify.
- `lib/oauth/redirects.ts` (+test) — the redirect_uri allowlist.
- `lib/oauth/store.ts` — clients/codes/tokens CRUD (admin client), rotation + grace.
- `app/.well-known/oauth-protected-resource/[[...resource]]/route.ts` — RFC 9728 metadata (both paths).
- `app/.well-known/oauth-authorization-server/route.ts` + `app/.well-known/openid-configuration/route.ts` — AS metadata.
- `app/api/oauth/register/route.ts` — DCR + allowlist + rate limit.
- `app/api/oauth/token/route.ts` — code/refresh exchange.
- `app/oauth/authorize/page.tsx` + `app/oauth/authorize/actions.ts` — consent page + POST server action.
- `app/(auth)/login/login-form.tsx` — honor `?next=` (safe relative paths).
- `next.config.ts` — `frame-ancestors 'none'` header on `/oauth/authorize`.
- `lib/mcp/data.ts` (+test) — sanitized queries, resolvers, decode_survey_id, serialization shared with the assistant.
- `app/api/mcp/route.ts` — the MCP handler + 11 tools + auth wrapper + `mcp_tool_calls` logging.
- `lib/email/send.ts` — add nodemailer SMTP transport (keep `sendAndLog` contract).
- `app/api/cron/reminders-due/route.ts` + `vercel.json` — daily reminders email.
- `app/(app)/connect/page.tsx` + revoke server action + AppMenu link.
- `USER_GUIDE.md` — Connect-your-Claude section.

---

## Task 1: Dependencies

**Files:** Modify `package.json` (via npm), commit lockfile too.

- [ ] **Step 1:** From `survey-ops-tracker/`: `npm install mcp-handler @modelcontextprotocol/sdk zod@^3 nodemailer && npm install -D @types/nodemailer`
- [ ] **Step 2:** Verify `npx next build` still compiles clean.
- [ ] **Step 3:** Commit `package.json` + `package-lock.json`: `feat(mcp): deps — mcp-handler, MCP SDK, zod v3, nodemailer`

## Task 2: Migration 045

**Files:** Create `supabase/migrations/045_mcp_connector.sql`. (David runs it later — do NOT run any SQL.)

- [ ] **Step 1:** Write the file exactly:

```sql
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
```

- [ ] **Step 2:** Add the five tables to `lib/supabase/types.ts` (Row/Insert/Update, matching generated style; `reminders.due_date` is `string`).
- [ ] **Step 3:** `npx next build` clean → commit both files: `feat(mcp): migration 045 — oauth storage, reminders, tool-call audit + merge repoint`

## Task 3: OAuth crypto + redirect allowlist (TDD)

**Files:** Create `lib/oauth/crypto.ts`, `lib/oauth/crypto.test.ts`, `lib/oauth/redirects.ts`, `lib/oauth/redirects.test.ts`.

- [ ] **Step 1:** Failing tests:

```ts
// lib/oauth/crypto.test.ts
import { describe, it, expect } from 'vitest'
import { newSecret, sha256, verifyPkce } from './crypto'
import { createHash } from 'crypto'

describe('crypto', () => {
  it('generates prefixed 43+ char url-safe secrets', () => {
    const s = newSecret('sot_')
    expect(s.startsWith('sot_')).toBe(true)
    expect(s.length).toBeGreaterThanOrEqual(47)
    expect(/^[A-Za-z0-9_-]+$/.test(s.slice(4))).toBe(true)
    expect(newSecret('sot_')).not.toBe(s)
  })
  it('sha256 is stable hex', () => {
    expect(sha256('abc')).toBe(createHash('sha256').update('abc').digest('hex'))
  })
  it('verifyPkce S256 round-trips', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    expect(verifyPkce(verifier, challenge)).toBe(true)
    expect(verifyPkce(verifier + 'x', challenge)).toBe(false)
  })
})
```

```ts
// lib/oauth/redirects.test.ts
import { describe, it, expect } from 'vitest'
import { isAllowedRedirect } from './redirects'

describe('isAllowedRedirect', () => {
  it('allows the Claude callbacks', () => {
    expect(isAllowedRedirect('https://claude.ai/api/mcp/auth_callback')).toBe(true)
    expect(isAllowedRedirect('https://claude.com/api/mcp/auth_callback')).toBe(true)
  })
  it('allows loopback on any port and path', () => {
    expect(isAllowedRedirect('http://localhost:53682/callback')).toBe(true)
    expect(isAllowedRedirect('http://127.0.0.1:8976/oauth/cb')).toBe(true)
  })
  it('rejects everything else', () => {
    expect(isAllowedRedirect('https://attacker.example/cb')).toBe(false)
    expect(isAllowedRedirect('https://claude.ai.evil.com/api/mcp/auth_callback')).toBe(false)
    expect(isAllowedRedirect('https://claude.ai/other/path')).toBe(false)
    expect(isAllowedRedirect('http://localhost.evil.com/cb')).toBe(false)
    expect(isAllowedRedirect('javascript:alert(1)')).toBe(false)
    expect(isAllowedRedirect('not a url')).toBe(false)
  })
})
```

- [ ] **Step 2:** Run both → FAIL (module not found).
- [ ] **Step 3:** Implement:

```ts
// lib/oauth/crypto.ts
import { createHash, randomBytes } from 'crypto'

/** Opaque secret: prefix + 32 random bytes, base64url. Used for access/refresh tokens and auth codes. */
export function newSecret(prefix: string): string {
  return prefix + randomBytes(32).toString('base64url')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** PKCE S256: sha256(verifier) base64url must equal the stored challenge. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  return createHash('sha256').update(verifier).digest('base64url') === challenge
}
```

```ts
// lib/oauth/redirects.ts
// The load-bearing security control: only genuine Claude callbacks (or local
// loopback for Desktop/Code) may ever receive an authorization code.
const EXACT_ALLOWED = new Set([
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
])

export function isAllowedRedirect(uri: string): boolean {
  let u: URL
  try { u = new URL(uri) } catch { return false }
  if (EXACT_ALLOWED.has(u.origin + u.pathname)) return true
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true
  return false
}
```

- [ ] **Step 4:** Run tests → PASS. Commit: `feat(mcp): oauth crypto + redirect allowlist`

## Task 4: OAuth store

**Files:** Create `lib/oauth/store.ts`.

All functions use `createAdminClient()` from `@/lib/supabase/admin`. TTLs: code 5 min, access 8h, refresh 90d, rotation grace 60s.

- [ ] **Step 1:** Implement:

```ts
import 'server-only'
import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { newSecret, sha256 } from './crypto'

const CODE_TTL_MS = 5 * 60_000
const ACCESS_TTL_S = 8 * 3600
const REFRESH_TTL_MS = 90 * 86_400_000
const ROTATION_GRACE_MS = 60_000
export const SCOPE = 'read reminders:write'

export type TokenPair = { accessToken: string; refreshToken: string; expiresIn: number }

export async function registerClient(name: string, redirectUris: string[]): Promise<string> {
  const id = randomUUID()
  const supabase = createAdminClient()
  const { error } = await supabase.from('oauth_clients')
    .insert({ id, name, redirect_uris: redirectUris })
  if (error) throw error
  return id
}

export async function getClient(id: string) {
  const supabase = createAdminClient()
  const { data } = await supabase.from('oauth_clients').select('*').eq('id', id).maybeSingle()
  return data
}

export async function issueCode(args: {
  clientId: string; userId: string; redirectUri: string; codeChallenge: string
}): Promise<string> {
  const code = newSecret('soc_')
  const supabase = createAdminClient()
  const { error } = await supabase.from('oauth_codes').insert({
    code_hash: sha256(code), client_id: args.clientId, user_id: args.userId,
    redirect_uri: args.redirectUri, code_challenge: args.codeChallenge,
    scope: SCOPE, expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })
  if (error) throw error
  return code
}

/** Atomic single-use consumption. Returns the row once; reuse revokes descendants. */
export async function consumeCode(code: string) {
  const supabase = createAdminClient()
  const hash = sha256(code)
  const { data } = await supabase.from('oauth_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('code_hash', hash).is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select().maybeSingle()
  if (data) return data
  // Reuse of a consumed code is a theft signal: revoke tokens issued to that user+client.
  const { data: burnt } = await supabase.from('oauth_codes').select('user_id, client_id')
    .eq('code_hash', hash).maybeSingle()
  if (burnt) {
    await supabase.from('oauth_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', burnt.user_id).eq('client_id', burnt.client_id).is('revoked_at', null)
  }
  return null
}

export async function issueTokens(args: {
  clientId: string; userId: string; userEmail: string
}): Promise<TokenPair> {
  const accessToken = newSecret('sot_')
  const refreshToken = newSecret('sor_')
  const supabase = createAdminClient()
  const { error } = await supabase.from('oauth_tokens').insert({
    token_hash: sha256(accessToken), refresh_hash: sha256(refreshToken),
    client_id: args.clientId, user_id: args.userId, user_email: args.userEmail,
    scope: SCOPE,
    expires_at: new Date(Date.now() + ACCESS_TTL_S * 1000).toISOString(),
    refresh_expires_at: new Date(Date.now() + REFRESH_TTL_MS).toISOString(),
  })
  if (error) throw error
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_S }
}

/**
 * Refresh rotation with a grace window: a refresh presented within 60s of an
 * earlier rotation still yields a fresh pair (absorbs lost-response retries);
 * presented after the window, it is treated as theft and the family dies.
 */
export async function exchangeRefresh(refreshToken: string): Promise<TokenPair | null> {
  const supabase = createAdminClient()
  const hash = sha256(refreshToken)
  const { data: row } = await supabase.from('oauth_tokens').select('*')
    .eq('refresh_hash', hash).maybeSingle()
  if (!row || row.revoked_at) return null
  if (new Date(row.refresh_expires_at).getTime() < Date.now()) return null

  if (row.rotated_at) {
    const withinGrace = Date.now() - new Date(row.rotated_at).getTime() < ROTATION_GRACE_MS
    if (!withinGrace) {
      // Reuse after grace = theft signal: revoke the whole user+client family.
      await supabase.from('oauth_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('user_id', row.user_id).eq('client_id', row.client_id).is('revoked_at', null)
      return null
    }
    return mint(row) // grace retry: fresh pair, family stays alive
  }

  // First use: atomically claim the rotation (guards concurrent refreshes).
  const { data: claimed } = await supabase.from('oauth_tokens')
    .update({ rotated_at: new Date().toISOString() })
    .eq('id', row.id).is('rotated_at', null)
    .select().maybeSingle()
  if (!claimed) {
    // Lost the race — treat like a grace retry.
    return mint(row)
  }
  const pair = await mint(claimed)
  return pair

  async function mint(from: { client_id: string; user_id: string; user_email: string; id: string }): Promise<TokenPair> {
    const pair2 = await issueTokens({ clientId: from.client_id, userId: from.user_id, userEmail: from.user_email })
    const { data: newRow } = await supabase.from('oauth_tokens').select('id')
      .eq('token_hash', sha256(pair2.accessToken)).maybeSingle()
    if (newRow) {
      await supabase.from('oauth_tokens').update({ replaced_by: newRow.id }).eq('id', from.id)
    }
    return pair2
  }
}

/** Bearer lookup for MCP requests. Returns the live row or null. */
export async function findAccessToken(accessToken: string) {
  const supabase = createAdminClient()
  const { data } = await supabase.from('oauth_tokens').select('*')
    .eq('token_hash', sha256(accessToken)).is('revoked_at', null)
    .gt('expires_at', new Date().toISOString()).maybeSingle()
  if (data) {
    void supabase.from('oauth_tokens')
      .update({ last_used_at: new Date().toISOString() }).eq('id', data.id)
      .then(() => {}, () => {})
  }
  return data
}

export async function revokeToken(id: string, userId: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('oauth_tokens').update({ revoked_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', userId)
}

export async function revokeTokenById(id: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('oauth_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', id)
}

export async function listUserTokens(userId: string) {
  const supabase = createAdminClient()
  const { data } = await supabase.from('oauth_tokens')
    .select('id, client_id, created_at, last_used_at, expires_at, refresh_expires_at')
    .eq('user_id', userId).is('revoked_at', null).is('replaced_by', null)
    .order('created_at', { ascending: false })
  return data ?? []
}
```

- [ ] **Step 2:** Add the five new tables to types if Task 2 didn't already (they must exist before this compiles). `npx next build` clean.
- [ ] **Step 3:** Commit: `feat(mcp): oauth store — codes, tokens, rotation with grace window`

## Task 5: Discovery + register + token endpoints

**Files:** Create the two `.well-known` routes (+ openid alias), `app/api/oauth/register/route.ts`, `app/api/oauth/token/route.ts`, and a small `lib/oauth/http.ts` for CORS.

- [ ] **Step 1:** `lib/oauth/http.ts`:

```ts
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, mcp-protocol-version',
}
export function corsJson(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...CORS_HEADERS, ...extra } })
}
export function optionsResponse() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}
export function baseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://survey-ops-tracker.vercel.app'
}
export const MCP_RESOURCE = () => `${baseUrl()}/api/mcp`
```

- [ ] **Step 2:** `app/.well-known/oauth-protected-resource/[[...resource]]/route.ts` (same JSON at the root path AND `/api/mcp`-suffixed path):

```ts
import { corsJson, optionsResponse, baseUrl, MCP_RESOURCE } from '@/lib/oauth/http'
export const dynamic = 'force-dynamic'
export async function GET() {
  return corsJson({
    resource: MCP_RESOURCE(),
    authorization_servers: [baseUrl()],
    scopes_supported: ['read', 'reminders:write'],
    bearer_methods_supported: ['header'],
  })
}
export async function OPTIONS() { return optionsResponse() }
```

- [ ] **Step 3:** `app/.well-known/oauth-authorization-server/route.ts` — returns:

```ts
{
  issuer: baseUrl(),
  authorization_endpoint: `${baseUrl()}/oauth/authorize`,
  token_endpoint: `${baseUrl()}/api/oauth/token`,
  registration_endpoint: `${baseUrl()}/api/oauth/register`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  scopes_supported: ['read', 'reminders:write'],
}
```

(same corsJson/OPTIONS pattern; `app/.well-known/openid-configuration/route.ts` re-exports the same GET.)

- [ ] **Step 4:** `app/api/oauth/register/route.ts` — POST only: parse JSON body; validate `client_name` (≤100 chars, default 'Claude'), `redirect_uris` array (1–5 entries, every entry passes `isAllowedRedirect` else 400 `{error:'invalid_redirect_uri'}`); in-memory per-IP rate limit (Map<ip, timestamps[]>, max 5/hour, 429 on excess); `registerClient(...)` → `201` `{ client_id, client_name, redirect_uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code','refresh_token'], response_types: ['code'] }` with CORS. OPTIONS handled.

- [ ] **Step 5:** `app/api/oauth/token/route.ts` — POST: parse `application/x-www-form-urlencoded` (via `await req.formData()`; fall back to JSON on `content-type: application/json`). Common response headers: CORS + `Cache-Control: no-store` + `Pragma: no-cache`. Branches:
  - `grant_type=authorization_code`: require `code`, `code_verifier`, `client_id`, `redirect_uri`. `consumeCode(code)` → 400 `{error:'invalid_grant'}` if null; reject if `row.client_id !== client_id` or `row.redirect_uri !== redirect_uri` (invalid_grant); `verifyPkce(code_verifier, row.code_challenge)` else invalid_grant. If a `resource` param is present it must equal `MCP_RESOURCE()` else 400 `{error:'invalid_target'}`. Live gate: fetch profiles by `row.user_id`; must exist, role='analyst', email passes `isAllowedEmail` — else 400 invalid_grant. Then `issueTokens(...)` → 200 `{ access_token, token_type: 'Bearer', expires_in, refresh_token, scope: SCOPE }`.
  - `grant_type=refresh_token`: require `refresh_token`; optional `resource` validated the same; `exchangeRefresh(...)` → null ⇒ 400 invalid_grant, else same 200 shape.
  - anything else → 400 `{error:'unsupported_grant_type'}`.

- [ ] **Step 6:** `npx next build` clean. Commit: `feat(mcp): oauth discovery, dynamic registration, token endpoint`

## Task 6: Consent page + login `next=` fix

**Files:** Create `app/oauth/authorize/page.tsx` + `app/oauth/authorize/actions.ts`; modify `app/(auth)/login/login-form.tsx`, `next.config.ts`.

- [ ] **Step 1:** `actions.ts` — two server actions (`'use server'`). Both re-derive EVERYTHING server-side from the submitted authorize params (never trust hidden fields for identity):

```ts
'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedEmail } from '@/lib/utils/allowedDomain'
import { getClient, issueCode } from '@/lib/oauth/store'

type AuthorizeParams = {
  client_id: string; redirect_uri: string; state?: string; code_challenge: string
}

async function requireAnalyst() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAllowedEmail(user.email)) return null
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles')
    .select('role').eq('id', user.id).maybeSingle()
  if (!profile || profile.role !== 'analyst') return null
  return user
}

export async function allowAction(params: AuthorizeParams) {
  const user = await requireAnalyst()
  if (!user) redirect('/login')
  const client = await getClient(params.client_id)
  const uris = (client?.redirect_uris ?? []) as string[]
  if (!client || !uris.includes(params.redirect_uri)) {
    redirect('/oauth/authorize?error=bad_client') // error page render, never redirect out
  }
  const code = await issueCode({
    clientId: params.client_id, userId: user!.id,
    redirectUri: params.redirect_uri, codeChallenge: params.code_challenge,
  })
  const url = new URL(params.redirect_uri)
  url.searchParams.set('code', code)
  if (params.state) url.searchParams.set('state', params.state)
  redirect(url.toString())
}

export async function denyAction(params: Pick<AuthorizeParams, 'client_id' | 'redirect_uri' | 'state'>) {
  const client = await getClient(params.client_id)
  const uris = (client?.redirect_uris ?? []) as string[]
  if (!client || !uris.includes(params.redirect_uri)) redirect('/')
  const url = new URL(params.redirect_uri)
  url.searchParams.set('error', 'access_denied')
  if (params.state) url.searchParams.set('state', params.state)
  redirect(url.toString())
}
```

- [ ] **Step 2:** `page.tsx` — a server component. Reads `searchParams` (`client_id, redirect_uri, state, code_challenge, code_challenge_method, scope, resource, response_type, error`). Validation cascade, ALL failures render an on-page error card (never redirect to the unvalidated URI): unknown client_id; `redirect_uri` not an exact member of the client's registered list; `response_type !== 'code'`; missing `code_challenge`; `code_challenge_method !== 'S256'`; `resource` present but ≠ `MCP_RESOURCE()`. If no Supabase session → `redirect('/login?next=' + encodeURIComponent(full current URL path+query))`. If session but not analyst → on-page "This connector is for internal AlphaROC analysts only" + a Deny-style return link. Otherwise render the consent card: client name, "This will return you to <redirect host>", scope summary ("Read your Survey Ops projects · Manage your reminders"), and two forms whose actions are `allowAction`/`denyAction` bound with the validated params. (Next server actions carry built-in origin/CSRF checks for POSTs; note this in a comment.)
- [ ] **Step 3:** `next.config.ts` — add `headers()` for `/oauth/authorize`: `Content-Security-Policy: frame-ancestors 'none'` + `X-Frame-Options: DENY`.
- [ ] **Step 4:** `login-form.tsx` — read `const nextParam = searchParams.get('next')`; add helper `const safeNext = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') && !nextParam.includes('\\') ? nextParam : '/'`; replace `router.push('/')` with `router.push(safeNext)`. Nothing else changes.
- [ ] **Step 5:** `npx next build` + `npx vitest run` (login tests still pass). Commit: `feat(mcp): consent page with strict validation + login honors safe next=`

## Task 7: MCP data layer (TDD)

**Files:** Create `lib/mcp/data.ts` + `lib/mcp/data.test.ts`.

Pure/query helpers the tools call. Reuse the in-app assistant's serialization ideas (see `app/api/assistant/route.ts`): closed projects as one-line summaries; strip noisy columns (`created_at`, `updated_at`, `calendar_event_id`, `survey_ids_from_sheet`, `survey_ids_synced_at`, the six `stage_*` booleans).

- [ ] **Step 1:** Failing tests for the pure parts:

```ts
// lib/mcp/data.test.ts
import { describe, it, expect } from 'vitest'
import { sanitizeQuery, decodeSurveyId } from './data'

describe('sanitizeQuery', () => {
  it('strips PostgREST-reserved and escapes LIKE wildcards', () => {
    expect(sanitizeQuery('acme, (test) 50%_x')).toBe('acme test 50\\%\\_x')
  })
  it('caps length at 100', () => {
    expect(sanitizeQuery('a'.repeat(500)).length).toBeLessThanOrEqual(100)
  })
})

describe('decodeSurveyId', () => {
  const initials = ['AL', 'SR', 'JC']
  it('parses owner + abbreviation + date + region', () => {
    expect(decodeSurveyId('ALBNFOF20260529UK', initials)).toEqual({
      owner: 'AL', abbreviation: 'BNFOF', date: '2026-05-29', region: 'UK',
    })
  })
  it('handles no region and unknown owner', () => {
    expect(decodeSurveyId('SRACME20260601', initials)).toEqual({
      owner: 'SR', abbreviation: 'ACME', date: '2026-06-01', region: null,
    })
    const r = decodeSurveyId('ZZACME20260601', initials)
    expect(r?.owner).toBeNull()
    expect(r?.abbreviation).toBe('ZZACME')
  })
  it('returns null when no date anchor', () => {
    expect(decodeSurveyId('NODATEHERE', initials)).toBeNull()
  })
})
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `lib/mcp/data.ts`:

```ts
import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/** Tool args are user-controlled: strip PostgREST-reserved chars, escape LIKE wildcards, cap length. */
export function sanitizeQuery(q: string): string {
  return q.replace(/[,().]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/([%_\\])/g, '\\$1').slice(0, 100)
}

/** [owner initials][client+project abbrev][YYYYMMDD][region?] — anchor on the 8-digit date. */
export function decodeSurveyId(
  id: string, teamInitials: string[]
): { owner: string | null; abbreviation: string; date: string; region: string | null } | null {
  const m = id.toUpperCase().match(/^([A-Z]+)(\d{8})([A-Z]*)$/)
  if (!m) return null
  const [, prefix, ymd, region] = m
  const date = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
  // longest-prefix match against team initials to peel off the owner
  const owner = [...teamInitials].sort((a, b) => b.length - a.length)
    .find(i => prefix.startsWith(i.toUpperCase())) ?? null
  return {
    owner,
    abbreviation: owner ? prefix.slice(owner.length) : prefix,
    date,
    region: region || null,
  }
}

const STRIPPED = [
  'created_at', 'updated_at', 'calendar_event_id', 'survey_ids_from_sheet',
  'survey_ids_synced_at', 'stage_doc_programming', 'stage_survey_programming',
  'stage_edwin_qa', 'stage_fielding', 'stage_data_qa', 'stage_delivery',
] as const

type Row = Record<string, unknown>

export function slimProject(p: Row): Row {
  if (p.status === 'Closed') {
    return {
      project_code: p.project_code, project_name: p.project_name, client: p.client,
      project_type: p.project_type, status: 'Closed', submitted_date: p.submitted_date,
      deliver_date: p.deliver_date, n_target: p.n_target, n_actual: p.n_actual,
      budget: p.budget, actual_spend: p.actual_spend, salesperson: p.salesperson,
    }
  }
  const slim: Row = { ...p }
  for (const f of STRIPPED) delete slim[f]
  return slim
}

// ---- query helpers (service-role; caller has already passed the analyst gate) ----

export async function searchProjects(args: {
  query?: string; status?: string; phase?: string; captain?: string;
  due_before?: string; due_after?: string; limit?: number
}) {
  const supabase = createAdminClient()
  let q = supabase.from('survey_projects')
    .select('project_code, project_name, client, status, phase, scoping_stage, board_column, due_date, n_collected, n_target, salesperson, captain:team_members(name, initials)')
    .is('deleted_at', null)
    .or('project_type.is.null,project_type.neq.Internal')
  if (args.query) {
    const s = sanitizeQuery(args.query)
    q = q.or(`project_name.ilike.%${s}%,client.ilike.%${s}%,project_code.ilike.%${s}%`)
  }
  if (args.status) q = q.eq('status', args.status)
  if (args.phase) q = q.eq('phase', args.phase)
  if (args.due_before) q = q.lte('due_date', args.due_before)
  if (args.due_after) q = q.gte('due_date', args.due_after)
  const { data, error } = await q.order('due_date', { ascending: true, nullsFirst: false })
    .limit(Math.min(args.limit ?? 20, 50))
  if (error) throw error
  let rows = data ?? []
  if (args.captain) {
    const c = args.captain.toLowerCase()
    rows = rows.filter(r => {
      const cap = r.captain as { name?: string; initials?: string } | null
      return cap?.name?.toLowerCase().includes(c) || cap?.initials?.toLowerCase() === c
    })
  }
  return rows
}
```

…continue the same file with the remaining helpers, each following the same shape (service-role client, sanitized inputs, compact selects):
  - `resolveProject(ref)` — try exact `project_code` (case-insensitive, e.g. `PR00119`), else `ilike` on `project_name` with `sanitizeQuery`; 0 → null, 1 → row, >1 → `{ ambiguous: [{project_code, project_name, client}] }`.
  - `getProjectDetail(id)` — the project row (`slimProject`) plus, in parallel (`Promise.all`): bids, blasts (+ computed spend total), open + recently-done steps, latest 10 activity rows, deliverables (name/status/url), segments, and compliance state (client compliance flags + latest submission status). Plus the caller's own reminders for the project (pass `userId`).
  - `resolveClient(ref)` / `getClientDetail(id)` — same pattern: client row + contacts + notes + compliance + its projects (code/name/status/due).
  - `pipelineSummary()` — port the digest logic from `app/api/cron/daily-digest/route.ts` (overdue, due ≤3 days, fielding-behind) plus counts by `board_column` and by status/phase; return raw lists + counts.
  - `listActivity(projectId | null, limit)` — newest-first with project names joined.
  - `getTeamInitials()` — `team_members.select('initials')` → string[].

- [ ] **Step 4:** Tests PASS; `npx next build` clean. **Step 5:** Commit: `feat(mcp): data layer — sanitized queries, resolvers, survey-id decoder`

## Task 8: The MCP endpoint + 11 tools

**Files:** Create `app/api/mcp/route.ts` (static route — this is what makes the endpoint exactly `/api/mcp`).

- [ ] **Step 1:** Read `node_modules/mcp-handler/README.md` and the package types FIRST. Then implement with the contracts below (adapt signatures to the installed API):

```ts
import { createMcpHandler, experimental_withMcpAuth as withMcpAuth } from 'mcp-handler'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedEmail } from '@/lib/utils/allowedDomain'
import { findAccessToken, revokeTokenById } from '@/lib/oauth/store'
import { baseUrl, MCP_RESOURCE } from '@/lib/oauth/http'
import * as data from '@/lib/mcp/data'

export const maxDuration = 60

const handler = createMcpHandler(
  server => {
    // -------- read tools --------
    server.tool('search_projects', 'Search survey projects by name/code/client with optional filters.',
      {
        query: z.string().optional(), status: z.enum(['Open', 'Hold', 'Closed']).optional(),
        phase: z.enum(['Scoping', 'Active']).optional(), captain: z.string().optional(),
        due_before: z.string().optional(), due_after: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      async (args, extra) => json(await logged(extra, 'search_projects', () => data.searchProjects(args))))
    // get_project, pipeline_summary, search_clients, get_client, list_activity,
    // decode_survey_id follow the same pattern (details below).
    // -------- reminder tools (scoped to the authenticated user) --------
    // create_reminder, list_reminders, complete_reminder, delete_reminder (details below).
  },
  {},
  { basePath: '/api', maxDuration: 60, verboseLogs: false }
)

const authed = withMcpAuth(
  handler,
  async (_req, bearerToken) => {
    if (!bearerToken) return undefined
    const row = await findAccessToken(bearerToken)
    if (!row) return undefined
    // LIVE gate: never trust the denormalized snapshot on the token row.
    const admin = createAdminClient()
    const { data: profile } = await admin.from('profiles')
      .select('role, email').eq('id', row.user_id).maybeSingle()
    if (!profile || profile.role !== 'analyst' || !isAllowedEmail(profile.email)) {
      await revokeTokenById(row.id)
      return undefined
    }
    return {
      token: bearerToken, scopes: row.scope.split(' '), clientId: row.client_id,
      extra: { userId: row.user_id, userEmail: profile.email },
    }
  },
  { required: true, resourceMetadataPath: '/.well-known/oauth-protected-resource' }
)

export { authed as GET, authed as POST }
```

Contract notes (implementer fills in the elided tools following these):
- Every handler returns `{ content: [{ type: 'text', text: JSON.stringify(result) }] }` (`json(...)` helper).
- `logged(extra, tool, fn)` helper: wraps the call, measures duration, inserts into `mcp_tool_calls` (`user_email` from the auth info exposed on `extra.authInfo`, `ok` false on throw — insert must never break the response), rethrows a clean `Error('...')` with a user-safe message on failure.
- `get_project` / `get_client`: resolve via `resolveProject`/`resolveClient`; on `{ambiguous}` return the candidate list with a note ("multiple matches — specify the code").
- `decode_survey_id`: `data.decodeSurveyId(id, await data.getTeamInitials())`; null → "no 8-digit date found in that ID".
- Reminder tools use `extra.authInfo.extra.userId/userEmail`: `create_reminder` inserts `{user_id, user_email, text, due_date, project_id?}` (resolve `project` ref if provided; `due_date` must match `/^\d{4}-\d{2}-\d{2}$/`); `list_reminders` selects own rows (`.eq('user_id', userId)`, `include_done` default false) ordered by `due_date`; `complete_reminder` sets `done: true, done_at: now()` with `.eq('id', id).eq('user_id', userId)`; `delete_reminder` deletes with the same double filter. Affected-0-rows → "not found or not yours".
- If migration 045 isn't applied yet, tool calls will error — the `logged` wrapper's clean error message covers this ("The reminders/OAuth tables aren't set up yet — run migration 045").

- [ ] **Step 2:** `npx next build` clean (this catches signature drift). Commit: `feat(mcp): /api/mcp endpoint — 11 tools behind live-gated bearer auth`

## Task 9: Email transport + reminders cron

**Files:** Modify `lib/email/send.ts`; create `app/api/cron/reminders-due/route.ts`; modify `vercel.json`.

- [ ] **Step 1:** Read `lib/email/send.ts` first. Keep its exported contract (`sendAndLog(...): Promise<boolean>`, never throws). Add an SMTP transport used when `SMTP_HOST`+`SMTP_USER`+`SMTP_PASS` are set (Gmail: host `smtp.gmail.com`, port 587, `secure: false`, auth user/pass; `from` = `SMTP_FROM ?? SMTP_USER`), preferred over Resend when both exist; Resend path unchanged otherwise. Use `nodemailer.createTransport(...)` lazily (module-level singleton).
- [ ] **Step 2:** `app/api/cron/reminders-due/route.ts` — mirror `daily-digest`'s shape (same `authorized()` bearer/CRON_SECRET check, `logSystemEvent`, always-200):
  - Select reminders `due_date <= today (ET — compute today as America/New_York date string)`, `done = false`, `notified_at is null`, joining `survey_projects(project_code, project_name)`.
  - Group by `user_email`; for each user build one plain-HTML email ("Your Survey Ops reminders", each line: text — due date — project code/name if linked, overdue ones first) and `sendAndLog`.
  - **Stamp `notified_at = now()` ONLY for that user's reminder ids when the send returned `true`.** On `false`: leave null (tomorrow retries) and `logSystemEvent({source:'reminders-due', status:'error', ...})`.
  - Response JSON: `{ users: n, sent: n, failed: n }`; `logSystemEvent` ok-row when all sent.
- [ ] **Step 3:** `vercel.json` — add `{ "path": "/api/cron/reminders-due", "schedule": "30 11 * * *" }`.
- [ ] **Step 4:** Build + tests. Commit: `feat(mcp): reminders cron + SMTP transport fallback for app email`

## Task 10: Connect page + revoke + menu link + user guide

**Files:** Create `app/(app)/connect/page.tsx` (+ a small client component for copy/revoke); modify the AppMenu component (find it: grep `☰` / `AppMenu` under `components/`); modify `USER_GUIDE.md`.

- [ ] **Step 1:** Server component page (inside `(app)` so the analyst layout gate applies): heading "Connect your Claude"; explainer paragraph; the connector URL `https://survey-ops-tracker.vercel.app/api/mcp` in a copy box; three collapsible per-surface instruction blocks (claude.ai web/mobile: Settings → Connectors → Add custom connector → paste URL → Log in — note it needs a paid Claude plan and on Team/Enterprise an admin may have to add it org-wide; Claude Desktop: Settings → Connectors, same steps; Claude Code: `claude mcp add --transport http survey-ops https://survey-ops-tracker.vercel.app/api/mcp`); then **Active connections**: `listUserTokens(user.id)` rows (client name via join or `getClient`, created, last used) each with a Revoke button → server action calling `revokeToken(id, user.id)` + `revalidatePath('/connect')`. Empty state: "No Claudes connected yet."
- [ ] **Step 2:** Add "Connect your Claude" to the ☰ menu next to the user-guide link.
- [ ] **Step 3:** `USER_GUIDE.md`: new section "## 10. Connect your Claude" — what it is, the URL, the login flow, example asks, reminders behavior (emailed the morning they're due), revoking, analyst-only note.
- [ ] **Step 4:** Build + full tests. Commit: `feat(mcp): Connect page with per-device setup + revoke, menu link, user guide`

## Task 11: Final verification + ship gate

- [ ] **Step 1:** From `survey-ops-tracker/`: `npx vitest run` (expect 304 + all new tests green) and `npx next build` (clean; confirm the route list shows `/api/mcp`, `/oauth/authorize`, `/connect`, `/api/oauth/*`, `/.well-known/*`, `/api/cron/reminders-due`).
- [ ] **Step 2:** Static smoke of discovery locally: `npx next start` (or against the dev server) and `curl` both `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp` → identical JSON with `resource` = the /api/mcp URL; `curl -X POST /api/mcp` unauthenticated → 401 with `WWW-Authenticate` header.
- [ ] **Step 3:** STOP — do not push. Hand to David: (a) migration 045 SQL to run, (b) the two Vercel env vars for reminders email (`SMTP_USER` = full @alpharoc.ai address, `SMTP_PASS` = Gmail App Password — David enters these himself, plus optional `SMTP_HOST=smtp.gmail.com`/`SMTP_FROM`), (c) after his "success": push `origin HEAD:main`, then walk him through adding the connector in claude.ai and the acceptance checklist from the spec.

---

## Notes / decisions carried from the spec

- The spec (`2026-07-06-claude-connector-mcp-design.md`) is authoritative for security behavior: allowlist, live per-request gate, rotation grace, consent = POST + never-redirect-on-invalid.
- One deliberate deviation from the spec: the rotation grace window returns a *fresh* pair on retry rather than "the same newly-issued pair" — hash-only storage makes returning the identical pair impossible; issuing another pair inside the grace window is functionally equivalent for the client and keeps storage hash-only. (Spec's intent — retries don't brick the connection — is preserved.)
- `NEXT_PUBLIC_APP_URL` may not exist in Vercel env; `baseUrl()` falls back to the production URL constant. Verify at Task 5 whether the env var exists (HANDOVER.md lists env vars) and prefer it if set.
- Degrade-gracefully rule: NOTHING may throw at import/build time if migration 045 hasn't run; all failures happen inside request handlers with clean messages.
- Phase 2 (writes) is out of scope — do not add any tool that mutates tracker records.
