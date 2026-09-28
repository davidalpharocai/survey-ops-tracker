'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import type { Database } from '@/lib/supabase/types'

type ClientUpdate = Database['public']['Tables']['clients']['Update']

/** Said when the column is not there yet. Plain words, and it says nothing
 *  was saved — the failure this replaces was a generic "try again". */
const NOT_MIGRATED =
  'Not saved: the database does not have this field yet (update 122 has not been applied). Nothing was changed.'

const TIP =
  'The client’s own name, as it should appear after “Prepared for” and in the page footer of the Survey Activity Statement and the Survey List that salespeople send to this client. Leave it blank to print the internal name. Salespeople can still change it for a single print; this is the default they start from.'

/**
 * "Name as printed on client documents" (clients.display_name, migration 122).
 *
 * The internal name is our label — "DE Shaw" — and the documents that go to
 * the client should use theirs: "The D. E. Shaw Group". Set once here, it fills
 * in the print page's name field for every salesperson.
 *
 * NOTHING HERE ASSUMES 122 HAS RUN. The client row is read with select('*'),
 * so the field is simply absent before the migration; the input is then shown
 * disabled with the reason. A save that still reaches a database without the
 * column fails LOUDLY with that same reason — never a silent no-op, and never
 * the generic "couldn't save" that sends someone off to retry a thing that
 * cannot work. A save that changes no row (a policy that denies it) says so
 * too, because PostgREST reports that case as success.
 */
export function ClientDisplayNameCard({ client }: { client: { id: string; name: string } & Record<string, unknown> }) {
  const hasColumn = Object.prototype.hasOwnProperty.call(client, 'display_name')
  const saved = typeof client.display_name === 'string' ? client.display_name : ''
  const [draft, setDraft] = useState(saved)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const cancelRef = useRef(false)
  const queryClient = useQueryClient()

  // Follow the saved value when it changes underneath (another tab, the connector).
  useEffect(() => { setDraft(saved) }, [saved])

  const save = useMutation({
    mutationFn: async (value: string | null) => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('clients')
        .update({ display_name: value } as unknown as ClientUpdate)
        .eq('id', client.id)
        .select('id')
      if (error) {
        // PGRST204: PostgREST has no such column in its schema cache. 42703:
        // Postgres has no such column. Either way, 122 is not in.
        if (error.code === 'PGRST204' || error.code === '42703' || /display_name/.test(error.message ?? '')) {
          throw new Error(NOT_MIGRATED)
        }
        if (error.code === '23514') throw new Error('Not saved: the name must be between 1 and 200 characters.')
        throw new Error(`Not saved: ${error.message}`)
      }
      if (!data || data.length === 0) {
        throw new Error('Not saved: the database accepted the request but changed nothing, which usually means this account is not allowed to edit this client.')
      }
    },
    onSuccess: () => {
      setMessage({ kind: 'ok', text: 'Saved.' })
      queryClient.invalidateQueries({ queryKey: ['client', client.id] })
      queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
    onError: (e: Error) => {
      setMessage({ kind: 'error', text: e.message })
      setDraft(saved)
    },
  })

  function commit() {
    if (cancelRef.current) { cancelRef.current = false; return }
    const next = draft.trim()
    if (next === saved.trim()) return
    if (!hasColumn) { setMessage({ kind: 'error', text: NOT_MIGRATED }); setDraft(saved); return }
    setMessage(null)
    save.mutate(next || null)
  }

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col gap-2">
      <label htmlFor="client-display-name" className="text-xs text-muted-foreground uppercase tracking-widest font-medium flex items-center">
        Name as printed on client documents
        <InfoTooltip text={TIP} />
      </label>
      <input
        id="client-display-name"
        value={draft}
        disabled={!hasColumn || save.isPending}
        onChange={e => { setDraft(e.target.value); setMessage(null) }}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') { cancelRef.current = true; setDraft(saved); (e.target as HTMLInputElement).blur() }
        }}
        maxLength={200}
        placeholder={client.name}
        className="bg-muted border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-ring disabled:opacity-60"
      />
      <p className="text-[11px] text-muted-foreground">
        {hasColumn
          ? <>Blank prints the internal name, &ldquo;{client.name}&rdquo;.</>
          : <>Waiting on database update 122. Until it is applied this cannot be saved, and the documents print &ldquo;{client.name}&rdquo; unless a salesperson types a name for that print.</>}
      </p>
      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : undefined}
          className={`text-[11px] ${message.kind === 'error' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}
        >
          {message.text}
        </p>
      )}
    </div>
  )
}
