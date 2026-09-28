import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { FieldRows } from './sections'

/** A table this hook could not read, and what the database said. */
export interface FieldRowsBlocked {
  table: 'project_blasts' | 'project_suppliers' | 'project_costs'
  message: string
}

export interface ScopingFieldRows {
  /** Counts per project id. A project with no rows is simply absent. */
  rows: Map<string, FieldRows>
  /** Tables that failed. Their counts are UNKNOWN, not zero — say so on screen. */
  blocked: FieldRowsBlocked[]
}

const CHUNK = 100
const PAGE = 1000

type PageRun = (
  chunk: string[],
  from: number,
  to: number
) => PromiseLike<{ data: { project_id: string }[] | null; error: { message: string } | null }>

/**
 * Every `project_id` a query returns for the given projects, paged. Ids go in
 * chunks so a long lane cannot outgrow the URL; each page is ORDERED (the
 * caller's `.order('id')`) and ranged, because a range with no ORDER BY has no
 * stable page boundary, so a row could appear twice or not at all.
 */
async function projectIdsIn(table: FieldRowsBlocked['table'], ids: string[], run: PageRun): Promise<string[]> {
  const out: string[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await run(chunk, from, from + PAGE - 1)
      if (error) throw new Error(error.message || `${table} did not load`)
      const page = data ?? []
      for (const r of page) out.push(r.project_id)
      if (page.length < PAGE) break
    }
  }
  return out
}

/**
 * Blast, panel-supplier and send-fee row COUNTS for the surveys in the scoping
 * lane — what `fieldActivityOf` needs to flag a survey that is still marked
 * Scoping but has started fielding. Selects `id, project_id` only: no bid, no
 * CPI, no amount. The board shows everyone the flag; it never shows a dollar.
 *
 * One table failing does not hide the others (allSettled), and a failed table
 * is reported in `blocked` rather than read as "no rows".
 */
export function useScopingFieldRows(projectIds: string[]) {
  // Sorted so the same lane in a different card order is the same cache entry.
  const ids = [...projectIds].sort()
  return useQuery({
    queryKey: ['board-scoping-field-rows', ids.join(',')],
    enabled: ids.length > 0,
    // The key changes whenever a card enters or leaves the lane (a drag, a new
    // inquiry). Keep showing the last answer while the new one loads, so the
    // amber flags do not blink off and back on with every move.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ScopingFieldRows> => {
      const supabase = createClient()
      const [blasts, panel, sendCosts] = await Promise.allSettled([
        projectIdsIn('project_blasts', ids, (chunk, from, to) =>
          supabase.from('project_blasts').select('id, project_id').in('project_id', chunk).order('id').range(from, to)
        ),
        projectIdsIn('project_suppliers', ids, (chunk, from, to) =>
          supabase.from('project_suppliers').select('id, project_id').in('project_id', chunk).order('id').range(from, to)
        ),
        // Only the platform fee for a send is fielding. Contact purchases and
        // "other" lines can be bought while a deal is still being sized.
        projectIdsIn('project_costs', ids, (chunk, from, to) =>
          supabase
            .from('project_costs')
            .select('id, project_id')
            .in('project_id', chunk)
            .eq('kind', 'sms_email_blast')
            .order('id')
            .range(from, to)
        ),
      ])
      const rows = new Map<string, FieldRows>()
      const blocked: FieldRowsBlocked[] = []
      const tally = (
        r: PromiseSettledResult<string[]>,
        table: FieldRowsBlocked['table'],
        field: keyof FieldRows
      ) => {
        if (r.status === 'rejected') {
          blocked.push({ table, message: (r.reason as Error)?.message ?? 'did not load' })
          return
        }
        for (const id of r.value) {
          const cur = rows.get(id) ?? { blasts: 0, panel: 0, sendCosts: 0 }
          cur[field] += 1
          rows.set(id, cur)
        }
      }
      tally(blasts, 'project_blasts', 'blasts')
      tally(panel, 'project_suppliers', 'panel')
      tally(sendCosts, 'project_costs', 'sendCosts')
      return { rows, blocked }
    },
  })
}
