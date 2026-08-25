import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'

// The price-per-N reads/writes behind the Money card's revenue block. The finance
// GATE itself is not here — that is lib/hooks/useCapabilities.ts, shared with the
// client page and /insights so all three surfaces hide on exactly one condition.

export interface ProjectRates {
  /** project_financials.price_per_n — the project-wide default $ per completed
   *  response. NOT a column on survey_projects: migration 082 keeps revenue in its
   *  own table precisely so `select *` on the project can never carry it along. */
  projectRate: number | null
  /** Per-segment overrides, in sort order. `rate` null = inherits the project default. */
  segments: { id: string; rate: number | null }[]
  /**
   * True when the pricing store couldn't be read at all — which today means 082
   * hasn't been applied by hand yet. Every rate above then reads null, and the
   * widget says so instead of showing a confident "—" that looks like a decision
   * nobody has made.
   */
  unavailable: boolean
}

/**
 * price_per_n from project_financials + project_segments.
 *
 * Its own query, deliberately NOT folded into useProject / useProjectSegments:
 * those two feed the whole project page, and both halves of this arrive in a
 * hand-applied migration (082). Widening either select would blank the page for
 * everyone in the window between deploy and SQL. Isolated here, a missing table or
 * column fails alone and the Money card shows its "needs the migration" line.
 */
export function useProjectRates(projectId: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['project-rates', projectId],
    queryFn: async (): Promise<ProjectRates> => {
      // Neither price_per_n is in the generated Database type yet (types are
      // regenerated in their own pass), so both reads go through an untyped
      // handle and get narrowed here — the shape lib/auth/capabilities.ts uses.
      const db = supabase as unknown as SupabaseClient
      const [proj, segs] = await Promise.all([
        db.from('project_financials').select('price_per_n').eq('project_id', projectId).maybeSingle(),
        db.from('project_segments').select('id, price_per_n').eq('project_id', projectId).order('sort_order'),
      ])
      // Each half swallows its OWN error rather than throwing for both. Pre-082
      // project_financials is a missing TABLE and project_segments.price_per_n a
      // missing COLUMN — and PostgREST fails the entire request either way — so a
      // shared throw would let the segment overrides take the project default down
      // with them (and vice versa). Degrade to "no rate", then say so once.
      const row = proj.error ? null : (proj.data as { price_per_n: number | null } | null)
      const rows = segs.error ? [] : ((segs.data ?? []) as { id: string; price_per_n: number | null }[])
      return {
        // A project nobody has priced has NO row here (082 backfills nothing), so a
        // missing row is "unpriced", not an error.
        projectRate: row?.price_per_n ?? null,
        segments: rows.map(s => ({ id: s.id, rate: s.price_per_n })),
        unavailable: !!proj.error || !!segs.error,
      }
    },
    enabled: !!projectId,
    // The table/column may not exist yet — fail once and show the fallback rather
    // than retrying forever (same as useProjectCosts).
    retry: false,
  })
}

/**
 * Pre-082 the table and the segment column simply aren't there, and PostgREST
 * names whichever one it couldn't find. That name is the only signal we get — so
 * match on it and tell David which migration is missing, instead of repeating a
 * raw column name at him.
 */
function needsMigration(e: Error): boolean {
  const m = e.message ?? ''
  return m.includes('project_financials') || m.includes('price_per_n')
}

/** The project-wide default rate. null clears it, which drops every inheriting
 *  segment back to unpriced — deliberate, and the widget says so. */
export function useSetProjectRate(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (rate: number | null) => {
      const db = supabase as unknown as SupabaseClient
      // UPSERT, not update: 082 creates project_financials with project_id as the
      // PRIMARY KEY and backfills nothing, so a never-priced project has no row.
      // An .update() there matches zero rows, PostgREST answers 200, the mutation
      // "succeeds", onSettled refetches — and the first price anyone types silently
      // reverts to '—'. Never a delete, either: clearing a price is an UPDATE to
      // null, which is what 082's audit trigger logs and why it grants no DELETE.
      const { error } = await db
        .from('project_financials')
        .upsert({ project_id: projectId, price_per_n: rate }, { onConflict: 'project_id' })
      if (error) throw error
    },
    onError: (e: Error) =>
      toast(
        needsMigration(e)
          ? 'Client pricing needs the project_financials migration (082) in Supabase, then try again.'
          : "Couldn't save the price — please try again.",
      ),
    // Price is revenue: it does NOT touch actual_spend, so only the rates cache
    // needs refreshing. Nothing here invalidates ['project'] or ['projects'].
    onSettled: () => qc.invalidateQueries({ queryKey: ['project-rates', projectId] }),
  })
}

/** A per-segment override. Passing null REMOVES the override and the segment
 *  goes back to inheriting the project default. */
export function useSetSegmentRate(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, rate }: { id: string; rate: number | null }) => {
      const db = supabase as unknown as SupabaseClient
      // A plain update is right here — the segment row already exists; only the
      // price column is new in 082.
      const { error } = await db.from('project_segments').update({ price_per_n: rate }).eq('id', id)
      if (error) throw error
    },
    onError: (e: Error) =>
      toast(
        needsMigration(e)
          ? 'Segment pricing needs the project_financials migration (082) in Supabase, then try again.'
          : "Couldn't save the segment price — please try again.",
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: ['project-rates', projectId] }),
  })
}
