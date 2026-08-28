import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'
import type { Database } from '@/lib/supabase/types'

export type Blast = Database['public']['Tables']['project_blasts']['Row']
type BlastInsert = Database['public']['Tables']['project_blasts']['Insert']
type BlastUpdate = Database['public']['Tables']['project_blasts']['Update']

/** Postgres 23502 — a NULL written into a column that is still `not null`. The
 *  only way to hit it here is the pre-migration-091 schema; PostgREST surfaces
 *  the SQLSTATE as `code` on the error object. */
function isNotNullViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '23502'
}

/** Postgres 23514 — 091's `project_blasts_figures_chk`, which rejects a negative
 *  bid / reach / completes. Reachable by hand: NumberCell has no min and
 *  commitNumber accepts a leading minus, so a mistyped "-25" gets this far. Before
 *  091 it saved silently and quietly subtracted from the project's spend; now it
 *  is refused, and without this arm the refusal reads as the generic "please try
 *  again", which is an unexplained loop rather than an answer. */
function isCheckViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '23514'
}

export function useProjectBlasts(projectId: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['blasts', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_blasts')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as Blast[]
    },
    // If the migration hasn't run yet the table is absent — fail once and show
    // the "needs migration" fallback rather than retrying forever.
    retry: false,
  })
}

export function useAddBlast(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (b: Omit<BlastInsert, 'project_id'>) => {
      const { error } = await supabase.from('project_blasts').insert({ ...b, project_id: projectId })
      if (error) throw error
    },
    onError: () => toast("Couldn't add the blast — please try again."),
    onSettled: () => {
      // A blast write changes actual_spend (via DB trigger), so refresh the
      // detail + board caches too — the hero "Budget left" reads that column.
      qc.invalidateQueries({ queryKey: ['blasts', projectId] })
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useUpdateBlast(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: BlastUpdate }) => {
      const { error } = await supabase.from('project_blasts').update(updates).eq('id', id)
      if (error) throw error
    },
    // Clearing $/bid, # people or # completes back to "not recorded" writes an
    // explicit NULL, which the columns only accept once migration 091 is applied
    // (David applies migrations by hand, days after the deploy). Until then the
    // write is rejected with a not-null violation — name it, because "please try
    // again" would send someone round that loop forever.
    onError: (err: unknown) => toast(
      isNotNullViolation(err)
        ? "Can't clear that yet — blast figures can't be left blank until the next database migration is applied."
        : isCheckViolation(err)
          ? "Blast figures can't be negative — enter 0 for a genuine zero, or clear the box to mark it not recorded."
          : "Couldn't save the blast — please try again."),
    onSettled: () => {
      // A blast write changes actual_spend (via DB trigger), so refresh the
      // detail + board caches too — the hero "Budget left" reads that column.
      qc.invalidateQueries({ queryKey: ['blasts', projectId] })
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useDeleteBlast(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_blasts').delete().eq('id', id)
      if (error) throw error
    },
    onError: () => toast("Couldn't delete the blast — please try again."),
    onSettled: () => {
      // A blast write changes actual_spend (via DB trigger), so refresh the
      // detail + board caches too — the hero "Budget left" reads that column.
      qc.invalidateQueries({ queryKey: ['blasts', projectId] })
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}
