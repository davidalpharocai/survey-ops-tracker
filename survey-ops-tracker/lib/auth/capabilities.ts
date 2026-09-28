import 'server-only'
import { createClient } from '@/lib/supabase/server'
import {
  VIEW_FINANCIALS,
  MANAGE_PERMISSIONS,
  type Capability,
  type RoleName,
} from './capabilityNames'
import { resolveAccess } from './resolvePermissions'

// Permissions: what a person may do, answered from the UNION of two mechanisms.
//
//   · a ROLE they hold          (profile_roles → role_permissions, migration 085)
//   · a DIRECT grant to them    (profile_capabilities, migration 079)
//
// Both are additive and neither is authoritative over the other, so a permission
// is held if either supplies it. Roles are the normal path — they answer "what is
// this person accountable for" and are what the admin UI assigns. Direct grants
// stay first-class for the genuine one-off, so nobody is ever tempted to invent
// a role for a single exception, which is how role sets explode.
//
// Everyone internal keeps profiles.role = 'analyst'. That column is a TIER — it
// decides which app you land in (internal vs the compliance portal), not what you
// may do — and it stays a two-value enum because ~25 RLS policies and six app
// gates test `my_role() = 'analyst'` for exact equality. See 085's header.
//
// ⚠️ NEVER fold a permission read into an auth gate's select. app/(app)/layout.tsx
// does `.from('profiles').select('role')` and redirect('/login') on ANY error
// from it. Migrations are applied by hand, hours or days after the code deploys,
// so there is a window in which profile_roles does not exist yet — a joined or
// widened gate select would fail for every request and sign the entire company
// out until the SQL runs. Everything here is therefore SEPARATE queries that
// swallow their own failures and answer "no permissions": the worst case is that
// money is hidden from the three people who may see it for a few hours, never
// that anyone loses access to the tool.

export {
  VIEW_FINANCIALS,
  MANAGE_PERMISSIONS,
  type Capability,
  type RoleName,
} from './capabilityNames'

/** Every permission held by the signed-in user (or `userId`, when the caller
 *  already has the user and doesn't need a second auth round-trip) — role-derived
 *  and directly granted, unioned.
 *
 *  Never throws. An empty set means "no permissions", including when the tables
 *  don't exist yet or the session can't be read. */
export async function getMyCapabilities(userId?: string): Promise<Set<Capability>> {
  return (await readAccess(userId)).capabilities
}

/** What `readAccess` found, plus whether it could actually SEE the answer.
 *
 *  `readFailed` is true when any read that could have supplied a permission
 *  did not answer — a thrown client, an unreadable session, or an error from
 *  any of the three queries. It is the difference between "this person holds
 *  nothing" and "we could not tell", which every caller that shows the reader
 *  a REASON needs and which a boolean cannot carry. */
interface AccessRead {
  capabilities: Set<Capability>
  readFailed: boolean
}

/** The three queries, once, with their failures kept rather than swallowed.
 *
 *  Everything about the queries themselves is unchanged (see the header: each
 *  is allowed to fail on its own, and the result degrades to fewer permissions,
 *  never to an error and never to more). The only addition is that the caller
 *  can now find out that something failed. */
