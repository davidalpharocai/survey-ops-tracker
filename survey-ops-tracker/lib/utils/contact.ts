import type { Tables } from '@/lib/supabase/types'

export type ClientContact = Tables<'client_contacts'>

/** "First Last" — the display name and the snapshot stored on a project. */
export function contactName(c: Pick<ClientContact, 'first_name' | 'last_name'>): string {
  return `${c.first_name} ${c.last_name}`.trim()
}

/** A one-line secondary description (title and/or email), or '' if neither set. */
export function contactSubtitle(c: Pick<ClientContact, 'title' | 'email'>): string {
  return [c.title, c.email].filter(Boolean).join(' · ')
}

/**
 * ── SORTING AND SEARCHING A LIST OF CONTACTS ────────────────────────────────
 *
 * `useClientContacts` used to order by `last_name` then `first_name` — a
 * sensible sort of a field the screen never shows. Every surface renders
 * `contactName` above, so a surname sort puts
 *
 *     Elliot Birman · James Cook · Grey Jones · Jared Khoo
 *
 * on screen and reads as unsorted to the person looking at it. David asked for
 * contacts alphabetised (2026-09-17), and alphabetical means alphabetical BY
 * WHAT IS ON THE SCREEN. Sorting on a hidden key is the same class of error as
 * labelling a number with a population it was not computed on.
 */

/** Shaped enough to name and sort. Deliberately looser than ClientContact so
 *  the finance account filter and the nav search can use it too. */
export interface NameableContact {
  first_name?: string | null
  last_name?: string | null
  email?: string | null
}

/** What the screen shows, with an email fallback — a contact with no name is
 *  still a contact somebody chose, and an empty row cannot be clicked on
 *  purpose. */
export function displayName(c: NameableContact): string {
  const n = [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
  return n || c.email || '(unnamed contact)'
}

/** Comparator on the DISPLAYED name. Case-insensitive so a lower-case entry
 *  does not sink to the bottom of an otherwise tidy list. */
export const byDisplayName = (a: NameableContact, b: NameableContact): number =>
  displayName(a).localeCompare(displayName(b), undefined, { numeric: true, sensitivity: 'base' })

/** Sorts a COPY. Several callers hold the array react-query is caching, and
 *  sorting in place would make the order depend on which component rendered
 *  first. */
export const sortByDisplayName = <T extends NameableContact>(rows: T[]): T[] =>
  rows.slice().sort(byDisplayName)

/**
 * Does this contact match what someone typed?
 *
 * Matches the display name, either name part, and the email — someone typing
 * "cook" and someone typing "james.cook@" are looking for the same row.
 * Tokenised, so "james cook" and "cook james" both hit.
 */
export function contactMatches(c: NameableContact, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = [displayName(c), c.first_name, c.last_name, c.email]
    .filter(Boolean).join(' ').toLowerCase()
  return q.split(/\s+/).every(tok => hay.includes(tok))
}
