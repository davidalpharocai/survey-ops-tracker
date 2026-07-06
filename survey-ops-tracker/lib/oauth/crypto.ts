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
