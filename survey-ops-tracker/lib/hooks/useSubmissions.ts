import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

export type Submission = Database['public']['Tables']['question_submissions']['Row']
export type Recipient = Database['public']['Tables']['project_recipients']['Row']
export type SubmissionWithSubmitter = Submission & { submitter_name: string | null }

export function useSubmissions(projectId: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['submissions', projectId],
    queryFn: async (): Promise<SubmissionWithSubmitter[]> => {
      const { data, error } = await supabase
        .from('question_submissions')
        .select('*')
        .eq('project_id', projectId)
        .order('version', { ascending: false })
      if (error) throw error

      const submitterIds = [...new Set(data.map(s => s.submitted_by).filter((id): id is string => !!id))]
      const names = new Map<string, string>()
      if (submitterIds.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', submitterIds)
        for (const p of profiles ?? []) names.set(p.id, p.full_name ?? p.email)
      }
      return data.map(s => ({
        ...s,
        submitter_name: s.submitted_by ? names.get(s.submitted_by) ?? null : null,
      }))
    },
  })
}

// Latest submission status per project, for board/list badges
export function useLatestSubmissionStatuses() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['submission-statuses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('question_submissions')
        .select('project_id, version, status')
        .order('version', { ascending: true })
      if (error) throw error
      // Later versions overwrite earlier ones
      const map = new Map<string, Submission['status']>()
      for (const s of data) map.set(s.project_id, s.status)
      return map
    },
  })
}

export function useRecipients(projectId: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['recipients', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_recipients')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at')
      if (error) throw error
      return data
    },
  })
}

export function useInvalidateCompliance(projectId: string) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['submissions', projectId] })
    queryClient.invalidateQueries({ queryKey: ['submission-statuses'] })
    queryClient.invalidateQueries({ queryKey: ['recipients', projectId] })
  }
}
