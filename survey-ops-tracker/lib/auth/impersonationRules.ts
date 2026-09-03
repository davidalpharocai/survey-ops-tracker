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
