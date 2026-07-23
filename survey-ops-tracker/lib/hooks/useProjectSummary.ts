'use client'
import { useQuery } from '@tanstack/react-query'
import type { SummaryFacts } from '@/lib/server/projectSummary'

// Client hook for the ✦ Summary strip — POSTs to the hybrid /api/project-summary
// endpoint (deterministic facts computed server-side, Haiku only phrases the
// prose). `SummaryFacts` is a type-only import so it's erased at compile time
// and never pulls the `server-only`-guarded module into the client bundle.

export interface SummaryNarrative {
  oneLine: string
  status: string
  progress: string
  money: string
  next: string
}

export interface ProjectSummaryResponse {
  narrative: SummaryNarrative
  facts: SummaryFacts
  watchouts: string[]
  generated_at: string
}

async function fetchProjectSummary(projectId: string): Promise<ProjectSummaryResponse> {
  const res = await fetch('/api/project-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Could not generate the summary. Please try again.')
  return json as ProjectSummaryResponse
}

/**
 * Fetch-on-mount + manual regenerate only (pass 1) — does NOT auto-refetch on
 * every field edit. `refetch()` (wired to the strip's ↻ button) is the only
 * way to force a fresh call once the 10-minute staleTime has passed.
 */
export function useProjectSummary(projectId: string) {
  return useQuery({
    queryKey: ['project-summary', projectId],
    queryFn: () => fetchProjectSummary(projectId),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: !!projectId,
  })
}
