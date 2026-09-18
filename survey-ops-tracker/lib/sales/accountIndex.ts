/**
 * Which account a sales row belongs to, and the picker built from it.
 *
 * David, 2026-09-17: "on the survey tab, client should be a drop down and no
 * each its only bubble toggle" — and the same filter is wanted on the sales
 * home and the contacts page.
 *
 * ── THE CHIPS ARE NOT THE PROBLEM; THE KEY IS ───────────────────────────────
 * `survey_projects.client` is a stale denormalised string that still carries a
 * contact suffix. Measured on the 416 live rows: 101 carry a label that is not
 * `clients.name`, and 14 accounts wear more than one — BAM NINE ("BAM",
 * "BAM - James Cook", "BAM - Elliot", "BAM - Grey Jones", "BAM - Nick Amato",
 * "BAM - Jeff Cumming", "BAM - Rachel", "BAM - Jared Khoo", "BAM - Jared
 * Osteen"), Holocene six, BofA/Bain/Gingrich360/SEMA three each.
 *
 * A chip per distinct label therefore shows **106 chips for 76 accounts**.
 * Turning it into a dropdown without changing the key would just be a
 * 106-option dropdown. The fix is to key on `client_id`, which the
 * `sales_projects` view already exposes and which is NULL on 0 of 416 rows.
 *
 * ── WHY THE OPTIONS COME FROM THE ROWS, NOT FROM sales_clients ──────────────
 * The two are scoped differently: `sales_clients` is owner-scoped, while
 * `sales_projects` is owner OR named-salesperson. So they disagree in both
 * directions — Alex owns 4 accounts with no surveys (dead options) and Vineet
 * sees 7 accounts in his book that he does not own (missing options). Building
 * the list from the rows a rep can actually see is correct for every rep;
 * building it from the account table is wrong for all of them.
 *
 * `sales_clients` is still used for the NAME. Where it cannot resolve an id,
 * the shortest label in that id's own group is used instead: measured, every
 * one of the 416 labels is either exactly `clients.name` or that name plus a
 * suffix, and nothing else — so the shortest label in a group IS the canonical
 * name. That fallback is a display convenience and never a link target.
 */

export interface SalesAccountRef {
  id: string
  name: string | null
}

export interface AccountRow {
  client_id: string | null
  /** The stale label. Used only as a naming fallback, never as a key. */
  client: string | null
}

export interface AccountOption {
  id: string
  name: string
  /** How many rows in the current set belong to it — shown in the option so a
   *  reader can see the shape of their book without opening each one. */
  count: number
  /** False when `sales_clients` could not name this id. The option still works
   *  as a FILTER, but must not be rendered as a link to /sales/accounts/[id],
   *  which 404s for an account the reader does not own. */
  resolved: boolean
}

/** id -> canonical name. */
export function accountIndex(clients: SalesAccountRef[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const c of clients) if (c.name) m.set(c.id, c.name)
  return m
}

/**
 * The display name for one account id.
 *
 * `fallbackLabels` are every stale label seen on that id in the current row
 * set. The shortest wins, because a suffixed label is the canonical name plus
 * something — never a different name.
 */
export function accountNameOf(
  clientId: string | null,
  fallbackLabels: string[],
  index: Map<string, string>,
): string {
  if (clientId) {
    const known = index.get(clientId)
    if (known) return known
  }
  const usable = fallbackLabels.filter(Boolean) as string[]
  if (!usable.length) return '(no account)'
  return usable.slice().sort((a, b) => a.length - b.length || a.localeCompare(b))[0]
}

/**
 * The picker's options, built from the rows.
 *
 * Alphabetical by the name on screen — the same rule the contact pickers follow,
 * and for the same reason: a list sorted by anything the reader cannot see
 * reads as unsorted. An account with no row in the current set is omitted;
 * offering it would empty the page with no way to tell why.
 */
export function accountOptions(
  rows: AccountRow[],
  clients: SalesAccountRef[],
): AccountOption[] {
  const index = accountIndex(clients)
  const byId = new Map<string, { count: number; labels: string[] }>()
  for (const r of rows) {
    if (!r.client_id) continue
    const e = byId.get(r.client_id) ?? { count: 0, labels: [] }
    e.count++
    if (r.client) e.labels.push(r.client)
    byId.set(r.client_id, e)
  }
  return [...byId.entries()]
    .map(([id, e]) => ({
      id,
      name: accountNameOf(id, e.labels, index),
      count: e.count,
      resolved: index.has(id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/** Filter predicate. An empty selection means "no filter" rather than "nothing
 *  matches" — the distinction a naive `includes` gets wrong on first render. */
export function inAccounts(row: { client_id: string | null }, ids: string[]): boolean {
  if (!ids.length) return true
  return row.client_id != null && ids.includes(row.client_id)
}
