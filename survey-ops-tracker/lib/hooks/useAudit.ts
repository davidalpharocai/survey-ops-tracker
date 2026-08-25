import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useCanViewFinancials } from '@/lib/hooks/useCapabilities'
import { isRestrictedAuditField } from '@/lib/utils/auditFormat'

// WHY THESE READS FILTER — project_audit stores every changed value as plain
// text, so a budget edit sits in the feed as "6000 → 8000" and (once 082 runs) a
// rate change as "$3.50 per N → $4.00 per N". Both renderers print old → new
// verbatim, and the MasterAuditLog behind /admin has no gate of its own, so
// without this the log hands out every restricted number it has ever recorded.
//
// Whole ROWS are dropped, not just their values: a row reading "Price per N —"
// still says a price moved, when, and who moved it, which is most of what we are
// hiding. `actual_spend` rows stay — cost to run is public.
//
// This is app-side filtering over a table any Supabase key can still SELECT, so
// it is a soft gate on the surface, not a boundary. Don't call it one.
const visibleTo = <T extends { field: string }>(rows: T[], canViewFinancials: boolean): T[] =>
  canViewFinancials ? rows : rows.filter(r => !isRestrictedAuditField(r.field))

export interface AuditEntry {
  id: string
  project_id: string
  field: string
  old_value: string | null
  new_value: string | null
  changed_by: string
  changed_at: string
}

export interface AuditLogEntry extends AuditEntry {
  project: {
    id: string
    project_name: string
    project_code: string | null
    client: string
  } | null
}

/** Per-project field history (newest first). retry:false so a pre-migration
 *  database shows the fallback instead of hammering retries. */
export function useProjectAudit(projectId: string) {
  const supabase = createClient()
  const canViewFinancials = useCanViewFinancials()
  return useQuery({
    queryKey: ['audit', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_audit')
        .select('*')
        .eq('project_id', projectId)
        .order('changed_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return data as AuditEntry[]
    },
    // Filtered in `select`, not in queryFn, so the flag is not part of the cache
    // key: useCanViewFinancials fails closed and flips to true a beat later for
    // the three people who hold the grant, and re-deriving beats refetching the
    // whole log the moment it does.
    select: rows => visibleTo(rows, canViewFinancials),
    enabled: !!projectId,
    retry: false,
    staleTime: 15_000,
  })
}

/** Master audit log across all projects, with the project joined for linking. */
export function useAuditLog(limit = 100) {
  const supabase = createClient()
  const canViewFinancials = useCanViewFinancials()
  return useQuery({
    queryKey: ['audit-log', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_audit')
        .select(
          'id, project_id, field, old_value, new_value, changed_by, changed_at, project:survey_projects(id, project_name, project_code, client)'
        )
        .order('changed_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data as unknown as AuditLogEntry[]
    },
    // Same reasoning as useProjectAudit — restricted rows never reach the render.
    // Note the count drops with them, so the "showing the N most recent" footer
    // stops appearing for anyone without the grant; that is the cost of not
    // announcing how many rows were withheld.
    select: rows => visibleTo(rows, canViewFinancials),
    retry: false,
    staleTime: 15_000,
  })
}
