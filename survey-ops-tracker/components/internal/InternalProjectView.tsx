'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useUpdateProject, useDeleteProject, type SurveyProject } from '@/lib/hooks/useProjects'
import { useTeamMembers, assignableMembers } from '@/lib/hooks/useTeamMembers'
import { useSprintConfig } from '@/lib/hooks/useSprintConfig'
import { sprintOptions, sprintStartISO } from '@/lib/utils/sprints'
import { INTERNAL_STAGES, categoryOptions } from '@/lib/utils/internal'
import { LatestNextSteps } from '@/components/project/LatestNextSteps'
import { LinkedDocuments } from '@/components/project/LinkedDocuments'
import { ActivityLog } from '@/components/project/ActivityLog'
import { ProjectAuditLog } from '@/components/project/ProjectAuditLog'
import { InfoTooltip, HelpTip } from '@/components/shared/InfoTooltip'
import { formatDate } from '@/lib/utils/date'

const selectClass =
  'min-w-0 bg-muted border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-ring'

export function InternalProjectView({ project }: { project: SurveyProject }) {
  const router = useRouter()
  const id = project.id
  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()
  const { data: teamMembers = [] } = useTeamMembers()
  const { data: sprintCfg } = useSprintConfig()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [backTo, setBackTo] = useState('/internal')
  useEffect(() => {
    const from = sessionStorage.getItem('sot.cameFrom')
    if (from) setBackTo(from)
  }, [])

  const set = (updates: Record<string, unknown>) => updateProject.mutate({ id, updates })
  const sprintNum = project.sprint_number ?? null
  const PRIORITY_NEXT: Record<string, string> = { none: 'high', high: 'urgent', urgent: 'none' }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <Link href={backTo === '/internal' ? '/internal' : backTo} className="text-muted-foreground hover:text-foreground text-sm transition-colors">
          ← Internal
        </Link>
        <span className="text-muted-foreground/50">/</span>
        <h1 className="text-2xl font-bold text-foreground">{project.project_name}</h1>
        {project.project_code && (
          <span className="text-xs font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">{project.project_code}</span>
        )}
        <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground">Internal</span>
        <span className={`text-xs px-2 py-1 rounded ${
          project.status === 'Open' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
          : project.status === 'Hold' ? 'bg-muted text-muted-foreground'
          : 'bg-red-500/20 text-red-600 dark:text-red-400'}`}>
          {project.status === 'Hold' ? '⏸ On Hold' : project.status}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <HelpTip text="Click to cycle priority: none → high → urgent.">
            <button
              onClick={() => set({ priority: PRIORITY_NEXT[project.priority ?? 'none'] ?? 'high' })}
              className="text-sm px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-ring transition-colors"
            >
              {project.priority === 'high' ? '⚑ High' : project.priority === 'urgent' ? '‼ Urgent' : '⚑ Priority'}
            </button>
          </HelpTip>
          {project.status === 'Open' ? (
            <button onClick={() => set({ status: 'Hold' })} className="text-sm border border-border text-muted-foreground hover:text-foreground hover:border-ring px-3 py-1.5 rounded-lg transition-colors">⏸ Hold</button>
          ) : project.status === 'Hold' ? (
            <button onClick={() => set({ status: 'Open' })} className="text-sm border border-border text-muted-foreground hover:text-foreground hover:border-ring px-3 py-1.5 rounded-lg transition-colors">▶ Resume</button>
          ) : null}
          {project.status !== 'Closed' ? (
            <button onClick={() => set({ status: 'Closed' })} className="text-sm border border-border text-muted-foreground hover:text-foreground hover:border-ring px-3 py-1.5 rounded-lg transition-colors">✕ Archive</button>
          ) : (
            <button onClick={() => set({ status: 'Open' })} className="text-sm border border-border text-muted-foreground hover:text-foreground hover:border-ring px-3 py-1.5 rounded-lg transition-colors">↺ Reopen</button>
          )}
          {confirmingDelete ? (
            <span className="flex items-center gap-1.5">
              <button onClick={async () => { await deleteProject.mutateAsync(id); router.push('/internal') }} className="text-sm bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg transition-colors">Delete</button>
              <button onClick={() => setConfirmingDelete(false)} className="text-sm text-muted-foreground hover:text-foreground px-1">Cancel</button>
            </span>
          ) : (
            <HelpTip text="Moves the project to Admin → Recently Deleted, where it can be restored.">
              <button onClick={() => setConfirmingDelete(true)} className="text-sm border border-border text-muted-foreground hover:text-red-600 dark:hover:text-red-400 hover:border-red-500/50 px-3 py-1.5 rounded-lg transition-colors">🗑 Delete</button>
            </HelpTip>
          )}
        </div>
      </div>

      {/* Objective */}
      <ObjectiveBlock value={project.objective ?? ''} onSave={v => set({ objective: v || null })} />

      {/* Stage progress */}
      <div className="bg-card border border-border shadow-sm rounded-xl p-4 mb-4">
        <h3 className="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium">Stage</h3>
        <div className="flex items-center gap-2 flex-wrap">
          {INTERNAL_STAGES.map(stage => {
            const isCurrent = stage === project.board_column
            return (
              <button
                key={stage}
                onClick={() => set({ board_column: stage })}
                className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                  isCurrent
                    ? 'bg-blue-500/15 border-blue-500/60 text-blue-600 dark:text-blue-400 font-medium'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-ring'}`}
              >
                {stage}
              </button>
            )
          })}
        </div>
      </div>

      {/* Body */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
        <div className="flex flex-col gap-4">
          <LatestNextSteps projectId={id} notes={project.latest_next_steps} />
          <LinkedDocuments projectId={id} documents={project.linked_documents ?? []} />
          <ActivityLog projectId={id} />
          <ProjectAuditLog projectId={id} />
        </div>

        <div className="flex flex-col gap-4">
          <div className="bg-card border border-border shadow-sm rounded-xl p-4">
            <h3 className="text-xs text-muted-foreground uppercase tracking-widest mb-4 font-medium">Details</h3>
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex justify-between items-center gap-2">
                <span className="text-muted-foreground text-xs">Owner</span>
                <select value={project.captain?.id ?? ''} onChange={e => set({ captain_id: e.target.value || null })} className={selectClass}>
                  <option value="">Unassigned</option>
                  {assignableMembers(teamMembers).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-muted-foreground text-xs">Category</span>
                <select value={project.category ?? ''} onChange={e => set({ category: e.target.value || null })} className={selectClass}>
                  <option value="">—</option>
                  {categoryOptions(project.category).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-muted-foreground text-xs flex items-center">Sprint<InfoTooltip text="Picking a sprint sets the start date to that sprint's first day (you can still change it). Manage the cadence in Admin." /></span>
                <select
                  value={sprintNum ?? ''}
                  onChange={e => {
                    const n = e.target.value ? parseInt(e.target.value, 10) : null
                    const updates: Record<string, unknown> = { sprint_number: n }
                    if (n != null && sprintCfg) updates.launch_date = sprintStartISO(n, sprintCfg)
                    set(updates)
                  }}
                  className={selectClass}
                  disabled={!sprintCfg}
                >
                  <option value="">{sprintCfg ? 'No sprint' : 'Set cadence in Admin'}</option>
                  {sprintCfg && sprintOptions(sprintCfg, sprintNum).map(o => <option key={o.number} value={o.number}>{o.label}</option>)}
                </select>
              </div>
              <EditTextRow label="Client" value={project.client} onSave={v => set({ client: v || 'AlphaROC' })} />
              <DateRow label="Start" value={project.launch_date} onSave={v => set({ launch_date: v })} />
              <DateRow label="Due" value={project.due_date} onSave={v => set({ due_date: v })} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ObjectiveBlock({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  return (
    <div className="mb-4 text-sm">
      {editing ? (
        <div className="flex gap-2">
          <input
            autoFocus value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { onSave(draft.trim()); setEditing(false) } if (e.key === 'Escape') setEditing(false) }}
            placeholder="Objective — what & why, in a line"
            className="flex-1 bg-muted border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-ring"
          />
          <button onClick={() => { onSave(draft.trim()); setEditing(false) }} className="text-xs bg-muted hover:bg-accent text-foreground px-2 py-1 rounded transition-colors">Save</button>
        </div>
      ) : (
        <button onClick={() => { setDraft(value); setEditing(true) }} className="text-left text-muted-foreground hover:bg-accent rounded px-1.5 py-0.5 transition-colors cursor-pointer" title="Click to edit">
          <span className="text-muted-foreground/60">Objective — </span>
          {value || <span className="text-muted-foreground/50">add an objective</span>}
        </button>
      )}
    </div>
  )
}

function EditTextRow({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  return (
    <div className="flex justify-between items-center gap-2">
      <span className="text-muted-foreground text-xs shrink-0">{label}</span>
      {editing ? (
        <input
          autoFocus value={draft} onChange={e => setDraft(e.target.value)}
          onBlur={() => { onSave(draft.trim()); setEditing(false) }}
          onKeyDown={e => { if (e.key === 'Enter') { onSave(draft.trim()); setEditing(false) } if (e.key === 'Escape') setEditing(false) }}
          className="min-w-0 bg-muted border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-ring"
        />
      ) : (
        <button onClick={() => { setDraft(value); setEditing(true) }} className="text-sm text-foreground hover:bg-accent rounded px-1.5 transition-colors cursor-pointer truncate" title="Click to edit">{value || '—'}</button>
      )}
    </div>
  )
}

function DateRow({ label, value, onSave }: { label: string; value: string | null; onSave: (v: string | null) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  return (
    <div className="flex justify-between items-center gap-2">
      <span className="text-muted-foreground text-xs shrink-0">{label}</span>
      {editing ? (
        <input
          type="date" autoFocus value={draft} onChange={e => setDraft(e.target.value)}
          onBlur={() => { onSave(draft || null); setEditing(false) }}
          onKeyDown={e => { if (e.key === 'Enter') { onSave(draft || null); setEditing(false) } if (e.key === 'Escape') setEditing(false) }}
          className="min-w-0 bg-muted border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-ring"
        />
      ) : (
        <button onClick={() => { setDraft(value ? value.slice(0, 10) : ''); setEditing(true) }} className="text-sm text-foreground hover:bg-accent rounded px-1.5 transition-colors cursor-pointer" title="Click to edit">{formatDate(value)}</button>
      )}
    </div>
  )
}
