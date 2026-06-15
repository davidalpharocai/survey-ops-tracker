import { timingSafeEqual } from 'node:crypto'

/**
 * Constant-time string comparison for shared secrets (webhook/cron auth).
 * A plain `===` leaks length/prefix timing; this doesn't. Returns false for
 * any missing value or length mismatch.
 */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
