import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import {
  VIEW_FINANCIALS,
  MANAGE_PERMISSIONS,
  type Capability,
  type RoleName,
} from '@/lib/auth/capabilityNames'
import { resolveAccess } from '@/lib/auth/resolvePermissions'

// Browser-side twin of lib/auth/capabilities.ts (which is server-only and can't
// be imported here). Answers from the UNION of two mechanisms, matching can() in
// migration 085:
//
//   · roles the user holds     (profile_roles → role_permissions)
//   · direct grants to them    (profile_capabilities, migration 079)
//
// All three reads are safe from the browser. 079's "read own capabilities" and
// 085's profile_roles_read_own policies are both `profile_id = auth.uid()`, so
// they return nothing for anyone else; role_permissions is reference data,
// readable by anyone signed in (knowing that the finance role grants
// view_financials tells you nothing about who holds it).
//
// ⚠️ These are SEPARATE queries on purpose, and they must stay that way. Never
// fold a permission read into app/(app)/layout.tsx's profile gate: that gate does
// redirect('/login') on ANY select error, and migrations are applied by hand
// hours or days after the code deploys, so a widened gate select would sign the
// entire company out until the SQL ran. Here, the same failure just means "no
// permissions" — money stays hidden, the app keeps working.

interface MyAccess {
  capabilities: Set<Capability>
  roles: Set<RoleName>
}

/** Everything the signed-in user holds: the permission set (role-derived and
 *  direct, unioned) and the role names behind it. Resolves to empty sets on any
 *  failure (missing table, no session, RLS), never rejects — so consumers can
 *  treat "don't know" and "not allowed" as the same, safe answer. */
export function useMyAccess() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['my-access'],
    queryFn: async (): Promise<MyAccess> => {
      const empty: MyAccess = { capabilities: new Set(), roles: new Set() }
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return empty

        // Three flat queries rather than one embedded select. An embed
        // (`profile_roles(role, role_permissions(permission))`) would need the
        // foreign key described in lib/supabase/types.ts, which is hand-
        // maintained — and a wrong or missing Relationships entry there collapses
        // the ENTIRE generated schema to `never`, which has cost this repo an
        // hour before. role_permissions is a handful of rows of reference data,
        // so fetching it whole and joining in JS is cheaper than that risk.
        //
        // Each query is allowed to fail alone. Pre-085 the two role queries 404
        // and the direct-grant query still answers, which is exactly the state
        // production is in between the deploy and David running the SQL.
        const [direct, mine, bundles] = await Promise.all([
          supabase.from('profile_capabilities').select('capability').eq('profile_id', user.id),
          supabase.from('profile_roles').select('role').eq('profile_id', user.id),
          supabase.from('role_permissions').select('role, permission'),
        ])

        // The union itself lives in lib/auth/resolvePermissions.ts, shared with
        // the server reader and tested directly — a soft gate that disagrees
        // with its server twin either leaks a number or hides one the API will
        // return anyway.
        return resolveAccess({ direct: direct.data, roles: mine.data, bundles: bundles.data })
      } catch {
        return empty
      }
    },
    // Grants change roughly never (they're a deliberate admin act), and every
    // money surface on the page calls this, so hold the answer for the session
    // rather than re-querying per mount. The admin UI invalidates ['my-access']
    // after a grant so the person doing it sees the effect without a reload.
    staleTime: 10 * 60_000,
  })
}

/** Back-compat shim: the original shape, which returned just the capability set.
 *  Several components still destructure `{ data }` and call `.has(...)` on it. */
export function useCapabilities() {
  const { data, ...rest } = useMyAccess()
  return { ...rest, data: data?.capabilities }
}

/**
 * True only when we KNOW the user holds `view_financials`.
 *
 * Fails closed by construction: `undefined` while the query is in flight and
 * on error alike, so this returns false until proven otherwise. That matters
 * more than it looks — a single render where a restricted number is painted
 * before the check resolves is exactly the leak the gate exists to prevent, and
 * a flicker in the other direction (money appearing a beat late for the three
 * people entitled to it) costs nothing.
 *
 * As of migration 086 this is no longer only a UI gate: project_financials is
 * restricted at the database layer too, so a non-holder reading it directly with
 * the anon key now gets zero rows rather than the price. Two caveats before
 * calling it airtight — project_segments.price_per_n is still soft-gated (RLS
 * cannot restrict a column, and a column-level GRANT would break the browser's
 * `select *`), and server routes run as the service role, which bypasses RLS and
 * must call canViewFinancials() in app code.
 */
export function useCanViewFinancials(): boolean {
  const { data } = useMyAccess()
  return data?.capabilities.has(VIEW_FINANCIALS) ?? false
}

/** True only when we KNOW the user may change other people's access. Gates the
 *  admin Access panel. Fails closed, same as above — and the server route checks
 *  again, because a hidden button is not a permission check. */
export function useCanManagePermissions(): boolean {
  const { data } = useMyAccess()
  return data?.capabilities.has(MANAGE_PERMISSIONS) ?? false
}
