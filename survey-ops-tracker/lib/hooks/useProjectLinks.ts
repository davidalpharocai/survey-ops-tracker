'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LinkedSurvey } from '@/lib/projects/links'

// Related surveys (migration 126) — a symmetric link between two surveys that
// is NOT a rerun wave. Reads go through the API route rather than PostgREST
// directly, because the list needs the survey at the OTHER end of each link and
// which end that is depends on the row.

export type { LinkedSurvey }

async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/projects/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Could not update the link. Please try again.')
  return json
}

export function useProjectLinks(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ['project-links', projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<LinkedSurvey[]> => {
      const res = await fetch(`/api/projects/links?projectId=${encodeURIComponent(projectId as string)}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not load related surveys.')
      return (json.links ?? []) as LinkedSurvey[]
    },
    staleTime: 30_000,
  })
}

export function useLinkSurvey(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { otherId: string; note?: string | null }) =>
      post({ projectId, otherId: v.otherId, note: v.note ?? null }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['project-links', projectId] })
      // The link is symmetric, so the OTHER survey's list changed too. Invalidate
      // it by name rather than relying on a later refetch — somebody following
      // the link straight there would otherwise not see it.
      qc.invalidateQueries({ queryKey: ['project-links', v.otherId] })
    },
  })
}

export function useUnlinkSurvey(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { linkId: string; otherId: string }) => post({ action: 'remove', linkId: v.linkId }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['project-links', projectId] })
      qc.invalidateQueries({ queryKey: ['project-links', v.otherId] })
    },
  })
}
