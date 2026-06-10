'use client'
import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useProjects, useUpdateProject } from '@/lib/hooks/useProjects'
import { PipelineProgress } from '@/components/project/PipelineProgress'
import { ScopingProgress } from '@/components/project/ScopingProgress'
import { QuickEdit } from '@/components/project/QuickEdit'
import { LatestNextSteps } from '@/components/project/LatestNextSteps'
import { LinkedDocuments } from '@/components/project/LinkedDocuments'
import { SlackChannel } from '@/components/project/SlackChannel'
import { NProgressBar } from '@/components/shared/NProgressBar'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { formatDate } from '@/lib/utils/date'
import { BudgetWidget } from '@/components/project/BudgetWidget'

const TOOLTIPS: Record<string, string> = {
  'N Target': "Total number of survey responses you're aiming to collect.",
  'N Collected': 'Responses collected so far. Auto-synced every 15 minutes — do not edit manually.',
  'Audience Size': 'Total size of the panel or population being surveyed. Different from N (target responses).',
  'Row-Level Data': 'Whether individual respondent-level data is included in the deliverable.',
  'Terminations': 'Whether any survey participants have been terminated (screened out) from the study.',
  'Project Captain': 'The team member responsible for this project end-to-end.',
  'Salesperson': 'The sales lead for this project.',
  'N Actual': 'Final usable response count after cleaning N Collected.',
  'Longitudinal': 'Whether this is a longitudinal study tracked across multiple waves.',
  'Voter Survey QA': 'Voter surveys need an additional QA pass. Auto-set to Yes when the salesperson is Jenna or the project/client mentions "vote". Click to override.',
  'Citation Language': 'Whether deliverables need citation language. Auto-set the same way as Voter Survey QA. Click to override.',
  'Survey IDs': 'IDs of this project\'s surveys in the survey tool, comma separated. Used to sync N Collected.',
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
  const updateProject = useUpdateProject()

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

  function toggleClosed() {
    updateProject.mutate({
      id,
      updates: { status: project!.status === 'Open' ? 'Closed' : 'Open' },
    })
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
              : 'bg-red-500/20 text-red-600 dark:text-red-400'
          }`}
        >
          {project.status}
        </span>
        {project.phase === 'Scoping' && (
          <span className="text-xs px-2 py-1 rounded bg-violet-500/20 text-violet-600 dark:text-violet-400">
            Scoping
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {project.status === 'Closed' && (
            <span className="text-xs text-muted-foreground">
              Closed projects are hidden from Operations view — switch to Full View to find them.
            </span>
          )}
          <button
            onClick={toggleClosed}
            title={
              project.status === 'Open'
                ? 'Marks the project Closed (done/archived). It stays visible in Full View and can be reopened anytime.'
                : 'Reopen this project'
            }
            className="text-xs border border-border text-muted-foreground hover:text-foreground hover:border-ring px-3 py-1.5 rounded-lg transition-colors shrink-0"
          >
            {project.status === 'Open' ? '✕ Close Project' : '↺ Reopen Project'}
          </button>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
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
        </div>

        {/* Right sidebar */}
        <div className="flex flex-col gap-4">
          <div className="bg-card rounded-xl p-4">
            <h3 className="text-xs text-muted-foreground uppercase tracking-widest mb-4 font-medium">
              Project Details
            </h3>
            <div className="flex flex-col gap-3">
              {/* Basic fields */}
              <DetailRow label="Client" value={project.client} />
              <DetailRow
                label="Project Captain"
                value={project.captain?.initials ?? '—'}
                tooltip={TOOLTIPS['Project Captain']}
              />
              <DetailRow
                label="Salesperson"
                value={project.salesperson ?? '—'}
                tooltip={TOOLTIPS['Salesperson']}
              />
              <DetailRow label="Submitted" value={formatDate(project.submitted_date)} />
              <DetailRow label="Launch Date" value={formatDate(project.launch_date)} />
              <DetailRow
                label="Due Date"
                value={formatDate(project.due_date)}
                valueClass="text-amber-600 dark:text-amber-400"
              />
              <DetailRow label="Deliver Date" value={formatDate(project.deliver_date)} />

              <div className="border-t border-border pt-3 mt-1">
                <DetailRow
                  label="N Target"
                  value={project.n_target?.toString() ?? '—'}
                  tooltip={TOOLTIPS['N Target']}
                />
                <div className="mt-2">
                  <div className="flex justify-between items-center text-sm mb-1">
                    <span className="text-muted-foreground flex items-center text-xs">
                      N Collected
                      <InfoTooltip text={TOOLTIPS['N Collected']} />
                    </span>
                    <span className="text-emerald-600 dark:text-emerald-400 text-xs">{project.n_collected}</span>
                  </div>
                  <NProgressBar
                    collected={project.n_collected}
                    target={project.n_target}
                    showLabel={false}
                  />
                </div>
                <div className="mt-3">
                  <DetailRow
                    label="N Actual"
                    value={project.n_actual?.toString() ?? '—'}
                    tooltip={TOOLTIPS['N Actual']}
                  />
                </div>
                <div className="mt-3">
                  <DetailRow
                    label="Audience Size"
                    value={project.audience_size?.toString() ?? '—'}
                    tooltip={TOOLTIPS['Audience Size']}
                  />
                </div>
              </div>

              <div className="border-t border-border pt-3 mt-1">
                <DetailRow
                  label="Row-Level Data"
                  value={project.row_level_data ? '✓ Yes' : 'No'}
                  valueClass={project.row_level_data ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}
                  tooltip={TOOLTIPS['Row-Level Data']}
                />
                <DetailRow
                  label="Terminations"
                  value={project.terminations ? '⚠ Yes' : 'No'}
                  valueClass={project.terminations ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}
                  tooltip={TOOLTIPS['Terminations']}
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
              </div>

              <BudgetWidget
                projectId={project.id}
                budget={project.budget ?? null}
                actualSpend={project.actual_spend ?? null}
                nTarget={project.n_target}
                nCollected={project.n_collected}
                nActual={project.n_actual ?? null}
              />
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
  onToggle,
}: {
  label: string
  value: boolean
  tooltip?: string
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
            ? 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
            : 'text-muted-foreground hover:bg-accent'
        }`}
        title="Click to toggle"
      >
        {value ? '✓ Yes' : 'No'}
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
