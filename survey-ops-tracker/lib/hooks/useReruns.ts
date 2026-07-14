'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

// The read model is the rerun_status VIEW (mirror + durable meta + the computed
// effective_due / is_overdue / needs_definition), so the "nothing-missed" logic
// lives in one place the page, badge, and digest all share.
export type RerunRow = Database['public']['Views']['rerun_status']['Row']

export function useReruns() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['rerun-snapshot'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rerun_status')
        .select('*')
        .order('effective_due', { ascending: true, nullsFirst: false })
      if (error) {
        // Before migrations 049/050 are applied the view doesn't exist yet —
        // treat that as "no data yet" (friendly empty state), not a hard error.
        if (error.code === '42P01' || /does not exist/i.test(error.message)) return []
        throw error
      }
      return data as RerunRow[]
    },
    staleTime: 60_000,
  })
}

export interface RerunMetaPatch {
  rerun_key: string
  cadence_months?: number | null
  last_wave_on?: string | null
  expected_next_on?: string | null
  owner_email?: string | null
  paused?: boolean
  display_name?: string | null
  note?: string | null
}

// Define a rerun's cadence/owner or log its latest wave → POST /api/reruns/meta.
export function useSetRerunMeta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: RerunMetaPatch) => {
      const res = await fetch('/api/reruns/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Save failed')
      return body
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rerun-snapshot'] })
      qc.invalidateQueries({ queryKey: ['rerun-overdue-count'] })
    },
  })
}

// Analyst-triggered refresh of the mirror from the sheet → POST /api/reruns/sync.
export function useSyncReruns() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/reruns/sync', { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { count?: number; error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Sync failed')
      return body
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rerun-snapshot'] })
      qc.invalidateQueries({ queryKey: ['rerun-overdue-count'] })
    },
  })
}
