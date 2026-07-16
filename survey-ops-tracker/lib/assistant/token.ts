import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signed, stateless pending-write action tokens for the in-app assistant.
 *
 * The chat model can only ever PREVIEW a write. When the in-app agent loop
 * (app/api/assistant/route.ts) produces a preview it mints one of these tokens
 * and streams it to the panel. The write is committed only when the user clicks
 * Confirm and the panel POSTs the token to app/api/assistant/act, which verifies
 * it and executes the write. The token is an HMAC of the exact { tool, args,
 * userEmail, exp } that will run — so it is tamper-proof, self-expiring, and
 * bound to the user it was minted for, with no server-side session store
 * (safe for serverless).
 *
 * Token wire format: `<base64url(payload)>.<base64url(hmac-sha256(payload))>`.
 */

export interface PendingAction {
  /** Registry tool name (a write tool). */
  tool: string
  /** The tool arguments the model proposed (never includes `confirm`). */
  args: Record<string, unknown>
  /** The email the token is bound to — only this user may redeem it. */
  userEmail: string
  /** Expiry, epoch milliseconds. */
  exp: number
}

export type VerifyResult =
  | { ok: true; action: PendingAction }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_user' }

/** Default lifetime of a pending-action token (10 minutes). */
export const DEFAULT_TTL_MS = 10 * 60 * 1000

/**
 * The signing secret. Prefer a dedicated ASSISTANT_TOKEN_SECRET; fall back to
 * the app's existing WEBHOOK_SECRET (already provisioned in every environment)
 * so the feature works without new env setup. Throws if neither is set rather
 * than signing with an empty key.
 */
function resolveSecret(): string {
  const s = process.env.ASSISTANT_TOKEN_SECRET || process.env.WEBHOOK_SECRET
  if (!s) {
    throw new Error(
      'ASSISTANT_TOKEN_SECRET (or WEBHOOK_SECRET) must be set to sign assistant action tokens.'
    )
  }
  return s
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function hmac(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest()
}

// -------------------------------------------------------------------------
// Pure, unit-testable core (secret passed explicitly). The exported sign/verify
// below are thin wrappers that read the secret from the environment.
// -------------------------------------------------------------------------

/** Sign a pending action with an explicit secret. Pure — no env access. */
export function signWithSecret(action: PendingAction, secret: string): string {
  const payload = b64url(Buffer.from(JSON.stringify(action), 'utf8'))
  const sig = b64url(hmac(payload, secret))
  return `${payload}.${sig}`
}

/**
 * Verify a token with an explicit secret. Pure — no env access. Rejects
 * malformed, tampered (bad signature), expired, and (when `expectedUserEmail`
 * is given) wrong-user tokens. Signature is checked before expiry/user so a
 * forged token can never be treated as merely "expired".
 */
export function verifyWithSecret(
  token: string,
  secret: string,
  opts?: { expectedUserEmail?: string; now?: number }
): VerifyResult {
  if (typeof token !== 'string' || !token.includes('.')) return { ok: false, reason: 'malformed' }
  const dot = token.indexOf('.')
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!payload || !sig) return { ok: false, reason: 'malformed' }

  const expected = hmac(payload, secret)
  let provided: Buffer
  try {
    provided = fromB64url(sig)
  } catch {
    return { ok: false, reason: 'bad_signature' }
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: 'bad_signature' }
  }

  let action: PendingAction
  try {
    const parsed = JSON.parse(fromB64url(payload).toString('utf8')) as unknown
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as PendingAction).tool !== 'string' ||
      typeof (parsed as PendingAction).userEmail !== 'string' ||
      typeof (parsed as PendingAction).exp !== 'number' ||
      typeof (parsed as PendingAction).args !== 'object' ||
      (parsed as PendingAction).args === null
    ) {
      return { ok: false, reason: 'malformed' }
    }
    action = parsed as PendingAction
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  const now = opts?.now ?? Date.now()
  if (action.exp <= now) return { ok: false, reason: 'expired' }

  if (
    opts?.expectedUserEmail !== undefined &&
    action.userEmail.toLowerCase() !== opts.expectedUserEmail.toLowerCase()
  ) {
    return { ok: false, reason: 'wrong_user' }
  }

  return { ok: true, action }
}

// -------------------------------------------------------------------------
// Env-backed wrappers used by the routes.
// -------------------------------------------------------------------------

/** Mint a token for a pending write. `ttlMs` defaults to 10 minutes. */
export function signAction(
  input: { tool: string; args: Record<string, unknown>; userEmail: string },
  ttlMs: number = DEFAULT_TTL_MS
): string {
  const action: PendingAction = {
    tool: input.tool,
    args: input.args,
    userEmail: input.userEmail,
    exp: Date.now() + ttlMs,
  }
  return signWithSecret(action, resolveSecret())
}

/** Verify a token minted by {@link signAction}, optionally binding it to a user. */
export function verifyAction(token: string, expectedUserEmail?: string): VerifyResult {
  return verifyWithSecret(token, resolveSecret(), { expectedUserEmail })
}

/** Human-facing message for a verification failure (safe to show the user). */
export function verifyFailureMessage(reason: Exclude<VerifyResult, { ok: true }>['reason']): string {
  switch (reason) {
    case 'expired':
      return 'This confirmation expired — ask the assistant again to get a fresh one.'
    case 'wrong_user':
      return 'This confirmation was created for a different account and can’t be used here.'
    default:
      return 'This confirmation is invalid — ask the assistant again to get a fresh one.'
  }
}
