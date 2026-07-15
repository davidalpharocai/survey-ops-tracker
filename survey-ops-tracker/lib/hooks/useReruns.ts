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
  backup_owner_email?: string | null
  lead_days?: number | null
  paused?: boolean
  display_name?: string | null
  note?: string | null
}

export interface RerunReview {
  id: string
  reviewed_by: string | null
  created_at: string
}

// The most recent weekly rerun-review record (or null if none yet) — drives the
// "armed each Monday" banner.
export function useLastRerunReview() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['rerun-review'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rerun_review_log')
        .select('id, reviewed_by, created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) {
        // Pre-migration-051 the table doesn't exist — treat as "never reviewed".
        if (error.code === '42P01' || /does not exist/i.test(error.message)) return null
        throw error
      }
      return (data as RerunReview) ?? null
    },
    staleTime: 60_000,
  })
}

// Record that the weekly review was completed → POST /api/reruns/review.
export function useMarkRerunReviewed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (counts: { overdue_count: number; undefined_count: number; due_soon_count: number }) => {
      const res = await fetch('/api/reruns/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(counts),
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Failed to record review')
      return body
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rerun-review'] }),
  })
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
