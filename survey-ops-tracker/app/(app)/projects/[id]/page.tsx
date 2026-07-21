'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useProject, useUpdateProject, useDeleteProject, type SurveyProject } from '@/lib/hooks/useProjects'
import { useTeamMembers, assignableMembers, type TeamMember } from '@/lib/hooks/useTeamMembers'
import { PipelineProgress } from '@/components/project/PipelineProgress'
import { WaveHistory } from '@/components/project/WaveHistory'
import { CloneProjectModal } from '@/components/project/CloneProjectModal'
import { GenPopNWarning } from '@/components/project/GenPopNWarning'
import { ScopingProgress } from '@/components/project/ScopingProgress'
import { ActivityLog } from '@/components/project/ActivityLog'
import { DataChangeLog } from '@/components/project/DataChangeLog'
import { ProjectAuditLog } from '@/components/project/ProjectAuditLog'
import { InternalProjectView } from '@/components/internal/InternalProjectView'
import { LatestNextSteps } from '@/components/project/LatestNextSteps'
import { LinkedDocuments } from '@/components/project/LinkedDocuments'
import { SlackChannel } from '@/components/project/SlackChannel'
import { NProgressBar } from '@/components/shared/NProgressBar'
import { InfoTooltip, HelpTip } from '@/components/shared/InfoTooltip'
import { Skeleton } from '@/components/shared/Skeleton'
import { formatDate, getDueUrgency } from '@/lib/utils/date'
import { differenceInCalendarDays, parseISO, startOfDay } from 'date-fns'
import { deriveWaitingOn } from '@/lib/utils/waitingOn'
import { BudgetWidget } from '@/components/project/BudgetWidget'
import { SuppliersWidget } from '@/components/project/SuppliersWidget'
import { ProjectInsights } from '@/components/project/ProjectInsights'
import { BlastConfigWidget } from '@/components/project/BlastConfigWidget'
import { CompliancePanel } from '@/components/compliance/CompliancePanel'
import { ComplianceBanner } from '@/components/project/ComplianceBanner'
import { useComplianceState } from '@/lib/hooks/useComplianceState'
import { beforeFieldingRequired, afterFieldingRequired } from '@/lib/utils/compliance'
import { SegmentedNTile } from '@/components/project/SegmentedNTile'
import { RequestedByRow } from '@/components/project/RequestedByRow'
import { ordinal } from '@/lib/utils/rerun'
import { DeliverablesPanel } from '@/components/deliverables/DeliverablesPanel'
import { salespersonOptions } from '@/lib/utils/salespeople'
import { MergeButton } from '@/components/merge/MergeButton'
import { fmtNum } from '@/lib/utils/number'

