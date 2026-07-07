import { NextRequest } from 'next/server'
import { corsJson, optionsResponse } from '@/lib/oauth/http'
import { isAllowedRedirect } from '@/lib/oauth/redirects'
import { registerClient } from '@/lib/oauth/store'

export const dynamic = 'force-dynamic'

const MAX_PER_HOUR = 5
const WINDOW_MS = 60 * 60_000
const hits = new Map<string, number[]>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const timestamps = (hits.get(ip) ?? []).filter(t => now - t < WINDOW_MS)
  timestamps.push(now)
  hits.set(ip, timestamps)
  return timestamps.length > MAX_PER_HOUR
}

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  if (rateLimited(ip)) {
    return corsJson({ error: 'too_many_requests' }, 429)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return corsJson({ error: 'invalid_client_metadata' }, 400)
  }
  if (typeof body !== 'object' || body === null) {
    return corsJson({ error: 'invalid_client_metadata' }, 400)
  }
  const b = body as Record<string, unknown>

  let clientName = 'Claude'
  if (b.client_name !== undefined) {
    if (typeof b.client_name !== 'string' || b.client_name.length > 100) {
      return corsJson({ error: 'invalid_client_metadata' }, 400)
    }
    clientName = b.client_name
  }

  const redirectUris = b.redirect_uris
  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length < 1 ||
    redirectUris.length > 5 ||
    !redirectUris.every(u => typeof u === 'string')
  ) {
    return corsJson({ error: 'invalid_redirect_uri' }, 400)
  }
  const uris = redirectUris as string[]
  if (!uris.every(isAllowedRedirect)) {
    return corsJson({ error: 'invalid_redirect_uri' }, 400)
  }

  let clientId: string
  try {
    clientId = await registerClient(clientName, uris)
  } catch {
    // Degrade gracefully if migration 045 hasn't been applied yet (oauth
    // tables missing) or any other storage error — never crash unhandled.
    return corsJson({ error: 'temporarily_unavailable' }, 503)
  }

  return corsJson(
    {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    201
  )
}

export async function OPTIONS() { return optionsResponse() }
