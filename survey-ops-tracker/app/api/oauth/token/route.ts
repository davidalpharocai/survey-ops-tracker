import { NextRequest } from 'next/server'
import { corsJson, optionsResponse, MCP_RESOURCE } from '@/lib/oauth/http'
import { verifyPkce } from '@/lib/oauth/crypto'
import { isAllowedEmail } from '@/lib/utils/allowedDomain'
import { createAdminClient } from '@/lib/supabase/admin'
import { consumeCode, issueTokens, exchangeRefresh, SCOPE } from '@/lib/oauth/store'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' }

function tokenJson(body: unknown, status = 200) {
  return corsJson(body, status, NO_STORE_HEADERS)
}

async function parseParams(req: NextRequest): Promise<Record<string, string>> {
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      const body = await req.json()
      if (typeof body === 'object' && body !== null) {
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
          if (typeof v === 'string') out[k] = v
        }
        return out
      }
    } catch {
      return {}
    }
    return {}
  }
  try {
    const form = await req.formData()
    const out: Record<string, string> = {}
    for (const [k, v] of form.entries()) {
      if (typeof v === 'string') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

export async function POST(req: NextRequest) {
  const params = await parseParams(req)
  const grantType = params.grant_type

  if (params.resource && params.resource !== MCP_RESOURCE()) {
    return tokenJson({ error: 'invalid_target' }, 400)
  }

  if (grantType === 'authorization_code') {
    const { code, code_verifier: codeVerifier, client_id: clientId, redirect_uri: redirectUri } = params
    if (!code || !codeVerifier || !clientId || !redirectUri) {
      return tokenJson({ error: 'invalid_grant' }, 400)
    }
    const row = await consumeCode(code)
    if (!row) {
      return tokenJson({ error: 'invalid_grant' }, 400)
    }
    if (row.client_id !== clientId || row.redirect_uri !== redirectUri) {
      return tokenJson({ error: 'invalid_grant' }, 400)
    }
    if (!verifyPkce(codeVerifier, row.code_challenge)) {
      return tokenJson({ error: 'invalid_grant' }, 400)
    }

    // Live gate: the account must still be an allowed, analyst-role user right now.
    const admin = createAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('role, email')
      .eq('id', row.user_id)
      .maybeSingle()
    if (!profile || profile.role !== 'analyst' || !isAllowedEmail(profile.email)) {
      return tokenJson({ error: 'invalid_grant' }, 400)
    }

    const pair = await issueTokens({ clientId: row.client_id, userId: row.user_id, userEmail: profile.email })
    return tokenJson({
      access_token: pair.accessToken,
      token_type: 'Bearer',
      expires_in: pair.expiresIn,
      refresh_token: pair.refreshToken,
      scope: row.scope,
    })
  }

  if (grantType === 'refresh_token') {
    const { refresh_token: refreshToken } = params
    if (!refreshToken) {
      return tokenJson({ error: 'invalid_grant' }, 400)
    }
    const pair = await exchangeRefresh(refreshToken)
    if (!pair) {
      return tokenJson({ error: 'invalid_grant' }, 400)
    }
    return tokenJson({
      access_token: pair.accessToken,
      token_type: 'Bearer',
      expires_in: pair.expiresIn,
      refresh_token: pair.refreshToken,
      scope: SCOPE,
    })
  }

  return tokenJson({ error: 'unsupported_grant_type' }, 400)
}

export async function OPTIONS() { return optionsResponse() }
