import { useMutation, useQueryClient } from '@tanstack/react-query'

export interface CloneCarry {
  people?: boolean
  audienceN?: boolean
  flags?: boolean
  suppliers?: boolean
  budget?: boolean
}

export interface ClonedProject {
  id: string
  project_code: string | null
  project_name: string
  cloned_from: string | null
}

/** Clone a project via the analyst-gated /api/projects/clone route. */
export function useCloneProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { sourceId: string; newName: string; carry: CloneCarry }): Promise<ClonedProject> => {
      const res = await fetch('/api/projects/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(v),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not clone the project. Please try again.')
      return json.project as ClonedProject
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}
