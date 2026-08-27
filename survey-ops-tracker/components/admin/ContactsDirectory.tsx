'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useAllContacts } from '@/lib/hooks/useClientContacts'
import { InfoTooltip } from '@/components/shared/InfoTooltip'

const tile = 'bg-card border border-border shadow-sm rounded-xl p-4'
const heading =
  'text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center'

/**
 * Every contact across every account, grouped by account.
 *
 * Sits beside Accounts on the same Admin tab, because that is how the pair is
 * actually used: an account is a firm, a contact is who at that firm asks for
 * work, and "who do we know at Holocene" is one question, not two pages.
 *
 * Read-only on purpose. Contacts are created and edited on the client page,
 * where the account context is already on screen — a second editing surface here
 * would be two ways to do one thing and two places for it to drift. This is a
 * directory and a way in.
 */
export function ContactsDirectory() {
  const { data: contacts = [], isLoading } = useAllContacts()
  const [q, setQ] = useState('')

  const grouped = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const name = (c: { first_name: string | null; last_name: string | null }) =>
      [c.first_name, c.last_name].filter(Boolean).join(' ').trim()

    const matched = needle
      ? contacts.filter((c) => {
          const hay = `${name(c)} ${c.title ?? ''} ${c.clients?.name ?? ''}`.toLowerCase()
          return hay.includes(needle)
        })
      : contacts

    const byClient = new Map<string, { client: string; people: typeof matched }>()
    for (const c of matched) {
      const client = c.clients?.name ?? 'Unknown account'
      const entry = byClient.get(client) ?? { client, people: [] }
      entry.people.push(c)
      byClient.set(client, entry)
    }
    // Alphabetical by account, and by surname within it — a directory is only
    // useful if you can predict where a name will be.
    return [...byClient.values()]
      .map((g) => ({
        ...g,
        people: [...g.people].sort((a, b) =>
          (a.last_name ?? a.first_name ?? '').localeCompare(b.last_name ?? b.first_name ?? '')
        ),
      }))
      .sort((a, b) => a.client.localeCompare(b.client))
  }, [contacts, q])

  return (
    <div className={tile}>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h3 className={`${heading} mb-0`}>
          Contacts ({contacts.length})
          <InfoTooltip text="Everyone we know at every account, grouped by account. Click a contact for their page — every survey they've requested. Add or edit contacts on the account's own page." />
        </h3>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by name, title or account…"
          aria-label="Filter contacts"
          className="bg-muted border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-ring w-full sm:w-64"
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && contacts.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No contacts yet. Add them on an account&apos;s page.
        </p>
      )}
      {!isLoading && contacts.length > 0 && grouped.length === 0 && (
        <p className="text-sm text-muted-foreground">No contact matches “{q}”.</p>
      )}

      <div className="max-h-[26rem] overflow-y-auto thin-scroll pr-1 flex flex-col gap-3">
        {grouped.map((g) => (
          <div key={g.client}>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground/70 mb-1">
              {g.client}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              {g.people.map((c) => (
                <Link
                  key={c.id}
                  href={`/contacts/${c.id}`}
                  className="flex items-baseline justify-between gap-2 py-1 border-b border-border/40 last:border-0 hover:bg-accent/40 rounded px-1 -mx-1 transition-colors"
                >
                  <span className="text-sm text-foreground truncate">
                    {[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}
                  </span>
                  {c.title && (
                    <span className="text-xs text-muted-foreground truncate shrink-0 max-w-[55%]">
                      {c.title}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