const TOOLTIPS: Record<string, string> = {
  'Client': 'The client this project is for.',
  'N Target': "Total number of survey responses you're aiming to collect.",
  'N Collected': 'Responses collected so far. Auto-synced every 15 minutes — manual edits may be overwritten by the next sync.',
  'Audience Size': 'Total size of the panel or population being surveyed. Different from N (target responses).',
  'Audience': 'Who the survey is fielded to — the target respondent profile (free text, e.g. "US adults 18+, likely voters").',
  'N Internal Target': 'Your internal collection goal — usually a cushion above N Target to cover cleaning and terminations.',
  'Row-Level Data': 'Whether individual respondent-level data is included in the deliverable.',
  'Terminations': 'Whether any survey participants have been terminated (screened out) from the study.',
  'Project Captain': 'The team member responsible for this project end-to-end. Add co-captains below when a project is shared.',
  'Co-Captains': 'Additional captains sharing this project. Most projects have none — the main captain stays the primary owner.',
  'Salesperson': 'The sales lead for this project.',
  'Requested by': "The client contact who requested this survey. Pick from this client's people or add a new one; click the name to view or edit their details.",
  'N Actual': 'Final usable response count after cleaning N Collected.',
  'Longitudinal': 'Whether this is a longitudinal study tracked across multiple waves.',
  'Voter Survey QA': 'Voter surveys need an additional QA pass. Auto-set to Yes when the salesperson is Jenna or the project/client mentions "vote". Click to override.',
  'Citation Language': 'Whether deliverables need citation language. Auto-set the same way as Voter Survey QA. Click to override.',
  'Survey IDs': 'IDs of this project\'s surveys, comma separated. Auto-filled from the attached Google Sheet by the scheduled sync; manual edits stick unless the sheet changes.',
  'Submitted': 'Date the project was submitted into the pipeline.',
  'Launch Date': 'Date the survey went (or goes) live in the field.',
  'Due Date': 'Internal deadline — when everything needs to be finished on our side.',
  'Deliver Date': 'Client-facing deadline — when the client needs the project in hand. Often the same day as the internal due date.',
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
  const { data: project, isLoading } = useProject(id)
  const { data: teamMembers = [] } = useTeamMembers()
  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'insights' | 'activity' | 'deliverables' | 'links' | 'logs'>('overview')
  // Where to return on "← Back": the board or list, whichever the user came from
  const [backTo, setBackTo] = useState<{ href: string; label: string }>({ href: '/', label: 'Board' })
  useEffect(() => {
    const from = sessionStorage.getItem('sot.cameFrom')
    if (from === '/list') setBackTo({ href: '/list', label: 'List' })
    else setBackTo({ href: '/', label: 'Board' })
  }, [])
  const queryClient = useQueryClient()
  const projectLoaded = !!project

  // Compliance card is conditional: show it only when the client actually
  // requires a review (before/after fielding) or a submission already exists —
  // otherwise it's just clutter on the majority of projects. In-flight or
  // historical reviews keep it visible even if the client flag is later toggled.
  const compliance = useComplianceState(
    project?.id ?? '',
    project?.client ?? '',
    project?.compliance_override ?? null,
  )
  const showCompliance =
    !!compliance.data &&
    (beforeFieldingRequired(compliance.data.client, compliance.data.override) ||
      afterFieldingRequired(compliance.data.client, compliance.data.override) ||
      compliance.data.submissions.length > 0)

  // Mark the project as seen by the current user on every visit — this is
  // what dismisses the green NEW! badge on the board. Errors are swallowed
  // on purpose: a missing project_seen table must never break the page.
  useEffect(() => {
    if (!projectLoaded || !id) return
    let cancelled = false
    const supabase = createClient()
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        const email = user?.email
        if (!email || cancelled) return
        const { error } = await supabase.from('project_seen').upsert(
          { project_id: id, user_email: email, seen_at: new Date().toISOString() },
          { onConflict: 'project_id,user_email' }
        )
        if (!error && !cancelled) {
          queryClient.invalidateQueries({ queryKey: ['seen', email] })
        }
      } catch {
        // ignore — seen tracking is best-effort
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, projectLoaded, queryClient])

  if (isLoading) {
    // Skeleton mirrors the real layout: header row, tab pills, hero stat
    // strip, then the two-column body — so nothing jumps when data lands
    return (
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-6 w-14 rounded" />
        </div>
        <Skeleton className="h-9 w-72 rounded-lg mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card border border-border shadow-sm rounded-xl p-3 flex flex-col gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <div className="flex flex-col gap-4">
            {['h-28', 'h-40', 'h-36'].map((h, i) => (
              <div key={i} className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col gap-3">
                <Skeleton className="h-3 w-32" />
                <Skeleton className={`w-full ${h}`} />
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col gap-3">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
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

  // Internal projects use a dedicated, stripped-down view (no survey fields).
  if (project.project_type === 'Internal') {
    return <InternalProjectView project={project} />
  }

  function setStatus(status: 'Open' | 'Closed' | 'Hold') {
    updateProject.mutate({ id, updates: { status } })
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <button
          onClick={() => router.push(backTo.href)}
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          title={`Back to the ${backTo.label.toLowerCase()}`}
        >
          ← {backTo.label}
        </button>
        <span className="text-muted-foreground/50">/</span>
        <EditableTitle value={project.project_name} onSave={v => updateProject.mutate({ id, updates: { project_name: v } })} />
        {project.project_code && (
          <span
            className="text-xs font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5"
            title="Project ID — a permanent reference that never changes; also recorded in the Survey Ops sheet"
          >
            {project.project_code}
          </span>
        )}
        <EditableType value={project.project_type} onSave={v => updateProject.mutate({ id, updates: { project_type: v as 'PS' | 'B2B' | 'Rerun' } })} />
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
            <HelpTip text="Pauses the project. The card stays on the board but greys out and sinks to the bottom of its column. Resume brings it right back — nothing is lost.">
              <button
                onClick={() => setStatus('Hold')}
                className="text-sm border border-border text-muted-foreground hover:text-foreground hover:border-ring px-3 py-1.5 rounded-lg transition-colors shrink-0"
              >
                ⏸ Hold
              </button>
            </HelpTip>
          )}
          {project.status === 'Hold' && (
            <HelpTip text="Takes the project off hold — the card returns to normal in its column.">
              <button
                onClick={() => setStatus('Open')}
                className="text-sm border border-border text-muted-foreground hover:text-foreground hover:border-ring px-3 py-1.5 rounded-lg transition-colors shrink-0"
              >
                ▶ Resume
              </button>
            </HelpTip>
          )}
          {project.status !== 'Closed' ? (
            <HelpTip text="Marks the project done (or archived). It leaves Operations view but stays in Full View's Closed section, and can be reopened anytime.">
              <button
                onClick={() => setStatus('Closed')}
                className="text-sm border border-border text-muted-foreground hover:text-foreground hover:border-ring px-3 py-1.5 rounded-lg transition-colors shrink-0"
              >
                ✕ Close
              </button>
            </HelpTip>
          ) : (
            <HelpTip text="Brings this closed project back to the open board.">
              <button
                onClick={() => setStatus('Open')}
                className="text-sm border border-border text-muted-foreground hover:text-foreground hover:border-ring px-3 py-1.5 rounded-lg transition-colors shrink-0"
              >
                ↺ Reopen
              </button>
            </HelpTip>
          )}
          <HelpTip text="Create a fresh copy of this project — a new PR code, setup fields carried over (your choice), run-data reset. Great for the next wave of a recurring study.">
            <button
              onClick={() => setCloning(true)}
              className="text-sm border border-border text-muted-foreground hover:text-foreground hover:border-ring px-3 py-1.5 rounded-lg transition-colors shrink-0"
            >
              ⎘ Clone
            </button>
          </HelpTip>
          {/* Destructive action set apart from Close by a divider + a red tint
              that's visible at rest, so it can't be hit by reflex. */}
          <span className="flex items-center border-l border-border pl-2 ml-1 gap-2">
            <HelpTip text="Removes the project from the board and moves it to Recently Deleted on the Admin page, where you can restore it (it asks you to type 'delete' first). If you just want it off the board, use Close instead.">
              <button
                onClick={() => setConfirmingDelete(true)}
                className="text-sm border border-border text-red-600/70 dark:text-red-400/70 hover:text-red-600 dark:hover:text-red-400 hover:border-red-500/50 px-3 py-1.5 rounded-lg transition-colors shrink-0"
              >
                🗑 Delete
              </button>
            </HelpTip>
            <MergeButton kind="project" record={project} />
          </span>
        </div>
      </div>

      {cloning && (
        <CloneProjectModal
          sourceId={id}
          sourceName={project.project_name}
          sourceCode={project.project_code}
          onClose={() => setCloning(false)}
        />
      )}

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

      {/* Tabs + Survey IDs surfaced top-right (was buried in Links & Setup) */}
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
      <div className="flex flex-wrap bg-muted border border-border rounded-lg p-1 gap-1 w-fit">
        <button
          onClick={() => setActiveTab('overview')}
          title='The full project view — stats, pipeline, next steps, documents, and details'
          className={`text-sm px-3 py-1.5 rounded font-medium transition-colors ${
            activeTab === 'overview'
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('insights')}
          title="Performance stats — completion/fill rates, cost per complete, pace, supplier mix"
          className={`text-sm px-3 py-1.5 rounded font-medium transition-colors ${
            activeTab === 'insights'
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Insights (Beta)
        </button>
        <button
          onClick={() => setActiveTab('activity')}
          title="Logged emails and events for this project"
          className={`text-sm px-3 py-1.5 rounded font-medium transition-colors ${
            activeTab === 'activity'
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Activity
        </button>
        <button
          onClick={() => setActiveTab('deliverables')}
          title="Files delivered to the client for this project"
          className={`text-sm px-3 py-1.5 rounded font-medium transition-colors ${
            activeTab === 'deliverables'
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Deliverables
        </button>
        <button
          onClick={() => setActiveTab('links')}
          title="Slack channel link and notification settings"
          className={`text-sm px-3 py-1.5 rounded font-medium transition-colors ${
            activeTab === 'links'
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Links
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          title="Manual data-change log and the automatic field-change audit trail"
          className={`text-sm px-3 py-1.5 rounded font-medium transition-colors ${
            activeTab === 'logs'
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Logs
        </button>
      </div>
      <div className="bg-card border border-border shadow-sm rounded-xl px-3 py-2 w-full sm:w-auto sm:min-w-[260px] sm:max-w-sm flex flex-col gap-2">
        <EditableRow
          label="Survey IDs"
          value={project.survey_tool_id ?? ''}
          placeholder="e.g. SV-1042, SV-1043"
          tooltip={TOOLTIPS['Survey IDs']}
          onSave={v => updateProject.mutate({ id, updates: { survey_tool_id: v || null } })}
        />
        {project.survey_id_discrepancy && (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-2 flex flex-col gap-1.5">
            <p className="text-sm text-amber-700 dark:text-amber-400">⚠ {project.survey_id_discrepancy}</p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const m = project.survey_id_discrepancy?.match(/"([^"]+)"/)
                  updateProject.mutate({
                    id,
                    updates: { survey_tool_id: m?.[1] ?? project.survey_tool_id, survey_id_discrepancy: null },
                  })
                }}
                className="text-[12px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-700 dark:text-amber-300 px-2 py-1 rounded transition-colors"
              >
                Use Edwin ID
              </button>
              <button
                onClick={() => updateProject.mutate({ id, updates: { survey_id_discrepancy: null } })}
                className="text-[12px] text-muted-foreground hover:text-foreground px-2 py-1 transition-colors"
              >
                Keep current — dismiss
              </button>
            </div>
          </div>
        )}
      </div>
      </div>

      {activeTab === 'insights' && <ProjectInsights project={project} />}

      {activeTab === 'activity' && (
        <div className="max-w-3xl">
          <ActivityLog projectId={project.id} />
        </div>
      )}

      {activeTab === 'deliverables' && (
        <div className="max-w-4xl">
          <DeliverablesPanel projectId={project.id} />
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="max-w-3xl flex flex-col gap-4">
          <DataChangeLog projectId={project.id} />
          <ProjectAuditLog projectId={project.id} />
        </div>
      )}

      {activeTab === 'links' && (
        <div className="max-w-3xl flex flex-col gap-4">
          <SlackChannel projectId={project.id} url={project.slack_channel_url ?? null} />

          <div className="bg-card border border-border shadow-sm rounded-xl p-4 text-sm text-muted-foreground leading-relaxed">
            <p className="font-medium text-muted-foreground mb-1 text-xs uppercase tracking-widest">
              Notifications
            </p>
            Slack alerts sent to #survey-ops when: stage advances, due date is tomorrow, N target is hit.
          </div>
        </div>
      )}

      {/* Overview tab — kept mounted (hidden) so in-progress edits survive tab switches */}
      <div className={activeTab === 'overview' ? '' : 'hidden'}>
        <NewProjectSetupBanner project={project} />
        <ComplianceBanner project={project} />
        {/* Hero stat strip */}
        <div className="grid grid-cols-1 md:grid-cols-[minmax(130px,0.9fr)_minmax(0,2.6fr)_minmax(116px,0.8fr)] gap-3 mb-4 items-stretch">
          <SegmentedNTile
            project={project}
            tooltip={TOOLTIPS['N Collected']}
            onSaveCollected={v => updateProject.mutate({ id, updates: { n_collected: v ?? 0 } })}
            accent
          />
          <HeroDates
            project={project}
            closed={project.status === 'Closed'}
            onSaveField={updates => updateProject.mutate({ id, updates })}
          />
          <HeroWaitingOn
            project={project}
            onSetBlockedBy={v => updateProject.mutate({ id, updates: { blocked_by: v } })}
          />
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_440px] gap-6">
          {/* Left column */}
          <div className="flex flex-col gap-4">
            <div className="bg-card border border-border shadow-sm rounded-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs text-muted-foreground uppercase tracking-widest font-medium">
                  {project.phase === 'Scoping' ? 'Scoping Stage' : 'Pipeline Progress'}
                </h3>
                {project.phase !== 'Scoping' && project.status !== 'Closed' && (
                  <HelpTip text="Moves this project back to the Scoping board — for deals that reopened (pricing changed, approval fell through). Stage checkboxes are kept, so promoting it again picks up right where it left off. You can also drag the card onto a scoping column in Full View.">
                    <button
                      onClick={() =>
                        updateProject.mutate({
                          id,
                          updates: {
                            phase: 'Scoping',
                            scoping_stage: project.scoping_stage ?? 'Awaiting Approval',
                          },
                        })
                      }
                      className="text-xs text-muted-foreground hover:text-violet-600 dark:hover:text-violet-400 transition-colors cursor-pointer"
                    >
                      ↩ Back to Scoping
                    </button>
                  </HelpTip>
                )}
              </div>
              {project.phase === 'Scoping' ? (
                <ScopingProgress project={project} />
              ) : (
                <PipelineProgress project={project} />
              )}
            </div>
            <LinkedDocuments
              projectId={project.id}
              documents={project.linked_documents ?? []}
            />
            <LatestNextSteps projectId={project.id} notes={project.latest_next_steps} />
            {showCompliance && <CompliancePanel projectId={project.id} project={project} />}
          </div>

          {/* Right sidebar — packs into 2 columns on wide screens to cut scrolling;
              single column on narrower ones. Money spans both (it's the tallest). */}
          <div className="flex flex-col gap-4 self-start xl:grid xl:grid-cols-2 xl:items-start xl:content-start xl:gap-4">
            <SidebarCard title="People" className="xl:col-span-2">
              {/* Full-width People card so long names aren't clipped; fields flow
                  into two columns once the sidebar is wide enough (xl+). */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-8 gap-y-3 items-start">
                {project.client_id ? (
                  <div className="flex justify-between items-center text-sm gap-2">
                    <span className="text-muted-foreground flex items-center text-xs shrink-0">
                      Client
                      <InfoTooltip text="The client this project is for. Click the name to open their client page — all their projects, spend, and history." />
                    </span>
                    <Link
                      href={`/clients/${project.client_id}`}
                      className="text-sm text-blue-600 dark:text-blue-400 hover:underline truncate"
                      title="Open this client's page"
                    >
                      {project.client}
                    </Link>
                  </div>
                ) : (
                  <DetailRow label="Client" value={project.client} tooltip={TOOLTIPS['Client']} />
                )}
                {project.client_id && (
                  <RequestedByRow
                    clientId={project.client_id}
                    contactId={project.requested_by_contact_id ?? null}
                    snapshotName={project.requested_by_name ?? null}
                    tooltip={TOOLTIPS['Requested by']}
                    onChange={updates => updateProject.mutate({ id, updates })}
                  />
                )}
                <CaptainRow
                  label="Project Captain"
                  captain={project.captain}
                  teamMembers={teamMembers}
                  tooltip={TOOLTIPS['Project Captain']}
                  onSave={v => updateProject.mutate({ id, updates: { captain_id: v } })}
                />
                {'co_captain_ids' in project && (
                  <CoCaptainsRow
                    ids={project.co_captain_ids ?? []}
                    teamMembers={teamMembers}
                    primaryId={project.captain?.id ?? null}
                    tooltip={TOOLTIPS['Co-Captains']}
                    onSave={ids => updateProject.mutate({ id, updates: { co_captain_ids: ids } })}
                  />
                )}
                <SalespersonRow
                  value={project.salesperson ?? ''}
                  tooltip={TOOLTIPS['Salesperson']}
                  onSave={v => updateProject.mutate({ id, updates: { salesperson: v } })}
                />
              </div>
            </SidebarCard>

            <SidebarCard title="Sample N & Audience" className="xl:col-span-2" dense>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-8 gap-y-2 items-start">
                <EditableNumberRow
                  label="N Target"
                  value={project.n_target}
                  tooltip={TOOLTIPS['N Target']}
                  onSave={v => updateProject.mutate({ id, updates: { n_target: v } })}
                />
                <EditableNumberRow
                  label="N Internal Target"
                  value={project.n_internal_target ?? null}
                  tooltip={TOOLTIPS['N Internal Target']}
                  onSave={v => updateProject.mutate({ id, updates: { n_internal_target: v } })}
                />
                <EditableNumberRow
                  label="N Collected"
                  value={project.n_collected ?? 0}
                  tooltip={TOOLTIPS['N Collected']}
                  onSave={v => updateProject.mutate({ id, updates: { n_collected: v ?? 0 } })}
                />
                <EditableNumberRow
                  label="N Actual"
                  value={project.n_actual}
                  tooltip={TOOLTIPS['N Actual']}
                  onSave={v => updateProject.mutate({ id, updates: { n_actual: v } })}
                />
                <EditableNumberRow
                  label="Audience Size"
                  value={project.audience_size}
                  tooltip={TOOLTIPS['Audience Size']}
                  onSave={v => updateProject.mutate({ id, updates: { audience_size: v } })}
                />
                <EditableRow
                  label="Audience"
                  value={project.audience ?? ''}
                  placeholder="e.g. US adults 18+, likely voters"
                  tooltip={TOOLTIPS['Audience']}
                  onSave={v => updateProject.mutate({ id, updates: { audience: v || null } })}
                />
              </div>
              <GenPopNWarning project={project} />
            </SidebarCard>

            <SidebarCard title="Flags" className="xl:col-span-2" dense>
              <div className="flex flex-wrap gap-1">
                <FlagChip
                  label="Longitudinal"
                  value={project.longitudinal ?? false}
                  tone="emerald"
                  tooltip={TOOLTIPS['Longitudinal']}
                  onToggle={v => updateProject.mutate({ id, updates: { longitudinal: v } })}
                />
                <FlagChip
                  label="Voter Survey QA"
                  value={project.voter_survey_qa ?? false}
                  tone="amber"
                  tooltip={TOOLTIPS['Voter Survey QA']}
                  onToggle={v => updateProject.mutate({ id, updates: { voter_survey_qa: v } })}
                />
                <FlagChip
                  label="Citation Language"
                  value={project.citation_language_needed ?? false}
                  tone="amber"
                  tooltip={TOOLTIPS['Citation Language']}
                  onToggle={v => updateProject.mutate({ id, updates: { citation_language_needed: v } })}
                />
                <FlagChip
                  label="Row-Level Data"
                  value={project.row_level_data}
                  tone="emerald"
                  tooltip={TOOLTIPS['Row-Level Data']}
                  onToggle={v => updateProject.mutate({ id, updates: { row_level_data: v } })}
                />
                <FlagChip
                  label="Terminations"
                  value={project.terminations}
                  tone="red"
                  tooltip={TOOLTIPS['Terminations']}
                  onToggle={v => updateProject.mutate({ id, updates: { terminations: v } })}
                />
              </div>
            </SidebarCard>

            <SidebarCard title="Money" className="xl:col-span-2">
              {/* PS → Suppliers (PureSpectrum), B2B → Blast Configuration.
                  Rerun/untyped show both (they don't map cleanly to one). */}
              {project.project_type === 'PS' && (
                <SuppliersWidget projectId={project.id} nTarget={project.n_target} nInternalTarget={project.n_internal_target} nActual={project.n_actual} />
              )}
              {project.project_type === 'B2B' && <BlastConfigWidget projectId={project.id} />}
              {(project.project_type === 'Rerun' || project.project_type == null) && (
                <>
                  <SuppliersWidget projectId={project.id} nTarget={project.n_target} nInternalTarget={project.n_internal_target} nActual={project.n_actual} />
                  <BlastConfigWidget projectId={project.id} />
                </>
              )}
              {/* Budgets sit under the supplier/blast config now (David's ordering). */}
              <div className="border-t border-border pt-3 mt-1">
                <BudgetWidget
                  projectId={project.id}
                  budget={project.budget ?? null}
                  nCollected={project.n_collected}
                  actualSpend={project.actual_spend ?? null}
                />
              </div>
              <div className="border-t border-border pt-3 mt-1 flex items-center gap-1.5 text-xs text-muted-foreground/50">
                <span aria-hidden="true">＋</span> Add cost line — other costs &amp; unit economics (coming soon)
              </div>
            </SidebarCard>

            <SidebarCard title="Rerun history" className="xl:col-span-2" dense>
              <WaveHistory project={project} />
            </SidebarCard>
          </div>
        </div>
      </div>
    </div>
  )
}

function SidebarCard({ title, children, className = '', dense = false }: { title: string; children: React.ReactNode; className?: string; dense?: boolean }) {
  return (
    <div className={`bg-card border border-border shadow-sm rounded-xl ${dense ? 'p-3' : 'p-4'} ${className}`}>
      <h3 className={`text-xs text-muted-foreground uppercase tracking-widest font-medium ${dense ? 'mb-2' : 'mb-4'}`}>
        {title}
      </h3>
      <div className={`flex flex-col ${dense ? 'gap-2' : 'gap-3'}`}>{children}</div>
    </div>
  )
}

/* ---------- Hero stat strip cards ---------- */

function HeroDates({
  project,
  closed,
  onSaveField,
}: {
  project: SurveyProject
  closed: boolean
  onSaveField: (updates: Partial<SurveyProject>) => void
}) {
  const due = project.due_date
  const deliver = project.deliver_date

  // Closed projects are done — drop the red/orange/amber urgency treatment
  const urgency = closed ? null : getDueUrgency(due)
  const dueColor =
    urgency === 'overdue'
      ? 'text-red-600 dark:text-red-400'
      : urgency === 'tomorrow'
      ? 'text-orange-600 dark:text-orange-400'
      : urgency === 'twodays'
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-foreground'

  let duePhrase = ' '
  if (due && !closed) {
    const days = differenceInCalendarDays(startOfDay(parseISO(due)), startOfDay(new Date()))
    duePhrase =
      days < 0 ? 'overdue' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
  }

  // The useful number: how much buffer between internally-done and client delivery
  let deliverPhrase = ' '
  let deliverWarn = false
  if (deliver && due) {
    const gap = differenceInCalendarDays(startOfDay(parseISO(deliver)), startOfDay(parseISO(due)))
    if (gap === 0) deliverPhrase = 'same day as due'
    else if (gap > 0) deliverPhrase = `${gap}d buffer after due`
    else {
      deliverPhrase = `⚠ ${-gap}d before due`
      deliverWarn = true
    }
  } else if (deliver) {
    deliverPhrase = 'no internal due set'
  }

  const longitudinal = !!project.longitudinal

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-2.5 flex flex-col justify-center gap-1.5">
      <div className={`grid grid-cols-2 ${longitudinal ? 'sm:grid-cols-5' : 'sm:grid-cols-4'} gap-x-3 gap-y-2`}>
        <HeroDateCell
          label="Submitted"
          tooltip={TOOLTIPS['Submitted']}
          value={project.submitted_date}
          onSave={v => onSaveField({ submitted_date: v })}
        />
        <HeroDateCell
          label="Launch"
          tooltip={TOOLTIPS['Launch Date']}
          value={project.launch_date}
          onSave={v => onSaveField({ launch_date: v })}
        />
        <HeroDateCell
          label="Due"
          hint="internal"
          tooltip={TOOLTIPS['Due Date']}
          value={due}
          valueColor={dueColor}
          subtitle={duePhrase}
          onSave={v => onSaveField({ due_date: v })}
        />
        <HeroDateCell
          label="Deliver"
          hint="client"
          tooltip={TOOLTIPS['Deliver Date']}
          value={deliver}
          valueColor={deliverWarn ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}
          subtitle={deliverPhrase}
          onSave={v => onSaveField({ deliver_date: v })}
        />
        {longitudinal && (
          <HeroDateCell
            label="Rerun"
            tooltip="When the next wave of this longitudinal survey should run. A week before this date the system auto-creates the next wave, setup carried over and run-data reset."
            value={project.rerun_date ?? null}
            onSave={v => onSaveField({ rerun_date: v, rerun_spawned_at: null })}
          />
        )}
      </div>
      {longitudinal && ((project.rerun_number ?? 1) > 1 || project.rerun_spawned_at) && (
        <p className="text-[11px] text-muted-foreground/70 truncate">
          {(project.rerun_number ?? 1) > 1 ? `${ordinal(project.rerun_number)} wave` : ''}
          {(project.rerun_number ?? 1) > 1 && project.rerun_spawned_at ? ' · ' : ''}
          {project.rerun_spawned_at ? '↻ next wave created' : ''}
        </p>
      )}
    </div>
  )
}

function HeroDateCell({
  label,
  hint,
  tooltip,
  value,
  valueColor = 'text-foreground',
  subtitle,
  onSave,
}: {
  label: string
  hint?: string
  tooltip: string
  value: string | null
  valueColor?: string
  subtitle?: string
  onSave: (next: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function save() {
    onSave(draft || null)
    setEditing(false)
  }

  return (
    <div className="flex flex-col gap-0.5 min-w-0" title={tooltip}>
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">
        {label}
        {hint && <span className="text-muted-foreground/60 normal-case"> ({hint})</span>}
      </span>
      {editing ? (
        <input
          autoFocus
          type="date"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={save}
          className="min-w-0 w-full bg-muted border border-border rounded px-1 py-0.5 text-sm text-foreground focus:outline-none focus:border-ring"
          onKeyDown={e => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <button
          onClick={() => {
            setDraft(value ? value.slice(0, 10) : '')
            setEditing(true)
          }}
          className={`text-sm font-medium leading-tight text-left cursor-pointer truncate hover:bg-accent rounded px-1 -ml-1 transition-colors ${valueColor}`}
          title="Click to edit"
        >
          {formatDate(value)}
        </button>
      )}
      {subtitle !== undefined && (
        <span className="text-[11px] text-muted-foreground truncate">{subtitle}</span>
      )}
    </div>
  )
}

function HeroWaitingOn({
  project,
  onSetBlockedBy,
}: {
  project: Parameters<typeof deriveWaitingOn>[0] & { blocked_by?: string | null }
  onSetBlockedBy: (next: string) => void
}) {
  const derived = deriveWaitingOn(project)
  const [main, sub] = derived.split(' — ')
  const blocked = project.blocked_by === 'client' || project.blocked_by === 'internal'
  const [picking, setPicking] = useState(false)
  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-2.5 flex flex-col gap-1">
      <span className="text-xs text-muted-foreground flex items-center">
        Waiting on
        <InfoTooltip text="Auto-derived from status, phase, stage checkboxes, and fielding progress. Mark the project blocked to force it to Client or Us." />
      </span>
      <span
        className={`text-lg font-semibold leading-tight truncate ${
          main === 'Client' ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'
        }`}
        title={derived}
      >
        {main}
      </span>
      <span className="text-xs text-muted-foreground">{sub ?? ' '}</span>
      {/* The block override is rare, so it's a small ghost control by default. */}
      {blocked ? (
        <button
          onClick={() => onSetBlockedBy('none')}
          title="Clear the manual block"
          className="mt-1 self-start text-[12px] inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25 transition-colors"
        >
          {project.blocked_by === 'client' ? 'Blocked — client' : 'Blocked — us'} ✕
        </button>
      ) : picking ? (
        <select
          autoFocus
          value="none"
          onChange={e => {
            onSetBlockedBy(e.target.value)
            setPicking(false)
          }}
          onBlur={() => setPicking(false)}
          className="mt-1 self-start bg-muted border border-border rounded px-1 py-0.5 text-[12px] text-muted-foreground focus:outline-none focus:border-ring cursor-pointer"
        >
        <option value="none">None</option>
        <option value="client">Blocked — client</option>
        <option value="internal">Blocked — us</option>
        </select>
      ) : (
        <button
          onClick={() => setPicking(true)}
          title="Mark this project blocked (forces Waiting On to Client or Us)"
          className="mt-1 self-start text-[12px] text-muted-foreground/50 hover:text-foreground transition-colors"
        >
          + mark blocked
        </button>
      )}
    </div>
  )
}

// Brand-new project guidance: a dismissible nudge toward the fields that
// matter, instead of leaving the owner facing a page of em-dashes. Dismissal
// is per-project so deliberately-blank fields don't keep nagging.
function NewProjectSetupBanner({ project }: { project: SurveyProject }) {
  const key = `sot.setupBannerDismissed.${project.id}`
  const [dismissed, setDismissed] = useState(true) // hidden until storage read (no flash)
  const isNew = !project.due_date && project.n_target == null && project.budget == null

  useEffect(() => {
    setDismissed(localStorage.getItem(key) === '1')
  }, [key])

  if (!isNew || dismissed) return null
  return (
    <div className="mb-4 flex items-start gap-3 bg-blue-500/5 border border-blue-500/30 rounded-xl px-4 py-3">
      <span className="text-lg leading-none mt-0.5">✦</span>
      <div className="flex-1 text-sm">
        <p className="font-medium text-foreground">New project — a few essentials to fill in</p>
        <p className="text-muted-foreground mt-0.5 leading-relaxed">
          Set the <span className="text-foreground">Due date</span> and{' '}
          <span className="text-foreground">N target</span> in the tiles below, add a{' '}
          <span className="text-foreground">Captain</span> and{' '}
          <span className="text-foreground">Budget</span> in the side cards — or use{' '}
          <span className="text-foreground">✦ Edit by description</span> to fill several at once.
        </p>
      </div>
      <button
        onClick={() => {
          localStorage.setItem(key, '1')
          setDismissed(true)
        }}
        title="Dismiss this reminder for this project"
        className="text-muted-foreground/60 hover:text-foreground text-sm shrink-0"
      >
        ✕
      </button>
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
  const help: Record<string, string> = {
    none: 'Sets this project\'s priority. Each click cycles: none → ⚑ High → ‼ Urgent → back to none. High and urgent cards float to the top of their board column.',
    high: 'Priority is ⚑ High — the card floats to the top of its board column. Click again for ‼ Urgent; one more click clears it back to none.',
    urgent: 'Priority is ‼ Urgent — the very top of the board column. Click again to clear priority back to none.',
  }
  const text = help[priority] ?? help.none
  const base = 'text-sm px-3 py-1.5 rounded-lg transition-colors shrink-0 cursor-pointer'

  if (priority === 'high') {
    return (
      <HelpTip text={text}>
        <button onClick={() => onCycle(next)}
          className={`${base} bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25`}>
          ⚑ High
        </button>
      </HelpTip>
    )
  }
  if (priority === 'urgent') {
    return (
      <HelpTip text={text}>
        <button onClick={() => onCycle(next)}
          className={`${base} bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/25`}>
          ‼ Urgent
        </button>
      </HelpTip>
    )
  }
  return (
    <HelpTip text={text}>
      <button onClick={() => onCycle(next)}
        className={`${base} border border-border text-muted-foreground hover:text-foreground hover:border-ring`}>
        ⚑ Priority
      </button>
    </HelpTip>
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
            className="flex-1 min-w-0 bg-muted border border-border rounded px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
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
    <div className={`flex justify-between items-center text-sm gap-2 ${value ? '' : 'opacity-60'}`}>
      <span className="text-muted-foreground flex items-center text-xs shrink-0">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <button
        onClick={() => {
          setDraft(value)
          setEditing(true)
        }}
        className="text-[13px] text-foreground hover:bg-accent rounded px-1.5 transition-colors truncate cursor-pointer"
        title="Click to edit"
      >
        {value || <span className="text-muted-foreground/50 whitespace-nowrap">— set</span>}
      </button>
    </div>
  )
}

const CHIP_ON: Record<'red' | 'amber' | 'emerald', string> = {
  red: 'bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/25',
  amber: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25',
  emerald: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25',
}

function FlagChip({
  label,
  value,
  tone,
  tooltip,
  onToggle,
}: {
  label: string
  value: boolean
  tone: 'red' | 'amber' | 'emerald'
  tooltip?: string
  onToggle: (next: boolean) => void
}) {
  return (
    <button
      onClick={() => onToggle(!value)}
      title={tooltip}
      aria-pressed={value}
      className={`rounded-full px-2 py-0.5 text-xs cursor-pointer transition-colors ${
        value
          ? CHIP_ON[tone]
          : 'border border-dashed border-border bg-transparent text-muted-foreground hover:bg-muted'
      }`}
    >
      {/* On/off marker so state isn't conveyed by color alone, and the dashed
          off-state reads as a pressable toggle rather than a disabled chip. */}
      {value ? (tone === 'red' ? `⚠ ${label}` : `✓ ${label}`) : `○ ${label}`}
    </button>
  )
}

function EditableTitle({ value, onSave }: { value: string; onSave: (next: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function save() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) onSave(trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <span className="flex items-center gap-1.5 min-w-0 flex-1">
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="text-2xl font-bold text-foreground bg-muted border border-border rounded px-1.5 py-0.5 focus:outline-none focus:border-ring min-w-0 flex-1"
        />
        <button
          onClick={save}
          className="text-xs bg-muted hover:bg-accent border border-border rounded px-2 py-1 transition-colors shrink-0"
        >
          Save
        </button>
      </span>
    )
  }

  return (
    <h1
      onClick={() => { setDraft(value); setEditing(true) }}
      title="Click to rename (the PR##### code stays the same)"
      className="text-2xl font-bold text-foreground cursor-pointer hover:text-foreground/70 rounded px-1 -mx-1 transition-colors"
    >
      {value}
    </h1>
  )
}

function EditableType({ value, onSave }: { value: string | null; onSave: (next: string) => void }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <select
        autoFocus
        defaultValue={value ?? ''}
        onChange={e => { if (e.target.value) onSave(e.target.value); setEditing(false) }}
        onBlur={() => setEditing(false)}
        className="text-xs px-1.5 py-1 rounded border border-border bg-background focus:outline-none focus:border-ring"
      >
        <option value="" disabled>Type…</option>
        <option value="PS">PS</option>
        <option value="B2B">B2B</option>
        <option value="Rerun">Rerun</option>
      </select>
    )
  }
  return (
    <button
      onClick={() => setEditing(true)}
      title="Click to change project type"
      className={`text-xs px-2 py-1 rounded cursor-pointer hover:opacity-80 transition-opacity ${
        value ? (TYPE_BADGE[value] ?? '') : 'border border-dashed border-border text-muted-foreground'
      }`}
    >
      {value ?? '+ type'}
    </button>
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
      <span className={`text-[13px] px-1.5 ${valueClass}`}>{value}</span>
    </div>
  )
}

function EditableNumberRow({
  label,
  value,
  tooltip,
  valueClass = 'text-foreground hover:text-foreground/70',
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
            className="w-20 bg-muted border border-border rounded px-2 py-1 text-sm text-foreground text-right focus:outline-none focus:border-ring"
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
    <div className={`flex justify-between items-center text-sm gap-2 ${value != null ? '' : 'opacity-60'}`}>
      <span className="text-muted-foreground flex items-center text-xs shrink-0">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <button
        onClick={() => {
          setDraft(value != null ? String(value) : '')
          setEditing(true)
        }}
        className={`text-[13px] cursor-pointer hover:bg-accent rounded px-1.5 transition-colors ${valueClass}`}
        title="Click to edit"
      >
        {value != null ? fmtNum(value) : <span className="text-muted-foreground/50 whitespace-nowrap">— set</span>}
      </button>
    </div>
  )
}

function SalespersonRow({
  value,
  tooltip,
  onSave,
}: {
  value: string
  tooltip?: string
  onSave: (next: string | null) => void
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <div className="flex justify-between items-center text-sm gap-2">
        <span className="text-muted-foreground flex items-center text-xs shrink-0">
          Salesperson
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        <select
          autoFocus
          value={value}
          onChange={e => {
            onSave(e.target.value || null)
            setEditing(false)
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={e => {
            if (e.key === 'Escape') setEditing(false)
          }}
          className="min-w-0 bg-muted border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-ring"
        >
          <option value="">—</option>
          {salespersonOptions(value).map(name => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <div className="flex justify-between items-center text-sm gap-2">
      <span className="text-muted-foreground flex items-center text-xs shrink-0">
        Salesperson
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <button
        onClick={() => setEditing(true)}
        className="text-sm text-foreground hover:bg-accent rounded px-1.5 transition-colors cursor-pointer truncate"
        title="Click to change"
      >
        {value || <span className="text-muted-foreground/50 whitespace-nowrap">— set</span>}
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
            className="min-w-0 bg-muted border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-ring"
            onKeyDown={e => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') setEditing(false)
            }}
          >
            <option value="">Unassigned</option>
            {assignableMembers(teamMembers).map(m => (
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
        className="text-sm text-foreground hover:bg-accent rounded px-1.5 transition-colors cursor-pointer truncate"
        title={captain ? `${captain.name} — click to change` : 'Click to assign'}
      >
        {captain?.name ?? <span className="text-muted-foreground/50">—</span>}
      </button>
    </div>
  )
}

function CoCaptainsRow({
  ids,
  teamMembers,
  primaryId,
  tooltip,
  onSave,
}: {
  ids: string[]
  teamMembers: TeamMember[]
  primaryId: string | null
  tooltip?: string
  onSave: (next: string[]) => void
}) {
  const [adding, setAdding] = useState(false)
  const byId = new Map(teamMembers.map(m => [m.id, m]))
  const available = assignableMembers(teamMembers).filter(
    m => m.id !== primaryId && !ids.includes(m.id)
  )

  return (
    <div className="flex justify-between items-start text-sm gap-2">
      <span className="text-muted-foreground flex items-center text-xs shrink-0 pt-0.5">
        Co-Captains
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <div className="flex flex-col items-end gap-1 min-w-0">
        {ids.map(cid => (
          <span key={cid} className="flex items-center gap-1 text-sm text-foreground">
            <span className="truncate">{byId.get(cid)?.name ?? 'Unknown'}</span>
            <button
              onClick={() => onSave(ids.filter(x => x !== cid))}
              title="Remove this co-captain"
              className="text-muted-foreground/50 hover:text-red-600 dark:hover:text-red-400 text-xs"
            >
              ✕
            </button>
          </span>
        ))}
        {adding ? (
          <select
            autoFocus
            defaultValue=""
            onChange={e => {
              if (e.target.value) onSave([...ids, e.target.value])
              setAdding(false)
            }}
            onBlur={() => setAdding(false)}
            onKeyDown={e => {
              if (e.key === 'Escape') setAdding(false)
            }}
            className="min-w-0 bg-muted border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-ring"
          >
            <option value="">— pick —</option>
            {available.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        ) : (
          <button
            onClick={() => setAdding(true)}
            disabled={available.length === 0}
            title="Add a co-captain"
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors cursor-pointer"
          >
            {ids.length === 0 ? <span className="text-sm text-muted-foreground/50">none — + add</span> : '+ add'}
          </button>
        )}
      </div>
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
        <h2 className="text-base font-semibold text-foreground">Delete project</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          This removes <span className="text-foreground font-medium">{projectName}</span> from the board.
          It moves to <span className="text-foreground">Recently Deleted</span> on the Admin page, where you
          can restore it or delete it permanently. If you just want it off the board, use Close Project instead.
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
            {isPending ? 'Deleting…' : 'Move to Recently Deleted'}
          </button>
        </div>
      </div>
    </div>
  )
}
