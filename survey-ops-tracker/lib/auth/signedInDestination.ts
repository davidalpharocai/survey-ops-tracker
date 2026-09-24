import { isAllowedEmail } from '@/lib/utils/allowedDomain'

/**
 * Where to send someone who opens /login while ALREADY signed in, or null to
 * show the form.
 *
 * WHY. The login page used to show "Email me a sign-in link" to everyone,
 * including people whose session was perfectly good. Anyone who bookmarked the
 * page they first signed in from, or was bounced there by a transient error,
 * saw a form that said "you are signed out" when they were not, and did the
 * natural thing: requested a link, again. David, 2026-09-24: "Alex has to keep
 * sending himself a link in order to sign in."
 *
 * Pure, so the routing rule is tested without a browser. Null whenever in
 * doubt: showing the form to a signed-in person costs one email, while sending
 * a person somewhere their tier cannot render risks a redirect loop.
 */
export function signedInDestination(
  role: string | null | undefined,
  email: string | null | undefined,
  next: string | null | undefined,
): string | null {
  // Same sanitising as the form: same-origin relative paths only, and never
  // back to /login itself, which would loop.
  const safe =
    next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && !next.startsWith('/login')
      ? next
      : '/'

  // Reviewers are external addresses; the (app) layout checks this before the
  // domain, and so does this.
  if (role === 'compliance') return '/portal'
  if (!isAllowedEmail(email)) return null
  if (role === 'sales') return safe.startsWith('/sales') ? safe : '/sales'
  if (role === 'analyst') return safe
  // No tier, or one with no surface yet: the form, and the layout's own
  // ?pending message if they go further.
  return null
}
