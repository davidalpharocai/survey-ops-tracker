'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

/** Mirrors the matcher's EmailCandidate (stored as jsonb on email_inbox.match_candidates). */
export type EmailCandidate = {
  clientId: string | null
  projectId: string | null
  confidence: number
  reason: string
  method: string
}

export type EmailQueueRow = {
  id: string
  external_id: string
  status: 'review' | 'pending_no_project'
  direction: string | null
  from_email: string | null
  to_emails: string[] | null
  subject: string | null
  snippet: string | null
  body: string | null
  occurred_at: string
  gmail_message_id: string | null
  match_candidates: EmailCandidate[] | null
  client_id: string | null
  project_id: string | null
}

export function useEmailReviewQueue() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['email-review-queue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_inbox')
        .select(
          'id, external_id, status, direction, from_email, to_emails, subject, snippet, body, occurred_at, gmail_message_id, match_candidates, client_id, project_id'
        )
        .in('status', ['review', 'pending_no_project'])
        .order('occurred_at', { ascending: false })
      if (error) throw error
      return data as unknown as EmailQueueRow[]
    },
  })
}

export function useFileEmail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, projectId }: { id: string; projectId: string }) => {
      const res = await fetch(`/api/email-review/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'File failed')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-review-queue'] }),
  })
}

export function useIgnoreEmail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const res = await fetch(`/api/email-review/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ignore: true }),
      })
      if (!res.ok) throw new Error('Ignore failed')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-review-queue'] }),
  })
}
