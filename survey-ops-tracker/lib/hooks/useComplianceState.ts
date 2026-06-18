import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { ClientCompliance, SubmissionLite } from '@/lib/utils/compliance'

export interface ComplianceState {
  client: ClientCompliance | null
  override: boolean | null
  submissions: SubmissionLite[]
  contact: string | null
  notes: string | null
}

// clientName is the project's firm-level client text; match the clients row by name.
export function useComplianceState(projectId: string, clientName: string, override: boolean | null) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['compliance-state', projectId, clientName],
    queryFn: async (): Promise<ComplianceState> => {
      const firm = clientName.split(' - ')[0].trim()
      const { data: c } = await supabase
        .from('clients')
        .select('compliance_before_fielding, compliance_after_fielding, compliance_contact, compliance_notes')
        .eq('name', firm)
        .maybeSingle()
      const { data: subs } = await supabase
        .from('question_submissions')
        .select('phase, status')
        .eq('project_id', projectId)
      return {
        client: c
          ? { compliance_before_fielding: c.compliance_before_fielding, compliance_after_fielding: c.compliance_after_fielding }
          : null,
        override,
        submissions: (subs ?? []) as SubmissionLite[],
        contact: c?.compliance_contact ?? null,
        notes: c?.compliance_notes ?? null,
      }
    },
    enabled: !!projectId && !!clientName,
    staleTime: 15_000,
    retry: false,
  })
}

export interface ComplianceMaps {
  clientByFirm: Map<string, ClientCompliance>
  approvedByProject: Map<string, SubmissionLite[]>
}

// Board-wide maps for the drag guardrail: which firms require compliance, and
// which projects already have approved reviews. Degrades to empty maps
// (never blocks) before migration 037 / if the query fails.
export function useComplianceMaps() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['compliance-maps'],
    queryFn: async (): Promise<ComplianceMaps> => {
      const { data: clients } = await supabase
        .from('clients')
        .select('name, compliance_before_fielding, compliance_after_fielding')
        .or('compliance_before_fielding.eq.true,compliance_after_fielding.eq.true')
      const { data: subs } = await supabase
        .from('question_submissions')
        .select('project_id, phase, status')
        .eq('status', 'approved')
      const clientByFirm = new Map<string, ClientCompliance>()
      for (const c of clients ?? [])
        clientByFirm.set(c.name, {
          compliance_before_fielding: c.compliance_before_fielding,
          compliance_after_fielding: c.compliance_after_fielding,
        })
      const approvedByProject = new Map<string, SubmissionLite[]>()
      for (const s of subs ?? []) {
        const arr = approvedByProject.get(s.project_id) ?? []
        arr.push({ phase: s.phase, status: s.status })
        approvedByProject.set(s.project_id, arr)
      }
      return { clientByFirm, approvedByProject }
    },
    retry: false,
    staleTime: 30_000,
  })
}
