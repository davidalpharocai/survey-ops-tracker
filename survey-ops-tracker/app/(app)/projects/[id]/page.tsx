'use client'
import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useProjects, useUpdateProject, useDeleteProject } from '@/lib/hooks/useProjects'
import { useTeamMembers, type TeamMember } from '@/lib/hooks/useTeamMembers'
import { PipelineProgress } from '@/components/project/PipelineProgress'
import { ScopingProgress } from '@/components/project/ScopingProgress'
import { QuickEdit } from '@/components/project/QuickEdit'
import { ActivityLog } from '@/components/project/ActivityLog'
import { DataChangeLog } from '@/components/project/DataChangeLog'
import { LatestNextSteps } from '@/components/project/LatestNextSteps'
import { LinkedDocuments } from '@/components/project/LinkedDocuments'
import { SlackChannel } from '@/components/project/SlackChannel'
import { NProgressBar } from '@/components/shared/NProgressBar'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { formatDate } from '@/lib/utils/date'
import { deriveWaitingOn } from '@/lib/utils/waitingOn'
import { BudgetWidget } from '@/components/project/BudgetWidget'
import { BidWidget } from '@/components/project/BidWidget'

const TOOLTIPS: Record<string, string> = {
  'Client': 'The client this project is for.',
  'N Target': "Total number of survey responses you're aiming to collect.",
  'N Collected': 'Responses collected so far. Auto-synced every 15 minutes — manual edits may be overwritten by the next sync.',
  'Audience Size': 'Total size of the panel or population being surveyed. Different from N (target responses).',
  'Row-Level Data': 'Whether individual respondent-level data is included in the deliverable.',
  'Terminations': 'Whether any survey participants have been terminated (screened out) from the study.',
  'Project Captain': 'The team member responsible for this project end-to-end.',
  'Salesperson': 'The sales lead for this project.',
  'N Actual': 'Final usable response count after cleaning N Collected.',
  'Longitudinal': 'Whether this is a longitudinal study tracked across multiple waves.',
  'Voter Survey QA': 'Voter surveys need an additional QA pass. Auto-set to Yes when the salesperson is Jenna or the project/client mentions "vote". Click to override.',
  'Citation Language': 'Whether deliverables need citation language. Auto-set the same way as Voter Survey QA. Click to override.',
  'Survey IDs': 'IDs of this project\'s surveys, comma separated. Auto-filled from the attached Google Sheet by the scheduled sync; manual edits stick unless the sheet changes.',
  'Submitted': 'Date the project was submitted into the pipeline.',
  'Launch Date': 'Date the survey went (or goes) live in the field.',
  'Due Date': 'Date the deliverable is due to the client.',
  'Deliver Date': 'Date the deliverable was actually sent to the client.',
}

const TYPE_BADGE: Record<string, string> = {
  'PS': 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  'B2B': 'bg-violet-500/20 text-violet-600 dark:text-violet-400',
  'Rerun': 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
}

