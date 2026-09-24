/**
 * Who may view the app as whom.
 *
 * NO `server-only` here, deliberately, and that is the whole reason this is its
 * own module: these rules decide who may act as another person, so a test has to
 * be able to reach them. Inside the route handler they were reachable only by
 * driving a browser through a live admin session — the kind of check that ends up
 * never being run. Same split, and the same reasoning, as resolvePermissions.ts.
 *
 * The cookie handling and session minting stay in impersonation.ts, which is
 * server-only because it needs the service-role key.
 */

/** The tiers whose RLS is SELECT-only, and therefore the only legal targets.
 *  Widening this list is not a config change — it is a decision to allow writes
 *  as another person, which needs the actor recorded honestly first. */
export const IMPERSONATABLE_ROLES = ['sales', 'compliance'] as const

export type ImpersonationRefusal =
  | { ok: false; status: 401 | 400 | 403 | 404; error: string }

export type ImpersonationDecision =
  | { ok: true }
  | ImpersonationRefusal

export interface ImpersonationRequest {
  /** The verified caller. Null when there is no session at all. */
  caller: { id: string; email: string } | null
  /** Roles held by the caller, read server-side — NOT supplied by the client. */
  callerRoles: string[]
  /** The email asked for, already trimmed and lowercased. */
  requestedEmail: string
  /** The target's profile row, or null when no such account exists. */
  target: { id: string; email: string | null; role: string | null } | null
}

/**
 * May `caller` view the app as `target`?
 *
 * The order is deliberate: identity, then authority, then whether the target
 * even exists, then whether that target is a legal one. Each refusal says which
 * question failed, because "403" on its own sends an admin hunting for a
 * permission problem when the real answer is "that person is an analyst".
 */
export function decideImpersonation(req: ImpersonationRequest): ImpersonationDecision {
  if (!req.caller?.email) {
    return { ok: false, status: 401, error: 'Not signed in.' }
  }
  if (!req.callerRoles.includes('admin')) {
    return { ok: false, status: 403, error: 'Only an admin can view the app as another user.' }
  }
  if (!req.requestedEmail) {
    return { ok: false, status: 400, error: 'Which user? No email given.' }
  }
  if (req.requestedEmail === req.caller.email.toLowerCase()) {
    return { ok: false, status: 400, error: 'You are already yourself.' }
  }
  if (!req.target) {
    return { ok: false, status: 404, error: `No account for ${req.requestedEmail}.` }
  }
  // THE CHECK THAT MAKES THE FEATURE READ-ONLY. Only tiers whose RLS is
  // SELECT-only are legal targets, so the minted session cannot write — refused
  // by Postgres rather than hidden by the interface. It is also what stops an
  // admin impersonating UP: into another admin, or into someone holding finance
  // access the caller does not hold.
  if (!(IMPERSONATABLE_ROLES as readonly string[]).includes(req.target.role ?? '')) {
    return {
      ok: false,
      status: 403,
      error: `${req.requestedEmail} is ${req.target.role ?? 'un-roled'}. Only ${IMPERSONATABLE_ROLES.join(' and ')} accounts can be viewed as, because those are the tiers the database makes read-only — viewing as an analyst would be a session that can write, and writes have to be attributed to a real person.`,
    }
  }
  return { ok: true }
}

/** How long an emailed sign-in link stays usable. Matches the "expires in 1
 *  hour" the magic-link template promises (docs/email-templates). */
export const SIGN_IN_LINK_TTL_MINUTES = 60

/** The auth fields that say whether a sign-in link is waiting, as returned by
 *  admin.auth.admin.getUserById. */
export interface SignInState {
  recovery_sent_at?: string | null
  last_sign_in_at?: string | null
}

/**
 * Would viewing as this person cancel a sign-in link they are about to use?
 * Returns the reason to refuse, or null when it is safe.
 *
 * "View as" mints the target's session with generateLink, and Supabase keeps
 * ONE outstanding sign-in token per account: minting a new one replaces it. So
 * if the person has asked for a link and not clicked it yet, starting a view-as
 * silently kills that link, and when they click it they are told it expired.
 * David, 2026-09-24: "i can view as them but it doesnt effect them?" This is
 * the one way it still could, so the route refuses in exactly that window.
 *
 * Someone who has NEVER signed in is refused outright: their invitation is the
 * outstanding token, and viewing as them would use it up before they do.
 */
export function signInLinkAtRisk(u: SignInState, email: string, now: Date): string | null {
  if (!u.last_sign_in_at) {
    return `${email} has not signed in yet, so their invitation link is still waiting in their inbox. Viewing as them now would use it up. Once they have signed in once, View as works without touching their account.`
  }
  if (!u.recovery_sent_at) return null
  const sent = new Date(u.recovery_sent_at).getTime()
  const used = new Date(u.last_sign_in_at).getTime()
  if (Number.isNaN(sent) || used >= sent) return null
  const clears = sent + SIGN_IN_LINK_TTL_MINUTES * 60_000
  if (now.getTime() >= clears) return null
  const ago = Math.max(0, Math.floor((now.getTime() - sent) / 60_000))
  const at = new Date(clears).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
  })
  return `${email} asked for a sign-in link ${ago === 0 ? 'less than a minute' : ago === 1 ? '1 minute' : `${ago} minutes`} ago and has not used it yet. Viewing as them now would cancel that link. Try again once they have signed in, or after ${at} ET.`
}
