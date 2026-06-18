'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCreateProject } from '@/lib/hooks/useProjects'
import { assignableMembers, type TeamMember } from '@/lib/hooks/useTeamMembers'
import { useSprintConfig } from '@/lib/hooks/useSprintConfig'
import { sprintOptions, sprintStartISO, currentSprintNumber } from '@/lib/utils/sprints'
import { INTERNAL_CATEGORIES, INTERNAL_DEFAULT_CLIENT } from '@/lib/utils/internal'

const inputClass =
  'bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring'

export function NewInternalProjectModal({
  teamMembers,
  onClose,
}: {
  teamMembers: TeamMember[]
  onClose: () => void
}) {
  const router = useRouter()
  const createProject = useCreateProject()
  const { data: sprintCfg } = useSprintConfig()
  const [name, setName] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [category, setCategory] = useState('')
  const [objective, setObjective] = useState('')
  const [sprint, setSprint] = useState<string>(sprintCfg ? String(currentSprintNumber(sprintCfg)) : '')
  const [error, setError] = useState<string | null>(null)

  const sprintOpts = sprintCfg ? sprintOptions(sprintCfg) : []

  async function save() {
    if (!name.trim()) {
      setError('Give the project a name.')
      return
    }
    const sprintNum = sprint ? parseInt(sprint, 10) : null
    try {
      const created = await createProject.mutateAsync({
        project_name: name.trim(),
        project_type: 'Internal',
        client: INTERNAL_DEFAULT_CLIENT,
        phase: 'Active',
        board_column: 'Backlog',
        status: 'Open',
        captain_id: ownerId || null,
        category: category || null,
        objective: objective.trim() || null,
        sprint_number: sprintNum,
        // inherit the sprint's start as the project start (overridable later)
        launch_date: sprintNum != null && sprintCfg ? sprintStartISO(sprintNum, sprintCfg) : null,
      })
      router.push(`/projects/${created.id}`)
    } catch {
      setError('Could not create the project — please try again.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl p-5 w-full max-w-md flex flex-col gap-3 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-foreground">New internal project</h2>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Name
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Internal AI QA tooling" className={inputClass} />
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Objective <span className="text-muted-foreground/60">(optional)</span>
          <input value={objective} onChange={e => setObjective(e.target.value)} placeholder="What & why, in a line" className={inputClass} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Owner
            <select value={ownerId} onChange={e => setOwnerId(e.target.value)} className={inputClass}>
              <option value="">Unassigned</option>
              {assignableMembers(teamMembers).map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Category
            <select value={category} onChange={e => setCategory(e.target.value)} className={inputClass}>
              <option value="">—</option>
              {INTERNAL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Sprint
          <select value={sprint} onChange={e => setSprint(e.target.value)} className={inputClass} disabled={!sprintCfg}>
            <option value="">{sprintCfg ? 'No sprint' : 'Set the sprint cadence in Admin first'}</option>
            {sprintOpts.map(o => <option key={o.number} value={o.number}>{o.label}</option>)}
          </select>
        </label>

        <p className="text-xs text-muted-foreground/60">Client defaults to {INTERNAL_DEFAULT_CLIENT} (editable on the project).</p>

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 mt-1">
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground px-3 py-2 transition-colors">Cancel</button>
          <button
            onClick={save}
            disabled={createProject.isPending}
            className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg transition-colors"
          >
            {createProject.isPending ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  )
}
