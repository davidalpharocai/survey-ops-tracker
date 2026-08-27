import type { Capability, RoleName } from './capabilityNames'

// The permission union, as one pure function.
//
// It exists in exactly one place on purpose. The server reader
// (lib/auth/capabilities.ts) and the browser hook (lib/hooks/useCapabilities.ts)
// must agree perfectly about what someone may do — a soft gate that disagrees
// with its server twin either leaks a number the UI meant to hide, or hides one
// the API will happily return. Duplicated set-union logic is exactly the kind of
// thing that drifts silently, and a permission bug does not announce itself: too
// permissive returns extra data, too strict returns none, neither raises an
// error. So the queries live in their respective files (one uses the service
// role, one the browser client) and the JUDGEMENT lives here, tested directly.
//
// No imports beyond types, no 'server-only' — importable from either side.

export interface RawAccess {
  /** profile_capabilities rows for this person (migration 079). */
  direct: { capability: string }[] | null | undefined
  /** profile_roles rows for this person (migration 085). */
  roles: { role: string }[] | null | undefined
  /** The whole role_permissions catalogue — reference data, not per-person. */
  bundles: { role: string; permission: string }[] | null | undefined
}

export interface ResolvedAccess {
  capabilities: Set<Capability>
  roles: Set<RoleName>
}

/**
 * Everything a person may do, from the union of the two mechanisms:
 * a permission is held if a ROLE they hold bundles it, OR it was granted to them
 * DIRECTLY. Mirrors `can()` in migration 085.
 *
 * Every input is independently nullable because each comes from its own query
 * that is allowed to fail alone — pre-085 the two role queries 404 while the
 * direct-grant query still answers, which is the state production is in between
 * the deploy and the migration being applied by hand. A null argument
 * contributes nothing rather than throwing, so the result degrades to "fewer
 * permissions", never to an error and never to more.
 */
export function resolveAccess(raw: RawAccess): ResolvedAccess {
  const capabilities = new Set<Capability>()
  const roles = new Set<RoleName>()

  for (const row of raw.direct ?? []) {
    if (row?.capability) capabilities.add(row.capability as Capability)
  }
  for (const row of raw.roles ?? []) {
    if (row?.role) roles.add(row.role as RoleName)
  }
  for (const row of raw.bundles ?? []) {
    // Only bundles for roles this person actually holds. The catalogue lists
    // every role's permissions, including roles they don't have — filtering on
    // membership here is the whole reason the catalogue can be fetched wholesale
    // and cached without leaking anything.
    if (row?.role && row?.permission && roles.has(row.role as RoleName)) {
      capabilities.add(row.permission as Capability)
    }
  }

  return { capabilities, roles }
}
