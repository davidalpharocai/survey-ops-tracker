'use client'
import { useParams, useRouter } from 'next/navigation'
import { useProjects, useUpdateProject } from '@/lib/hooks/useProjects'
import { PipelineProgress } from '@/components/project/PipelineProgress'
import { LatestNextSteps } from '@/components/project/LatestNextSteps'
import { LinkedDocuments } from '@/components/project/LinkedDocuments'
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
}

const TYPE_BADGE: Record<string, string> = {
  'PS': 'bg-blue-500/20 text-blue-400',
  'B2B': 'bg-violet-500/20 text-violet-400',
  'Rerun': 'bg-emerald-500/20 text-emerald-400',
}

export default function ProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const { data: projects = [], isLoading } = useProjects()
  const updateProject = useUpdateProject()

  const project = projects.find(p => p.id === id)

  if (isLoading) {
    return <div className="text-slate-400 text-sm">Loading...</div>
  }
  if (!project) {
    return (
      <div className="text-slate-400 text-sm">
        Project not found.{' '}
        <button onClick={() => router.push('/')} className="text-blue-400 underline">
          Back to board
        </button>
      </div>
    )
  }

  function handleClose() {
    updateProject.mutate({ id, updates: { status: 'Closed' } })
    router.push('/')
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <button
          onClick={() => router.push('/')}
          className="text-slate-400 hover:text-slate-200 text-sm transition-colors"
        >
          ← Board
        </button>
        <span className="text-slate-700">/</span>
        <h1 className="text-xl font-bold text-white">{project.project_name}</h1>
        {project.project_type && (
          <span className={`text-xs px-2 py-1 rounded ${TYPE_BADGE[project.project_type] ?? ''}`}>
            {project.project_type}
          </span>
        )}
        <span
          className={`text-xs px-2 py-1 rounded ${
            project.status === 'Open'
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-red-500/20 text-red-400'
          }`}
        >
          {project.status}
        </span>
        <div className="ml-auto">
          <button
            onClick={handleClose}
            className="text-xs border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 px-3 py-1.5 rounded-lg transition-colors"
          >
            ✕ Close Project
          </button>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
        {/* Left column */}
        <div className="flex flex-col gap-4">
          <div className="bg-slate-900 rounded-xl p-4">
            <h3 className="text-xs text-slate-400 uppercase tracking-widest mb-4 font-medium">
              Pipeline Progress
            </h3>
            <PipelineProgress project={project} />
          </div>
          <LatestNextSteps projectId={project.id} notes={project.latest_next_steps} />
          <LinkedDocuments
            projectId={project.id}
            documents={project.linked_documents ?? []}
          />
        </div>

        {/* Right sidebar */}
        <div className="flex flex-col gap-4">
          <div className="bg-slate-900 rounded-xl p-4">
            <h3 className="text-xs text-slate-400 uppercase tracking-widest mb-4 font-medium">
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
              <DetailRow label="Submitted" value={formatDate(project.submitted_date)} />
              <DetailRow label="Launch Date" value={formatDate(project.launch_date)} />
              <DetailRow
                label="Due Date"
                value={formatDate(project.due_date)}
                valueClass="text-amber-400"
              />
              <DetailRow label="Deliver Date" value={formatDate(project.deliver_date)} />

              <div className="border-t border-slate-800 pt-3 mt-1">
                <DetailRow
                  label="N Target"
                  value={project.n_target?.toString() ?? '—'}
                  tooltip={TOOLTIPS['N Target']}
                />
                <div className="mt-2">
                  <div className="flex justify-between items-center text-sm mb-1">
                    <span className="text-slate-500 flex items-center text-xs">
                      N Collected
                      <InfoTooltip text={TOOLTIPS['N Collected']} />
                    </span>
                    <span className="text-emerald-400 text-xs">{project.n_collected}</span>
                  </div>
                  <NProgressBar
                    collected={project.n_collected}
                    target={project.n_target}
                    showLabel={false}
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

              <div className="border-t border-slate-800 pt-3 mt-1">
                <DetailRow
                  label="Row-Level Data"
                  value={project.row_level_data ? '✓ Yes' : 'No'}
                  valueClass={project.row_level_data ? 'text-emerald-400' : 'text-slate-500'}
                  tooltip={TOOLTIPS['Row-Level Data']}
                />
                <DetailRow
                  label="Terminations"
                  value={project.terminations ? '⚠ Yes' : 'No'}
                  valueClass={project.terminations ? 'text-red-400' : 'text-slate-500'}
                  tooltip={TOOLTIPS['Terminations']}
                />
              </div>

              <BudgetWidget
                projectId={project.id}
                budget={project.budget ?? null}
                actualSpend={project.actual_spend ?? null}
              />
            </div>
          </div>

          <div className="bg-slate-900 rounded-xl p-4 text-xs text-slate-500 leading-relaxed">
            <p className="font-medium text-slate-400 mb-1 text-xs uppercase tracking-widest">
              Notifications
            </p>
            Slack alerts sent to #survey-ops when: stage advances, due date is tomorrow, N target is hit.
          </div>
        </div>
      </div>
    </div>
  )
}

function DetailRow({
  label,
  value,
  tooltip,
  valueClass = 'text-slate-200',
}: {
  label: string
  value: string
  tooltip?: string
  valueClass?: string
}) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-slate-500 flex items-center text-xs">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <span className={`text-xs ${valueClass}`}>{value}</span>
    </div>
  )
}
