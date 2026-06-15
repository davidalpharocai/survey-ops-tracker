import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

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
    enabled: !!projectId,
    retry: false,
    staleTime: 15_000,
  })
}

/** Master audit log across all projects, with the project joined for linking. */
export function useAuditLog(limit = 100) {
  const supabase = createClient()
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
    retry: false,
    staleTime: 15_000,
  })
}
