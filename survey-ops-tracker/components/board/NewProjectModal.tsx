'use client'
import { useState } from 'react'
import { useCreateProject } from '@/lib/hooks/useProjects'
import { useRouter } from 'next/navigation'
import { FIELD_LABELS, formatFieldValue, fieldsToUpdates } from '@/lib/utils/quickFields'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import type { TeamMember } from '@/lib/hooks/useTeamMembers'
import type { Database } from '@/lib/supabase/types'

// Fields handled by the visible form inputs; everything else parsed by AI goes into "extras"
const FORM_FIELDS = new Set(['project_name', 'client', 'project_type', 'captain_name', 'salesperson', 'note'])

interface NewProjectModalProps {
  teamMembers: TeamMember[]
  knownClients?: string[]
  onClose: () => void
}

export function NewProjectModal({ teamMembers, knownClients = [], onClose }: NewProjectModalProps) {
  const router = useRouter()
  const createProject = useCreateProject()
  const [name, setName] = useState('')
  const [client, setClient] = useState('')
  const [projectType, setProjectType] = useState<string>('')
  const [captainId, setCaptainId] = useState<string>('')
  const [salesperson, setSalesperson] = useState('')
  const [skipScoping, setSkipScoping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [describe, setDescribe] = useState('')
  const [parsing, setParsing] = useState(false)
  const [extras, setExtras] = useState<Record<string, unknown>>({})

  const canSubmit = name.trim() && client.trim() && !createProject.isPending

  async function parseDescription() {
    if (!describe.trim() || parsing) return
    setParsing(true)
    setError(null)
    try {
      const res = await fetch('/api/parse-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: describe, mode: 'create' }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.fields) {
        setError(body?.error ?? 'Could not read that description. Try rephrasing.')
        return
      }
      const f = body.fields as Record<string, unknown>
      if (typeof f.project_name === 'string') setName(f.project_name)
      if (typeof f.client === 'string') setClient(f.client)
      if (typeof f.project_type === 'string') setProjectType(f.project_type)
      if (typeof f.salesperson === 'string') setSalesperson(f.salesperson)
      if (typeof f.captain_name === 'string') {
        const m = teamMembers.find(
          tm => tm.name.toLowerCase() === String(f.captain_name).toLowerCase()
        )
        if (m) setCaptainId(m.id)
      }
      const extraEntries = Object.entries(f).filter(
        ([k, v]) => !FORM_FIELDS.has(k) && v != null
      )
      setExtras(Object.fromEntries(extraEntries))
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setParsing(false)
    }
  }

  async function handleCreate() {
    if (!canSubmit) return
    setError(null)
    const today = new Date().toISOString().split('T')[0]
    const project: Database['public']['Tables']['survey_projects']['Insert'] = {
      ...(fieldsToUpdates(extras, teamMembers) as Partial<
        Database['public']['Tables']['survey_projects']['Insert']
      >),
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

        {/* AI quick add */}
        <div className="flex flex-col gap-2 bg-muted/50 border border-dashed border-border rounded-xl p-3">
          <span className="text-xs text-muted-foreground flex items-center">
            ✦ Describe it and I&apos;ll fill out the form
            <InfoTooltip text="Describe the project in plain English and AI fills the form for you to review before creating." />
          </span>
          <textarea
            value={describe}
            onChange={e => setDescribe(e.target.value)}
            placeholder={'e.g. "New B2B project for Meridian, Tom sold it, Priya is captain, 200 responses, due July 15, budget 15k"'}
            rows={2}
            className="bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring resize-none"
          />
          <div className="flex justify-end">
            <button
              onClick={parseDescription}
              disabled={parsing || !describe.trim()}
              className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              {parsing ? 'Reading…' : 'Fill form'}
            </button>
          </div>
          {Object.keys(extras).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(extras).map(([k, v]) => (
                <span
                  key={k}
                  className="text-[11px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full"
                >
                  {FIELD_LABELS[k] ?? k}: {formatFieldValue(k, v)}
                </span>
              ))}
            </div>
          )}
        </div>

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
            list="known-clients"
            className={inputClass}
          />
          <datalist id="known-clients">
            {knownClients.map(c => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span className="flex items-center">
              Type
              <InfoTooltip text="PS = PureSpectrum consumer panel, B2B = expert/business panel, Rerun = repeat wave of an earlier study." />
            </span>
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
            <span className="flex items-center">
              Captain
              <InfoTooltip text="The team member responsible for this project end-to-end." />
            </span>
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
          <span className="flex items-center">
            Salesperson
            <InfoTooltip text="The sales lead who sold this project." />
          </span>
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
