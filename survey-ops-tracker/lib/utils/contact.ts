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
