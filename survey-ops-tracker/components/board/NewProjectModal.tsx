'use client'
import { useState } from 'react'
import { useCreateProject } from '@/lib/hooks/useProjects'
import { useRouter } from 'next/navigation'
import type { TeamMember } from '@/lib/hooks/useTeamMembers'
import type { Database } from '@/lib/supabase/types'

interface NewProjectModalProps {
  teamMembers: TeamMember[]
  onClose: () => void
}

export function NewProjectModal({ teamMembers, onClose }: NewProjectModalProps) {
  const router = useRouter()
  const createProject = useCreateProject()
  const [name, setName] = useState('')
  const [client, setClient] = useState('')
  const [projectType, setProjectType] = useState<string>('')
  const [captainId, setCaptainId] = useState<string>('')
  const [salesperson, setSalesperson] = useState('')
  const [skipScoping, setSkipScoping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = name.trim() && client.trim() && !createProject.isPending

  async function handleCreate() {
    if (!canSubmit) return
    setError(null)
    const today = new Date().toISOString().split('T')[0]
    const project: Database['public']['Tables']['survey_projects']['Insert'] = {
      project_name: name.trim(),
      client: client.trim(),
      project_type: (projectType || null) as Database['public']['Enums']['project_type'] | null,
      captain_id: captainId || null,
      salesperson: salesperson.trim() || null,
      ...(skipScoping
        ? { phase: 'Active' as const, board_column: 'Submitted' as const, submitted_date: today }
        : { phase: 'Scoping' as const, scoping_stage: 'New Inquiry' as const }),
    }
    try {
      const created = await createProject.mutateAsync(project)
      onClose()
      router.push(`/projects/${created.id}`)
    } catch {
      setError('Could not create the project. Please try again.')
    }
  }

  const inputClass =
    'bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-colors'

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl p-5 w-full max-w-md flex flex-col gap-3 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-foreground">New Project</h2>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Project name *
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Cloud Spend Pulse Q3"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Client *
          <input
            value={client}
            onChange={e => setClient(e.target.value)}
            placeholder="e.g. Meridian Capital"
            className={inputClass}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Type
            <select
              value={projectType}
              onChange={e => setProjectType(e.target.value)}
              className={inputClass}
            >
              <option value="">—</option>
              <option value="PS">PS</option>
              <option value="B2B">B2B</option>
              <option value="Rerun">Rerun</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Captain
            <select
              value={captainId}
              onChange={e => setCaptainId(e.target.value)}
              className={inputClass}
            >
              <option value="">—</option>
              {teamMembers.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Salesperson
          <input
            value={salesperson}
            onChange={e => setSalesperson(e.target.value)}
            placeholder="e.g. Jenna Kessler"
            className={inputClass}
          />
        </label>

        <label className="flex items-center gap-2 text-xs text-muted-foreground mt-1 cursor-pointer">
          <input
            type="checkbox"
            checked={skipScoping}
            onChange={e => setSkipScoping(e.target.checked)}
            className="accent-blue-600"
          />
          Already approved — skip scoping and add straight to the pipeline
        </label>

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground px-3 py-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!canSubmit}
            className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors"
          >
            {createProject.isPending
              ? 'Creating…'
              : skipScoping
              ? 'Create in pipeline'
              : 'Create inquiry'}
          </button>
        </div>
      </div>
    </div>
  )
}
