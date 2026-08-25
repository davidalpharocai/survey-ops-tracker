import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'
import type { Database } from '@/lib/supabase/types'

export type ProjectCost = Database['public']['Tables']['project_costs']['Row']
type CostInsert = Database['public']['Tables']['project_costs']['Insert']
type CostUpdate = Database['public']['Tables']['project_costs']['Update']

/**
 * The only two kinds migration 080's check constraint allows. `kind` is a stored
 * slug the UI relabels (same pattern as status Closed → "Archived"), and the
 * constraint rejects anything else, so this list is the whole world — adding a
 * third kind is a migration, not an edit here.
 */
export const COST_KINDS = [
  { value: 'sms_email_blast', label: 'SMS/Email Blast' },
  { value: 'contacts_export', label: 'Contacts Export' },
] as const

export type CostKind = (typeof COST_KINDS)[number]['value']

/** Slug → label, falling back to the raw slug so a kind added in SQL ahead of
 *  the UI still renders something readable instead of a blank. */
export function costKindLabel(kind: string): string {
  return COST_KINDS.find(k => k.value === kind)?.label ?? kind
}

/** Σ of the flat vendor fees. Mirrors the third term migration 080 added to
 *  recompute_project_spend, so this subtotal and actual_spend agree by
 *  construction rather than by coincidence. */
export function totalCostLines(rows: { amount?: number | null }[]): number {
  return rows.reduce((s, r) => s + (r.amount ?? 0), 0)
}

export function useProjectCosts(projectId: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['costs', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_costs')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as ProjectCost[]
    },
    enabled: !!projectId,
    // If the migration hasn't run yet the table is absent — fail once and show
    // the "needs migration" fallback rather than retrying forever.
    retry: false,
  })
}

// A cost write changes actual_spend (via the 080 trigger), so refresh the detail
// + board caches too — the hero "Budget left" reads that column.
function invalidateAll(qc: QueryClient, projectId: string) {
  qc.invalidateQueries({ queryKey: ['costs', projectId] })
  qc.invalidateQueries({ queryKey: ['project', projectId] })
  qc.invalidateQueries({ queryKey: ['projects'] })
}

export function useAddCost(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (c: Omit<CostInsert, 'project_id'>) => {
      const { error } = await supabase.from('project_costs').insert({ ...c, project_id: projectId })
      if (error) throw error
    },
    onError: () => toast("Couldn't add the cost line — please try again."),
    onSettled: () => invalidateAll(qc, projectId),
  })
}

export function useUpdateCost(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: CostUpdate }) => {
      const { error } = await supabase.from('project_costs').update(updates).eq('id', id)
      if (error) throw error
    },
    onError: () => toast("Couldn't save the cost line — please try again."),
    onSettled: () => invalidateAll(qc, projectId),
  })
}

export function useDeleteCost(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_costs').delete().eq('id', id)
      if (error) throw error
    },
    onError: () => toast("Couldn't delete the cost line — please try again."),
    onSettled: () => invalidateAll(qc, projectId),
  })
}
