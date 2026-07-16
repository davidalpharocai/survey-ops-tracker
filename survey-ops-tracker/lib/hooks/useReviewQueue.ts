'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { LabeledCandidate } from '@/lib/deliverables/confidence'

export type QueueRow = {
  id: string
  file_name: string | null
  original_file_name: string | null
  kind: 'file' | 'link'
  status: 'review' | 'unsorted'
  source_url: string | null
  drive_file_id: string | null
  email_subject: string | null
  email_from: string | null
  gmail_message_id: string | null
  created_at: string
  match_candidates: LabeledCandidate[] | null
  client_id: string | null
  project_id: string | null
}

export type ProjectOption = { id: string; label: string }

export function useReviewQueue() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['deliverables-queue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deliverables')
        .select('id, file_name, original_file_name, kind, status, source_url, drive_file_id, email_subject, email_from, gmail_message_id, created_at, match_candidates, client_id, project_id')
        .in('status', ['review', 'unsorted'])
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as unknown as QueueRow[]
    },
  })
}

export function useProjectOptions() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['project-options'],
    queryFn: async (): Promise<ProjectOption[]> => {
      const [{ data: projects, error: pErr }, { data: clients, error: cErr }] = await Promise.all([
        supabase.from('survey_projects').select('id, project_code, project_name, client_id').is('deleted_at', null).not('project_code', 'is', null).order('project_name'),
        supabase.from('clients').select('id, name'),
      ])
      if (pErr) throw pErr
      if (cErr) throw cErr
      const clientName = new Map((clients ?? []).map((c) => [c.id, c.name]))
      return (projects ?? []).map((p) => ({
        id: p.id,
        label: `${p.client_id ? clientName.get(p.client_id) ?? '—' : '—'} — ${p.project_name} (${p.project_code})`,
      }))
    },
  })
}

export function useResolveDeliverable() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, projectId }: { id: string; projectId: string }) => {
      const res = await fetch(`/api/deliverables/${id}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Resolve failed')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deliverables-queue'] }),
  })
}

export function useDismissDeliverable() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const res = await fetch(`/api/deliverables/${id}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dismiss: true }) })
      if (!res.ok) throw new Error('Dismiss failed')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deliverables-queue'] }),
  })
}
