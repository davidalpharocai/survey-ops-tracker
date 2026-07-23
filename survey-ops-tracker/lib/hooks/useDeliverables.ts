'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

export type DeliverableRow = {
  id: string
  file_name: string | null
  original_file_name: string | null
  display_name: string | null
  kind: 'file' | 'link'
  status: string
  source: 'email' | 'upload'
  drive_file_id: string | null
  source_url: string | null
  filed_at: string | null
}

export function useDeliverables(projectId: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['deliverables', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deliverables')
        .select('id, file_name, original_file_name, display_name, kind, status, source, drive_file_id, source_url, filed_at')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('filed_at', { ascending: false })
      if (error) throw error
      return data as DeliverableRow[]
    },
  })
}

export function useUploadDeliverable(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { file?: File; link?: string }) => {
      const form = new FormData()
      form.append('projectId', projectId)
      if (payload.file) form.append('file', payload.file)
      if (payload.link) form.append('link', payload.link)
      const res = await fetch('/api/deliverables/upload', { method: 'POST', body: form })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Upload failed')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deliverables', projectId] }),
  })
}

export function useRenameDeliverable(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, displayName }: { id: string; displayName: string }) => {
      const res = await fetch(`/api/deliverables/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Rename failed')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deliverables', projectId] }),
  })
}

export function useRemoveDeliverable(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/deliverables/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Remove failed')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deliverables', projectId] }),
  })
}