async function readAccess(userId?: string): Promise<AccessRead> {
  const none = (readFailed: boolean): AccessRead => ({ capabilities: new Set(), readFailed })
  try {
    const supabase = await createClient()
    let uid = userId
    if (!uid) {
      const got = await supabase.auth.getUser()
      uid = got.data.user?.id
      // No user id and an error from the session read is "we could not look",
      // not "nobody is signed in": a signed-out visitor never reaches a gated
      // page, because app/(app)/layout.tsx sends them to /login first.
      if (!uid) return none(got.error != null)
    }

    // Three flat queries rather than one embedded select — see the matching
    // comment in lib/hooks/useCapabilities.ts: an embed needs the foreign key
    // described in the hand-maintained lib/supabase/types.ts, and a wrong entry
    // there collapses the entire schema type to `never`. role_permissions is a
    // handful of reference rows, so joining in JS is cheaper than that risk.
    //
    // Each query is allowed to fail on its own. Pre-085 the two role queries 404
    // and the direct-grant query still answers, which is exactly the state
    // production is in between the deploy and David running the SQL — a finance
    // holder keeps their 079 direct grant throughout.
    const [direct, mine, bundles] = await Promise.all([
      supabase.from('profile_capabilities').select('capability').eq('profile_id', uid),
      supabase.from('profile_roles').select('role').eq('profile_id', uid),
      supabase.from('role_permissions').select('role, permission'),
    ])

    // The union itself lives in resolvePermissions.ts, shared with the browser
    // hook and tested directly — see that file for why it is not inlined here.
    return {
      capabilities: resolveAccess({ direct: direct.data, roles: mine.data, bundles: bundles.data })
        .capabilities,
      readFailed: direct.error != null || mine.error != null || bundles.error != null,
    }
  } catch {
    return none(true)
  }
}

/** Every ROLE held by the signed-in user. Separate from the permission set
 *  because the admin UI shows roles by name, and because "why can this person
 *  see money" is a different question from "can they". */
export async function getMyRoles(userId?: string): Promise<Set<RoleName>> {
  try {
    const supabase = await createClient()
    const uid = userId ?? (await supabase.auth.getUser()).data.user?.id
    if (!uid) return new Set()
    const { data, error } = await supabase.from('profile_roles').select('role').eq('profile_id', uid)
    if (error || !data) return new Set()
    return new Set(data.map((r) => r.role as RoleName))
  } catch {
    return new Set()
  }
}

/** True when the signed-in user may see financials. Defaults to false on any
 *  failure — the money stays hidden, the page still renders. */
export async function canViewFinancials(userId?: string): Promise<boolean> {
  return (await getMyCapabilities(userId)).has(VIEW_FINANCIALS)
}

/** A permission question with the third answer a page needs before it puts
 *  words on the screen: 'yes', a definite 'no', or 'unknown' — we could not
 *  look.
 *
 *  `canViewFinancials()` answers a plain false for "the tables 404 while a
 *  migration is pending", "RLS refused", "the network dropped" and "this person
 *  really is not in finance" alike. That is the right answer for a GATE: money
 *  stays hidden either way. It is the wrong thing to SAY: /finance told a
 *  finance holder whose read hiccuped that finance is limited to three people,
 *  naming them, with no reason and nothing to try. This is the house rule —
 *  a failed read is not $0 and not "none" — applied to the gate itself.
 *
 *  A found permission wins over any failure: a positive is a positive whatever
 *  else did not answer. Otherwise a failed read is 'unknown', because a
 *  permission this person holds may live in exactly the query that did not come
 *  back. Between a deploy and David running a migration by hand, the two role
 *  queries 404 and a non-holder reads 'unknown' rather than a flat no — which
 *  is the truthful answer in that window, and changes no access: only 'yes'
 *  opens anything. */
export type AccessAnswer = 'yes' | 'no' | 'unknown'

export async function financeAccess(userId?: string): Promise<AccessAnswer> {
  const { capabilities, readFailed } = await readAccess(userId)
  if (capabilities.has(VIEW_FINANCIALS)) return 'yes'
  return readFailed ? 'unknown' : 'no'
}

/** True when the signed-in user may change other people's access.
 *
 *  This is the gate every access-changing route must call BEFORE touching the
 *  RPCs in 085 step 6. It is not the only gate — those functions have no
 *  `authenticated` EXECUTE grant at all, so the browser cannot reach them even
 *  with a forged request body, and they refuse a self-grant of anything
 *  sensitive regardless of who is asking. Two independent checks, neither
 *  sufficient alone. */
export async function canManagePermissions(userId?: string): Promise<boolean> {
  return (await getMyCapabilities(userId)).has(MANAGE_PERMISSIONS)
}
