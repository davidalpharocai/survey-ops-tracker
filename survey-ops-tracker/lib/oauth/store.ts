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
  // A merely-expired-but-never-consumed code is NOT a theft signal — only act when
  // the code was actually consumed before (consumed_at is non-null).
  const { data: burnt } = await supabase.from('oauth_codes').select('user_id, client_id, consumed_at')
    .eq('code_hash', hash).maybeSingle()
  if (burnt && burnt.consumed_at) {
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
    return claimGraceAndMint(row) // grace retry: one-shot, fresh pair, family stays alive
  }

  // First use: atomically claim the rotation (guards concurrent refreshes).
  const { data: claimed } = await supabase.from('oauth_tokens')
    .update({ rotated_at: new Date().toISOString() })
    .eq('id', row.id).is('rotated_at', null)
    .select().maybeSingle()
  if (!claimed) {
    // Lost the race — treat like a grace retry.
    return claimGraceAndMint(row)
  }
  const pair = await mint(claimed)
  return pair

  /** One-shot grace claim: atomically flips grace_used so only one retry ever mints. */
  async function claimGraceAndMint(from: { id: string; client_id: string; user_id: string; user_email: string }): Promise<TokenPair | null> {
    const { data: claimed } = await supabase.from('oauth_tokens')
      .update({ grace_used: true })
      .eq('id', from.id).eq('grace_used', false)
      .select().maybeSingle()
    if (!claimed) return null // already used the one-shot retry: invalid_grant
    return mint(claimed)
  }

  async function mint(from: { client_id: string; user_id: string; user_email: string; id: string }): Promise<TokenPair> {
    const pair2 = await issueTokens({ clientId: from.client_id, userId: from.user_id, userEmail: from.user_email })
    const { data: newRow } = await supabase.from('oauth_tokens').select('id')
      .eq('token_hash', sha256(pair2.accessToken)).maybeSingle()
    if (newRow) {
      // Retire the superseded row's ACCESS token by expiring it (findAccessToken's
      // gt('expires_at', now) filter then excludes it) WITHOUT setting revoked_at —
      // the grace-retry path above keys off revoked_at to detect a dead family, and
      // rotation alone must not trip that.
      await supabase.from('oauth_tokens')
        .update({ replaced_by: newRow.id, expires_at: new Date().toISOString() })
        .eq('id', from.id)
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

/** User-initiated revoke from the Connect page: kills the WHOLE token family (client_id + user_id),
 *  including any pre-rotation access tokens still floating around, not just the one row shown in the UI. */
export async function revokeToken(id: string, userId: string): Promise<void> {
  const supabase = createAdminClient()
  const { data: row } = await supabase.from('oauth_tokens').select('client_id')
    .eq('id', id).eq('user_id', userId).maybeSingle()
  if (!row) return
  await supabase.from('oauth_tokens').update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId).eq('client_id', row.client_id).is('revoked_at', null)
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
