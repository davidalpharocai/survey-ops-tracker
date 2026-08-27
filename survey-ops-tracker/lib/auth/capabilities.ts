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
  try {
    const supabase = await createClient()
    const uid = userId ?? (await supabase.auth.getUser()).data.user?.id
    if (!uid) return new Set()

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
    return resolveAccess({ direct: direct.data, roles: mine.data, bundles: bundles.data })
      .capabilities
  } catch {
    return new Set()
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
