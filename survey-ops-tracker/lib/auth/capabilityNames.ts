// Permission NAMES only — no imports, no DB, no 'server-only'.
//
// This file exists because lib/auth/capabilities.ts is `server-only`: importing
// it from a client component throws at bundle time. The browser hook
// (lib/hooks/useCapabilities.ts) and the server reader both need the same
// string, and a string duplicated in two places is a gate that can silently
// drift, so the name lives here on its own and both sides import it.
//
// "Capability" and "permission" are the same thing under two names, for
// historical reasons worth knowing: 079 shipped per-user grants in
// profile_capabilities before there were roles to bundle them, so the older code
// says capability. 085 added the catalogue table and called it `permissions`,
// which is the term the admin UI uses. can() answers from the union of a direct
// grant and a role-derived one, so a caller never needs to know which mechanism
// supplied the answer — that is the whole point of asking can() rather than
// reading a table.

/** May see client pricing, contract value and margin. NOT cost-to-run (blasts,
 *  launches, vendor lines) — everyone internal sees that, by design. Hard-gated
 *  at the database layer for project_financials as of migration 086. */
export const VIEW_FINANCIALS = 'view_financials'

/** May grant and revoke other people's roles. Sensitive: nobody can grant it to
 *  themselves (migration 085 step 6 refuses the self-grant), and the last holder
 *  cannot be revoked. David and Shanu hold it. */
export const MANAGE_PERMISSIONS = 'manage_permissions'

/** May download project or client data as a file. Every export writes a row to
 *  data_exports (081) naming who took what. */
export const EXPORT_DATA = 'export_data'

/** May see every client, not only the ones this person is the salesperson for.
 *  Analysts hold this implicitly — it exists for scoped tiers, and does nothing
 *  until the sales tier and the salesperson foreign key land. */
export const VIEW_ALL_CLIENTS = 'view_all_clients'

export type Capability =
  | typeof VIEW_FINANCIALS
  | typeof MANAGE_PERMISSIONS
  | typeof EXPORT_DATA
  | typeof VIEW_ALL_CLIENTS

/** Role names from migration 085. Roles bundle permissions; a person may hold
 *  several. Kept here beside the permission names so the admin UI has one
 *  import, and typed as a union so a typo in a grant call is a build error. */
export const ROLE_FINANCE = 'finance'
export const ROLE_ADMIN = 'admin'
export const ROLE_SALES = 'sales'

export type RoleName = typeof ROLE_FINANCE | typeof ROLE_ADMIN | typeof ROLE_SALES
