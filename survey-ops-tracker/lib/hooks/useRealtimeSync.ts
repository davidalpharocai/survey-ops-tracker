'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'

// How long to collect change events before invalidating queries. Bulk writes
// (imports, drag-and-drop reorders) produce many events at once — one flush
// after the burst means one refetch instead of a stampede.
const DEBOUNCE_MS = 250

// Tables whose rows belong to a project and whose query keys are
// scoped as [prefix, projectId].
const PROJECT_SCOPED_TABLES: Record<string, string> = {
  project_steps: 'steps',
  project_bids: 'bid-budget',
  project_blasts: 'blasts',
  project_activity: 'activity',
  project_data_changes: 'data-changes',
}

const WATCHED_TABLES = [
  'survey_projects',
  'project_seen',
  ...Object.keys(PROJECT_SCOPED_TABLES),
]

type ChangePayload = RealtimePostgresChangesPayload<Record<string, unknown>>

/**
 * Subscribes once to Supabase Realtime postgres_changes for the tracker's
 * tables and invalidates the matching TanStack Query caches, so edits made
 * by teammates show up within ~1s without a refresh.
 *
 * Harmless if the tables haven't been added to the `supabase_realtime`
 * publication yet — the channel simply receives no events. Subscription
 * status is logged at console.debug only.
 */
export function useRealtimeSync() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const supabase = createClient()

    // Pending query keys, deduped by serialized form, flushed on a short timer.
    const pending = new Map<string, readonly unknown[]>()
    let timer: ReturnType<typeof setTimeout> | null = null
    let unmounted = false

    function flush() {
      timer = null
      if (unmounted) return
      // Never refetch mid-drag — a list change while a card is held makes the
      // drag library stutter. Re-check shortly until the drag finishes.
      if (window.__sotDragging) {
        timer = setTimeout(flush, DEBOUNCE_MS)
        return
      }
      const keys = [...pending.values()]
      pending.clear()
      for (const queryKey of keys) {
        queryClient.invalidateQueries({ queryKey })
      }
    }

    function queue(key: readonly unknown[]) {
      pending.set(JSON.stringify(key), key)
      // Don't reset the timer on every event — guarantee a flush at most
      // DEBOUNCE_MS after the first event of a burst.
      if (!timer) timer = setTimeout(flush, DEBOUNCE_MS)
    }

    function handleChange(payload: ChangePayload) {
      if (payload.table === 'survey_projects') {
        queue(['projects'])
        // Internal projects share this table but a separate cache — refresh it
        // too so the Internal board updates live (prefix-matched).
        queue(['internal-projects'])
        // Also refresh the full-row detail cache for the changed project.
        const newRow = payload.new as { id?: string } | null
        const oldRow = payload.old as { id?: string } | null
        const rowId = newRow?.id ?? oldRow?.id
        if (rowId) queue(['project', rowId])
        else queue(['project'])
        return
      }
      if (payload.table === 'project_seen') {
        // Seen rows are keyed ['seen', email]; prefix invalidation covers all users.
        queue(['seen'])
        return
      }
      const prefix = PROJECT_SCOPED_TABLES[payload.table]
      if (!prefix) return
      const newRow = payload.new as { project_id?: string } | null
      const oldRow = payload.old as { project_id?: string } | null
      const projectId = newRow?.project_id ?? oldRow?.project_id
      if (projectId) {
        queue([prefix, projectId])
      } else {
        // DELETE payloads only carry the primary key unless the table has
        // REPLICA IDENTITY FULL — fall back to invalidating every query
        // under this prefix (prefix matching is built into TanStack Query).
        queue([prefix])
      }
    }

    let channel = supabase.channel('tracker-db-sync')
    for (const table of WATCHED_TABLES) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        handleChange
      )
    }
    channel.subscribe(status => {
      // Quiet by design: if realtime isn't enabled for these tables yet,
      // we just never receive events. No errors thrown, no console noise.
      console.debug('[realtime-sync] channel status:', status)
    })

    return () => {
      unmounted = true
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [queryClient])
}
