import 'server-only'
import { createHmac, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'

/**
 * "View as" — an admin holding a real session for someone else.
 *
 * WHY IT WORKS THIS WAY
 *
 * The session handed out IS the target's, minted server-side through
 * generateLink + verifyOtp. That is deliberate rather than convenient: the point
 * of the feature is to answer "what does this person actually see", and only a
 * genuine session exercises the real RLS. Anything that imitated the target's
 * scope with the admin client would be testing our imitation instead of the
 * policy — which is exactly the mistake that let Alex's tier go unverified for
 * three days while the sales page 404'd in production.
 *
 * READ-ONLY IS ENFORCED BY POSTGRES, NOT BY THIS FILE. Only `sales` and
 * `compliance` profiles may be impersonated, and both tiers' policies are
 * SELECT-only, so a write is refused by the database. That is why there is no
 * "please do not save" guard in the 46 browser write paths: there does not need
 * to be one, and one would have been a convention rather than a control.
 *
 * WHO THE ADMIN WAS is kept in a signed cookie so the session can be handed
 * back. Signed with the service-role key as the HMAC secret — it is server-only,
 * always present, and never leaves the server — so a browser cannot forge an
 * impersonation banner or, more importantly, forge a "stop" that would mint a
 * session for an arbitrary admin.
 *
 * THE FAILURE MODE, stated because it is real: if this cookie is lost while the
 * target's session survives (cleared cookies, an expiry mismatch), the admin is
 * left holding a read-only session with no banner explaining it and no Stop
 * button. It is recoverable by signing out and back in, and it is not dangerous
 * — the session cannot write — but it will be confusing. The cookie is therefore
 * given the same lifetime as a Supabase session rather than a shorter one.
 */

/** Not httpOnly-only by accident: the banner is server-rendered, so nothing in
 *  the browser needs to read this. */
export const IMPERSONATION_COOKIE = 'socc_impersonator'

// The rule list and the authorisation decision live in impersonationRules.ts,
// which has no `server-only` so it can be unit-tested. Re-exported here so a
// caller needs only one import.
export { IMPERSONATABLE_ROLES, decideImpersonation } from './impersonationRules'
export type { ImpersonationDecision, ImpersonationRequest } from './impersonationRules'

export interface Impersonator {
  /** The admin's own auth id, so their session can be re-minted on stop. */
  adminId: string
  adminEmail: string
  /** Who they are viewing as — for the banner, so it needs no extra query. */
  subjectEmail: string
  /** The tier being viewed, shown in the banner so "read-only" is explained. */
  subjectRole: string
}

function secret(): string {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to sign an impersonation cookie')
  return s
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

/** `<base64url(json)>.<hmac>` — opaque to the browser and not forgeable. */
export function encodeImpersonator(v: Impersonator): string {
  const body = Buffer.from(JSON.stringify(v)).toString('base64url')
  return `${body}.${sign(body)}`
}

export function decodeImpersonator(raw: string | undefined): Impersonator | null {
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return null
  const body = raw.slice(0, dot)
  const mac = raw.slice(dot + 1)
  const expected = sign(body)
  // Constant-time, and length-guarded because timingSafeEqual throws on a
  // length mismatch rather than returning false.
  if (mac.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Impersonator
    if (!parsed?.adminId || !parsed?.adminEmail || !parsed?.subjectEmail) return null
    return parsed
  } catch {
    return null
  }
}

/** The current impersonation, or null. Safe to call from any server component;
 *  a tampered or absent cookie is simply "not impersonating". */
export async function readImpersonation(): Promise<Impersonator | null> {
  const jar = await cookies()
  return decodeImpersonator(jar.get(IMPERSONATION_COOKIE)?.value)
}