export default function ProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const { data: projects = [], isLoading } = useProjects()
  const { data: teamMembers = [] } = useTeamMembers()
  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'datalog'>('overview')

  const project = projects.find(p => p.id === id)

  if (isLoading) {
    return <div className="text-muted-foreground text-sm">Loading...</div>
  }
  if (!project) {
    return (
      <div className="text-muted-foreground text-sm">
        Project not found.{' '}
        <button onClick={() => router.push('/')} className="text-blue-600 dark:text-blue-400 underline">
          Back to board
        </button>
      </div>
    )
  }

  function setStatus(status: 'Open' | 'Closed' | 'Hold') {
    updateProject.mutate({ id, updates: { status } })
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <button
          onClick={() => router.push('/')}
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          ← Board
        </button>
        <span className="text-muted-foreground/50">/</span>
        <h1 className="text-xl font-bold text-foreground">{project.project_name}</h1>
        {project.project_type && (
          <span className={`text-xs px-2 py-1 rounded ${TYPE_BADGE[project.project_type] ?? ''}`}>
            {project.project_type}
          </span>
        )}
        <span
          className={`text-xs px-2 py-1 rounded ${
            project.status === 'Open'
              ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
              : project.status === 'Hold'
              ? 'bg-muted text-muted-foreground'
              : 'bg-red-500/20 text-red-600 dark:text-red-400'
          }`}
        >
          {project.status === 'Hold' ? '⏸ On Hold' : project.status}
        </span>
        {project.phase === 'Scoping' && (
          <span className="text-xs px-2 py-1 rounded bg-violet-500/20 text-violet-600 dark:text-violet-400">
            Scoping
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <PriorityButton
            priority={project.priority ?? 'none'}
            onCycle={next => updateProject.mutate({ id, updates: { priority: next } })}
          />
          {project.status === 'Closed' && (
            <span className="text-xs text-muted-foreground">
              Closed projects are hidden from Operations view — switch to Full View to find them.
            </span>
          )}
          {project.status === 'Open' && (
            <button
              onClick={() => setStatus('Hold')}
              title="Pause this project. It stays on the board, greyed out."
              className="text-xs border border-border text-muted-foreground hover:text-foreground hover:border-ring px-3 py-1.5 rounded-lg transition-colors shrink-0"
            >
              ⏸ Hold
            </button>
          )}
          {project.status === 'Hold' && (
            <button
              onClick={() => setStatus('Open')}
              className="text-xs border border-border text-muted-foreground hover:text-foreground hover:border-ring px-3 py-1.5 rounded-lg transition-colors shrink-0"
            >
              ▶ Resume
            </button>
          )}
          {project.status !== 'Closed' ? (
            <button
              onClick={() => setStatus('Closed')}
              title="Marks the project Closed (done/archived). It stays visible in Full View and can be reopened anytime."
              className="text-xs border border-border text-muted-foreground hover:text-foreground hover:border-ring px-3 py-1.5 rounded-lg transition-colors shrink-0"
            >
              ✕ Close Project
            </button>
          ) : (
            <button
              onClick={() => setStatus('Open')}
              className="text-xs border border-border text-muted-foreground hover:text-foreground hover:border-ring px-3 py-1.5 rounded-lg transition-colors shrink-0"
            >
              ↺ Reopen Project
            </button>
          )}
          <button
            onClick={() => setConfirmingDelete(true)}
            title="Permanently delete this project and its activity log."
            className="text-xs border border-border text-muted-foreground hover:text-red-600 dark:hover:text-red-400 hover:border-red-500/50 px-3 py-1.5 rounded-lg transition-colors shrink-0"
          >
            🗑 Delete
          </button>
        </div>
      </div>

      {confirmingDelete && (
        <DeleteProjectModal
          projectName={project.project_name}
          isPending={deleteProject.isPending}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={async () => {
            await deleteProject.mutateAsync(id)
            router.push('/')
          }}
        />
      )}

      {/* Tabs */}
      <div className="flex bg-muted rounded-lg p-1 gap-1 w-fit mb-4">
        <button
          onClick={() => setActiveTab('overview')}
          className={`text-xs px-3 py-1.5 rounded font-medium transition-colors ${
            activeTab === 'overview'
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('datalog')}
          title="Engineer log of manual data changes for this project"
          className={`text-xs px-3 py-1.5 rounded font-medium transition-colors ${
            activeTab === 'datalog'
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Data Change Log
        </button>
      </div>

      {activeTab === 'datalog' && (
        <div className="max-w-3xl">
          <DataChangeLog projectId={project.id} />
        </div>
      )}

      {/* Two-column layout */}
      <div className={activeTab === 'overview' ? 'grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6' : 'hidden'}>
        {/* Left column */}
        <div className="flex flex-col gap-4">
          <div className="flex">
            <QuickEdit project={project} />
          </div>
          <div className="bg-card rounded-xl p-4">
            <h3 className="text-xs text-muted-foreground uppercase tracking-widest mb-4 font-medium">
              {project.phase === 'Scoping' ? 'Scoping Stage' : 'Pipeline Progress'}
            </h3>
            {project.phase === 'Scoping' ? (
              <ScopingProgress project={project} />
            ) : (
              <PipelineProgress project={project} />
            )}
          </div>
          <LatestNextSteps projectId={project.id} notes={project.latest_next_steps} />
          <LinkedDocuments
            projectId={project.id}
            documents={project.linked_documents ?? []}
          />
          <SlackChannel projectId={project.id} url={project.slack_channel_url ?? null} />
          <ActivityLog projectId={project.id} />
        </div>

        {/* Right sidebar */}
        <div className="flex flex-col gap-4">
          <div className="bg-card rounded-xl p-4">
            <h3 className="text-xs text-muted-foreground uppercase tracking-widest mb-4 font-medium">
              Project Details
            </h3>
            <div className="flex flex-col gap-3">
              {/* Basic fields */}
              <DetailRow label="Client" value={project.client} tooltip={TOOLTIPS['Client']} />
              <WaitingOnRow
                project={project}
                onSetBlockedBy={v => updateProject.mutate({ id, updates: { blocked_by: v } })}
              />
              <CaptainRow
                label="Project Captain"
                captain={project.captain}
                teamMembers={teamMembers}
                tooltip={TOOLTIPS['Project Captain']}
                onSave={v => updateProject.mutate({ id, updates: { captain_id: v } })}
              />
              <EditableRow
                label="Salesperson"
                value={project.salesperson ?? ''}
                placeholder="e.g. Jenna Kessler"
                tooltip={TOOLTIPS['Salesperson']}
                onSave={v => updateProject.mutate({ id, updates: { salesperson: v || null } })}
              />
              <EditableDateRow
                label="Submitted"
                value={project.submitted_date}
                tooltip={TOOLTIPS['Submitted']}
                onSave={v => updateProject.mutate({ id, updates: { submitted_date: v } })}
              />
              <EditableDateRow
                label="Launch Date"
                value={project.launch_date}
                tooltip={TOOLTIPS['Launch Date']}
                onSave={v => updateProject.mutate({ id, updates: { launch_date: v } })}
              />
              <EditableDateRow
                label="Due Date"
                value={project.due_date}
                valueClass="text-amber-600 dark:text-amber-400"
                tooltip={TOOLTIPS['Due Date']}
                onSave={v => updateProject.mutate({ id, updates: { due_date: v } })}
              />
              <EditableDateRow
                label="Deliver Date"
                value={project.deliver_date}
                tooltip={TOOLTIPS['Deliver Date']}
                onSave={v => updateProject.mutate({ id, updates: { deliver_date: v } })}
              />

              <div className="border-t border-border pt-3 mt-1">
                <EditableNumberRow
                  label="N Target"
                  value={project.n_target}
                  tooltip={TOOLTIPS['N Target']}
                  onSave={v => updateProject.mutate({ id, updates: { n_target: v } })}
                />
                <div className="mt-2">
                  <EditableNumberRow
                    label="N Collected"
                    value={project.n_collected}
                    valueClass="text-emerald-600 dark:text-emerald-400"
                    tooltip={TOOLTIPS['N Collected']}
                    onSave={v => updateProject.mutate({ id, updates: { n_collected: v ?? 0 } })}
                  />
                  <div className="mt-1">
                    <NProgressBar
                      collected={project.n_collected}
                      target={project.n_target}
                      showLabel={false}
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <EditableNumberRow
                    label="N Actual"
                    value={project.n_actual}
                    tooltip={TOOLTIPS['N Actual']}
                    onSave={v => updateProject.mutate({ id, updates: { n_actual: v } })}
                  />
                </div>
                <div className="mt-3">
                  <EditableNumberRow
                    label="Audience Size"
                    value={project.audience_size}
                    tooltip={TOOLTIPS['Audience Size']}
                    onSave={v => updateProject.mutate({ id, updates: { audience_size: v } })}
                  />
                </div>
              </div>

              <div className="border-t border-border pt-3 mt-1">
                <FlagRow
                  label="Row-Level Data"
                  value={project.row_level_data}
                  tooltip={TOOLTIPS['Row-Level Data']}
                  onToggle={v => updateProject.mutate({ id, updates: { row_level_data: v } })}
                />
                <FlagRow
                  label="Terminations"
                  value={project.terminations}
                  warn
                  tooltip={TOOLTIPS['Terminations']}
                  onToggle={v => updateProject.mutate({ id, updates: { terminations: v } })}
                />
                <FlagRow
                  label="Longitudinal"
                  value={project.longitudinal ?? false}
                  tooltip={TOOLTIPS['Longitudinal']}
                  onToggle={v => updateProject.mutate({ id, updates: { longitudinal: v } })}
                />
                <FlagRow
                  label="Voter Survey QA"
                  value={project.voter_survey_qa ?? false}
                  tooltip={TOOLTIPS['Voter Survey QA']}
                  onToggle={v => updateProject.mutate({ id, updates: { voter_survey_qa: v } })}
                />
                <FlagRow
                  label="Citation Language"
                  value={project.citation_language_needed ?? false}
                  tooltip={TOOLTIPS['Citation Language']}
                  onToggle={v => updateProject.mutate({ id, updates: { citation_language_needed: v } })}
                />
              </div>

              <div className="border-t border-border pt-3 mt-1">
                <EditableRow
                  label="Survey IDs"
                  value={project.survey_tool_id ?? ''}
                  placeholder="e.g. SV-1042, SV-1043"
                  tooltip={TOOLTIPS['Survey IDs']}
                  onSave={v => updateProject.mutate({ id, updates: { survey_tool_id: v || null } })}
                />
                {project.survey_id_discrepancy && (
                  <div className="mt-2 bg-amber-500/10 border border-amber-500/40 rounded-lg p-2 flex flex-col gap-1.5">
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      ⚠ {project.survey_id_discrepancy}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const m = project.survey_id_discrepancy?.match(/"([^"]+)"/)
                          updateProject.mutate({
                            id,
                            updates: {
                              survey_tool_id: m?.[1] ?? project.survey_tool_id,
                              survey_id_discrepancy: null,
                            },
                          })
                        }}
                        className="text-[11px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-700 dark:text-amber-300 px-2 py-1 rounded transition-colors"
                      >
                        Use Edwin ID
                      </button>
                      <button
                        onClick={() =>
                          updateProject.mutate({ id, updates: { survey_id_discrepancy: null } })
                        }
                        className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 transition-colors"
                      >
                        Keep current — dismiss
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <BudgetWidget
                projectId={project.id}
                budget={project.budget ?? null}
                actualSpend={project.actual_spend ?? null}
                nTarget={project.n_target}
                nCollected={project.n_collected}
                nActual={project.n_actual ?? null}
              />

              <BidWidget projectId={project.id} />
            </div>
          </div>

          <div className="bg-card rounded-xl p-4 text-xs text-muted-foreground leading-relaxed">
            <p className="font-medium text-muted-foreground mb-1 text-xs uppercase tracking-widest">
              Notifications
            </p>
            Slack alerts sent to #survey-ops when: stage advances, due date is tomorrow, N target is hit.
          </div>
        </div>
      </div>
    </div>
  )
}

const PRIORITY_NEXT: Record<string, string> = {
  none: 'high',
  high: 'urgent',
  urgent: 'none',
}

function PriorityButton({
  priority,
  onCycle,
}: {
  priority: string
  onCycle: (next: string) => void
}) {
  const next = PRIORITY_NEXT[priority] ?? 'high'
  const title = 'Click to cycle priority: none → high → urgent. High and urgent projects sort to the top of their board column.'
  const base = 'text-xs px-3 py-1.5 rounded-lg transition-colors shrink-0 cursor-pointer'

  if (priority === 'high') {
    return (
      <button onClick={() => onCycle(next)} title={title}
        className={`${base} bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25`}>
        ⚑ High
      </button>
    )
  }
  if (priority === 'urgent') {
    return (
      <button onClick={() => onCycle(next)} title={title}
        className={`${base} bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/25`}>
        ‼ Urgent
      </button>
    )
  }
  return (
    <button onClick={() => onCycle(next)} title={title}
      className={`${base} border border-border text-muted-foreground hover:text-foreground hover:border-ring`}>
      ⚑ Priority
    </button>
  )
}

function WaitingOnRow({
  project,
  onSetBlockedBy,
}: {
  project: Parameters<typeof deriveWaitingOn>[0] & { blocked_by?: string | null }
  onSetBlockedBy: (next: string) => void
}) {
  const derived = deriveWaitingOn(project)
  return (
    <div className="flex justify-between items-center text-sm gap-2">
      <span className="text-muted-foreground flex items-center text-xs shrink-0">
        Waiting On
        <InfoTooltip text="Auto-derived from status, phase, stage checkboxes, and fielding progress. Set the dropdown when the project is blocked to force it to Client or Us." />
      </span>
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className={`text-xs truncate ${
            derived === 'Client'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-foreground/80'
          }`}
        >
          {derived}
        </span>
        <select
          value={project.blocked_by ?? 'none'}
          onChange={e => onSetBlockedBy(e.target.value)}
          className="bg-muted border border-border rounded px-1 py-0.5 text-[11px] text-muted-foreground focus:outline-none focus:border-ring cursor-pointer"
          title="Force the Waiting On value when the project is blocked"
        >
          <option value="none">None</option>
          <option value="client">Blocked — client</option>
          <option value="internal">Blocked — us</option>
        </select>
      </div>
    </div>
  )
}

function EditableRow({
  label,
  value,
  placeholder,
  tooltip,
  onSave,
}: {
  label: string
  value: string
  placeholder?: string
  tooltip?: string
  onSave: (next: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function save() {
    onSave(draft.trim())
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted-foreground flex items-center text-xs">
          {label}
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        <div className="flex gap-1.5">
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={placeholder}
            className="flex-1 min-w-0 bg-muted border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
            onKeyDown={e => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
          <button
            onClick={save}
            className="text-xs bg-muted hover:bg-accent text-foreground px-2 py-1 rounded transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-between items-center text-sm gap-2">
      <span className="text-muted-foreground flex items-center text-xs shrink-0">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <button
        onClick={() => {
          setDraft(value)
          setEditing(true)
        }}
        className="text-xs text-foreground/80 hover:text-foreground truncate cursor-pointer"
        title="Click to edit"
      >
        {value || <span className="text-muted-foreground/50">— click to add</span>}
      </button>
    </div>
  )
}

function FlagRow({
  label,
  value,
  tooltip,
  warn = false,
  onToggle,
}: {
  label: string
  value: boolean
  tooltip?: string
  warn?: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-muted-foreground flex items-center text-xs">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <button
        onClick={() => onToggle(!value)}
        className={`text-xs px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
          value
            ? warn
              ? 'text-red-600 dark:text-red-400 hover:bg-red-500/10'
              : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
            : 'text-muted-foreground hover:bg-accent'
        }`}
        title="Click to toggle"
      >
        {value ? (warn ? '⚠ Yes' : '✓ Yes') : 'No'}
      </button>
    </div>
  )
}

function DetailRow({
  label,
  value,
  tooltip,
  valueClass = 'text-foreground',
}: {
  label: string
  value: string
  tooltip?: string
  valueClass?: string
}) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-muted-foreground flex items-center text-xs">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <span className={`text-xs ${valueClass}`}>{value}</span>
    </div>
  )
}

function EditableNumberRow({
  label,
  value,
  tooltip,
  valueClass = 'text-foreground/80 hover:text-foreground',
  onSave,
}: {
  label: string
  value: number | null
  tooltip?: string
  valueClass?: string
  onSave: (next: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function save() {
    const parsed = parseInt(draft, 10)
    onSave(isNaN(parsed) ? null : parsed)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex justify-between items-center text-sm gap-2">
        <span className="text-muted-foreground flex items-center text-xs shrink-0">
          {label}
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        <div className="flex gap-1.5">
          <input
            autoFocus
            type="number"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="w-20 bg-muted border border-border rounded px-2 py-1 text-xs text-foreground text-right focus:outline-none focus:border-ring"
            onKeyDown={e => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
          <button
            onClick={save}
            className="text-xs bg-muted hover:bg-accent text-foreground px-2 py-1 rounded transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-between items-center text-sm gap-2">
      <span className="text-muted-foreground flex items-center text-xs shrink-0">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <button
        onClick={() => {
          setDraft(value != null ? String(value) : '')
          setEditing(true)
        }}
        className={`text-xs cursor-pointer ${valueClass}`}
        title="Click to edit"
      >
        {value != null ? value.toString() : <span className="text-muted-foreground/50">—</span>}
      </button>
    </div>
  )
}

function EditableDateRow({
  label,
  value,
  tooltip,
  valueClass = 'text-foreground/80 hover:text-foreground',
  onSave,
}: {
  label: string
  value: string | null
  tooltip?: string
  valueClass?: string
  onSave: (next: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function save() {
    onSave(draft || null)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex justify-between items-center text-sm gap-2">
        <span className="text-muted-foreground flex items-center text-xs shrink-0">
          {label}
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        <div className="flex gap-1.5">
          <input
            autoFocus
            type="date"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-ring"
            onKeyDown={e => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
          <button
            onClick={save}
            className="text-xs bg-muted hover:bg-accent text-foreground px-2 py-1 rounded transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-between items-center text-sm gap-2">
      <span className="text-muted-foreground flex items-center text-xs shrink-0">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <button
        onClick={() => {
          setDraft(value ? value.slice(0, 10) : '')
          setEditing(true)
        }}
        className={`text-xs cursor-pointer ${valueClass}`}
        title="Click to edit"
      >
        {formatDate(value)}
      </button>
    </div>
  )
}

function CaptainRow({
  label,
  captain,
  teamMembers,
  tooltip,
  onSave,
}: {
  label: string
  captain: { id: string; name: string; initials: string } | null
  teamMembers: TeamMember[]
  tooltip?: string
  onSave: (next: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function save() {
    onSave(draft || null)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex justify-between items-center text-sm gap-2">
        <span className="text-muted-foreground flex items-center text-xs shrink-0">
          {label}
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        <div className="flex gap-1.5 min-w-0">
          <select
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="min-w-0 bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-ring"
            onKeyDown={e => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') setEditing(false)
            }}
          >
            <option value="">— Unassigned</option>
            {teamMembers.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button
            onClick={save}
            className="text-xs bg-muted hover:bg-accent text-foreground px-2 py-1 rounded transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-between items-center text-sm gap-2">
      <span className="text-muted-foreground flex items-center text-xs shrink-0">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <button
        onClick={() => {
          setDraft(captain?.id ?? '')
          setEditing(true)
        }}
        className="text-xs text-foreground/80 hover:text-foreground cursor-pointer"
        title={captain ? `${captain.name} — click to change` : 'Click to assign'}
      >
        {captain?.initials ?? <span className="text-muted-foreground/50">—</span>}
      </button>
    </div>
  )
}

function DeleteProjectModal({
  projectName,
  isPending,
  onCancel,
  onConfirm,
}: {
  projectName: string
  isPending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const [confirmText, setConfirmText] = useState('')
  const canDelete = confirmText === 'delete' && !isPending

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-card border border-border rounded-2xl p-5 w-full max-w-md flex flex-col gap-3 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-foreground">Delete project</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          This permanently deletes <span className="text-foreground font-medium">{projectName}</span> and
          its activity log. This cannot be undone. If you just want it off the board, use Close Project
          instead.
        </p>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Type <span className="font-mono text-foreground">delete</span> to confirm
          <input
            autoFocus
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            placeholder="delete"
            className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-colors"
            onKeyDown={e => {
              if (e.key === 'Enter' && canDelete) onConfirm()
              if (e.key === 'Escape') onCancel()
            }}
          />
        </label>
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={onCancel}
            className="text-xs text-muted-foreground hover:text-foreground px-3 py-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!canDelete}
            className="text-xs bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors"
          >
            {isPending ? 'Deleting…' : 'Permanently delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
