'use client'
import { Caret } from '@/components/shared/Caret'
import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useUpdateClient } from '@/lib/hooks/useClients'
import { useTeamMembers } from '@/lib/hooks/useTeamMembers'
import { ClientContacts } from '@/components/client/ClientContacts'
import { ClientNotes } from '@/components/client/ClientNotes'
import { ClientNameHeading } from '@/components/client/ClientNameHeading'
import { NewProjectModal } from '@/components/board/NewProjectModal'
import { MergeButton } from '@/components/merge/MergeButton'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Skeleton } from '@/components/shared/Skeleton'
import { formatDate, getDueUrgency, urgencyPrefix } from '@/lib/utils/date'
import { stageLabel } from '@/lib/utils/stage'
import { fmtNum } from '@/lib/utils/number'
import type { Tables } from '@/lib/supabase/types'
import { isRerunProject } from '@/lib/reruns/isRerun'
import { RerunChip } from '@/components/reruns/RerunChip'
import { baseRerunName } from '@/lib/utils/rerun'

type Client = Tables<'clients'>

// Only what the stats and table below actually need
type ClientProject = {
  id: string
  project_code: string | null
  project_name: string
  client: string
  status: string
  phase: string
  board_column: string
  project_type: string | null
  series_id: string | null
  rerun_number: number | null
  submitted_date: string | null
  due_date: string | null
  deliver_date: string | null
  delivered_at: string | null
  created_at: string
  updated_at: string
  budget: number | null
  actual_spend: number | null
  n_target: number | null
  n_collected: number
  n_actual: number | null
  is_placeholder: boolean
}

const PROJECT_COLS =
  'id, project_code, project_name, client, status, phase, board_column, project_type, series_id, rerun_number, submitted_date, due_date, deliver_date, delivered_at, created_at, updated_at, budget, actual_spend, n_target, n_collected, n_actual, is_placeholder'

function useClientPage(clientId: string) {
  const supabase = createClient()
  const client = useQuery({
    queryKey: ['client', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .maybeSingle()
      if (error) throw error
      return data as Client | null
    },
    enabled: !!clientId,
  })
  const projects = useQuery({
    queryKey: ['client-projects', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('survey_projects')
        .select(PROJECT_COLS + ', project_type')
        .eq('client_id', clientId)
        .is('deleted_at', null)
        .order('submitted_date', { ascending: false, nullsFirst: false })
      if (error) throw error
      return (data as unknown as (ClientProject & { project_type: string | null })[]).filter(
        p => p.project_type !== 'Internal'
      )
    },
    enabled: !!clientId,
  })
  // Series metadata for grouping this client's rerun waves under one label.
  const series = useQuery({
    queryKey: ['client-rerun-series', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rerun_series')
        .select('id, survey_name, base_type, cadence_months')
        .eq('client_id', clientId)
      if (error) throw error
      return data as unknown as {
        id: string
        survey_name: string
        base_type: string | null
        cadence_months: number | null
      }[]
    },
    enabled: !!clientId,
  })
  return { client, projects, series }
}

function money(v: number | null): string {
  if (v == null) return '—'
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

// Editable compliance requirement for the client. Collapsed to a one-line
// status by default (most clients need none); expand to edit — it's the control
// that flags a client, so it always stays reachable (unlike the read-only
// compliance panel on the project page). Sourced initially from the sheet's
// Compliance tab; the app is the source of truth thereafter.
function ClientComplianceCard({ client }: { client: Client }) {
  const update = useUpdateClient()
  const [contact, setContact] = useState(client.compliance_contact ?? '')
  const [notes, setNotes] = useState(client.compliance_notes ?? '')
  const before = client.compliance_before_fielding
  const after = client.compliance_after_fielding
  const required = before || after
  const [open, setOpen] = useState(required)
  const status = before && after ? 'Before + after fielding' : before ? 'Before fielding' : after ? 'After fielding' : 'Not required'

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col gap-3">
      <button onClick={() => setOpen(o => !o)} className="flex items-center justify-between gap-2 text-left" aria-expanded={open}>
        <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium flex items-center">
          Compliance
          <InfoTooltip text="When set, this client's surveys are blocked from being fielded (before) or delivered (after) until the matching compliance review is approved. Seeded from the sheet's Compliance tab; editable here." />
        </span>
        <span className="flex items-center gap-1.5 text-xs">
          <span className={required ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>{status}</span>
          <Caret open={open} className="text-foreground" />
        </span>
      </button>
      {open && (
        <>
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={before}
                onChange={e => update.mutate({ id: client.id, updates: { compliance_before_fielding: e.target.checked } })}
                className="accent-blue-600"
              />
              <span className="text-foreground">Review required <span className="text-muted-foreground">before fielding</span> — questions only</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={after}
                onChange={e => update.mutate({ id: client.id, updates: { compliance_after_fielding: e.target.checked } })}
                className="accent-blue-600"
              />
              <span className="text-foreground">Review required <span className="text-muted-foreground">after fielding</span> — questions + results</span>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Compliance contact email(s)
            <input
              value={contact}
              onChange={e => setContact(e.target.value)}
              onBlur={() => {
                if (contact !== (client.compliance_contact ?? ''))
                  update.mutate({ id: client.id, updates: { compliance_contact: contact.trim() || null } })
              }}
              placeholder="compliance@client.com, reviewer@client.com"
              className="bg-muted border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-ring"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Notes <span className="text-muted-foreground/70">(advisory — e.g. conditions)</span>
            <input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              onBlur={() => {
                if (notes !== (client.compliance_notes ?? ''))
                  update.mutate({ id: client.id, updates: { compliance_notes: notes.trim() || null } })
              }}
              placeholder="e.g. only if the survey contains open-text questions"
              className="bg-muted border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-ring"
            />
          </label>
        </>
      )}
    </div>
  )
}

/** Earliest meaningful date for a project — submitted if known, else record creation. */
function projectDate(p: ClientProject): string {
  return p.submitted_date ?? p.created_at.slice(0, 10)
}

const tile = 'bg-card border border-border shadow-sm rounded-xl p-3 flex flex-col gap-1'

type PSort = 'project_name' | 'status' | 'submitted_date' | 'n' | 'due_date' | 'spend'

/** A table row is either a standalone project or a collapsed rerun-series group. */
type RenderItem =
  | { kind: 'single'; project: ClientProject }
  | { kind: 'group'; seriesId: string; waves: ClientProject[] }

function projectSortValue(p: ClientProject, field: PSort): string | number {
  switch (field) {
    case 'project_name':
      return p.project_name
    case 'status':
      return p.status
    case 'submitted_date':
      return projectDate(p)
    case 'n':
      return p.n_collected ?? 0
    case 'due_date':
      return p.due_date ?? ''
    case 'spend':
      return p.actual_spend == null ? Number.NEGATIVE_INFINITY : p.actual_spend
  }
}

export default function ClientPage() {
  const params = useParams()
  const router = useRouter()
  const clientId = params.id as string
  const { client, projects, series } = useClientPage(clientId)
  const { data: teamMembers = [] } = useTeamMembers()
  const rows = useMemo(() => projects.data ?? [], [projects.data])
  const [showNew, setShowNew] = useState(false)
  const [sortField, setSortField] = useState<PSort>('submitted_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  // Which rerun series are expanded (collapsed by default).
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set())
  const toggleSeries = (id: string) =>
    setExpandedSeries(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // series_id -> { survey_name, base_type } for group labels.
  const seriesMeta = useMemo(() => {
    const m = new Map<string, { survey_name: string; base_type: string | null }>()
    for (const s of series.data ?? []) m.set(s.id, { survey_name: s.survey_name, base_type: s.base_type })
    return m
  }, [series.data])

  function handleSort(field: PSort) {
    if (field === sortField) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortField(field)
      setSortDir('asc')
    }
  }
  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = projectSortValue(a, sortField)
      const bv = projectSortValue(b, sortField)
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortField, sortDir])

  // Collapse each rerun series' waves into one group, placed at the position of
  // its top-sorted wave (so the active column sort still governs placement, and
  // standalone rows keep their exact order). A 1-wave "series" stays a normal
  // row — grouping a single project would add clutter, not remove it.
  const renderItems = useMemo<RenderItem[]>(() => {
    const items: RenderItem[] = []
    const seen = new Set<string>()
    for (const p of sortedRows) {
      const sid = p.series_id
      if (!sid) {
        items.push({ kind: 'single', project: p })
        continue
      }
      if (seen.has(sid)) continue
      seen.add(sid)
      const waves = sortedRows
        .filter(w => w.series_id === sid)
        .slice()
        .sort((a, b) => (a.rerun_number ?? 0) - (b.rerun_number ?? 0))
      if (waves.length <= 1) items.push({ kind: 'single', project: p })
      else items.push({ kind: 'group', seriesId: sid, waves })
    }
    return items
  }, [sortedRows])

  const stats = useMemo(() => {
    if (rows.length === 0) return null
    const today = new Date().toISOString().slice(0, 10)
    const dates = rows.map(projectDate).sort()
    const open = rows.filter(p => p.status === 'Open')
    // A delivered project keeps status 'Open' (board_column 'Delivery') until
    // archived, so exclude it from the overdue count — it's done.
    const overdue = open.filter(p => p.board_column !== 'Delivery' && p.due_date && p.due_date <= today).length
    const withSpend = rows.filter(p => p.actual_spend != null && p.actual_spend > 0)
    const totalSpend = withSpend.reduce((s, p) => s + (p.actual_spend ?? 0), 0)
    const totalBudget = rows.reduce((s, p) => s + (p.budget ?? 0), 0)
    let avgGapDays: number | null = null
    if (dates.length > 1) {
      const ms = dates.map(d => new Date(d).getTime())
      avgGapDays = Math.round((ms[ms.length - 1] - ms[0]) / (dates.length - 1) / 86_400_000)
    }
    return {
      since: dates[0],
      last: dates[dates.length - 1],
      open: open.length,
      overdue,
      hold: rows.filter(p => p.status === 'Hold').length,
      closed: rows.filter(p => p.status === 'Closed').length,
      totalSpend,
      avgSpend: withSpend.length > 0 ? totalSpend / withSpend.length : null,
      spendCount: withSpend.length,
      totalBudget,
      avgGapDays,
    }
  }, [rows])

  if (client.isLoading || projects.isLoading || series.isLoading) {
    return (
      <div className="max-w-6xl mx-auto flex flex-col gap-4">
        <Skeleton className="h-8 w-72" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={tile}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-24" />
            </div>
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  if (!client.data) {
    return (
      <div className="text-muted-foreground text-sm">
        Client not found.{' '}
        <button onClick={() => router.push('/admin')} className="text-blue-600 dark:text-blue-400 underline">
          Back to Admin
        </button>
      </div>
    )
  }

  const c = client.data

  const SortIcon = ({ field }: { field: PSort }) => {
    if (sortField !== field) return <span className="text-muted-foreground ml-1">↕</span>
    return <span className="text-foreground/80 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  // A normal (or nested child) project row — click-through to the project.
  const renderProjectRow = (p: ClientProject, opts: { zebra: boolean; child?: boolean }) => {
    // Delivered = board_column 'Delivery' (status stays 'Open'). Show it
    // as done with its delivery date instead of an overdue warning.
    const delivered = p.board_column === 'Delivery'
    const urgency = p.status === 'Open' && !delivered ? getDueUrgency(p.due_date) : null
    const deliveredDate = p.deliver_date ?? p.delivered_at ?? p.due_date
    const dueColor = delivered
      ? 'text-emerald-600 dark:text-emerald-400'
      : urgency === 'overdue'
        ? 'text-red-600 dark:text-red-400'
        : urgency === 'tomorrow' || urgency === 'twodays'
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-muted-foreground'
    return (
      <tr
        key={p.id}
        onClick={() => router.push(`/projects/${p.id}`)}
        className={`cursor-pointer hover:bg-accent/50 transition-colors ${
          opts.child ? 'border-t border-border/60 bg-muted/20' : `border-t border-border ${opts.zebra ? 'bg-muted/40' : ''}`
        }`}
      >
        <td
          className={`px-4 py-3 text-xs font-mono text-muted-foreground whitespace-nowrap ${
            opts.child ? 'pl-10 border-l-2 border-teal-500/40' : ''
          }`}
        >
          {p.project_code ?? '—'}
        </td>
        <td className="px-4 py-3 text-sm text-foreground font-medium">
          {p.status === 'Hold' && <span title="On hold">⏸ </span>}
          {p.project_name}
          {(p.project_type === 'PS' || p.project_type === 'B2B') && (
            <span className="ml-2 text-xs text-muted-foreground">{p.project_type}</span>
          )}
          {isRerunProject(p) && <RerunChip className="ml-2 text-[11px] px-1.5 py-0.5" />}
          {p.is_placeholder && (
            <span
              title="Assumed-delivered wave — no real data yet; Sree will backfill"
              className="ml-2 align-middle text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
            >
              Placeholder
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-sm">
          {p.status === 'Open' ? (
            <span className="text-xs px-2 py-1 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              {p.phase === 'Scoping' ? 'Scoping' : stageLabel(p.board_column)}
            </span>
          ) : (
            <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground">
              {p.status === 'Hold' ? 'On hold' : 'Archived'}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
          {formatDate(p.submitted_date)}
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
          {fmtNum(p.n_collected)}{p.n_target != null ? ` / ${fmtNum(p.n_target)}` : ''}
        </td>
        <td className={`px-4 py-3 text-xs whitespace-nowrap ${dueColor}`}>
          {delivered ? (
            <>✓ Delivered{deliveredDate ? ` · ${formatDate(deliveredDate)}` : ''}</>
          ) : p.due_date ? (
            <>
              {urgencyPrefix(urgency, p.due_date)}
              {formatDate(p.due_date)}
            </>
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
          {money(p.actual_spend)}
        </td>
      </tr>
    )
  }

  // A collapsible series-group header row — toggles expansion, never navigates.
  const renderGroupRow = (item: Extract<RenderItem, { kind: 'group' }>, zebra: boolean, open: boolean) => {
    const meta = seriesMeta.get(item.seriesId)
    const name = meta?.survey_name ?? baseRerunName(item.waves[0].project_name)
    const baseType = meta?.base_type ?? null
    const latest = item.waves[item.waves.length - 1] // highest rerun_number = most recent wave
    return (
      <tr
        key={`grp-${item.seriesId}`}
        onClick={() => toggleSeries(item.seriesId)}
        className={`border-t border-border cursor-pointer hover:bg-accent/50 transition-colors ${zebra ? 'bg-muted/40' : ''}`}
      >
        <td className="px-4 py-3 text-xs whitespace-nowrap">
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${name} rerun series`}
            onClick={e => {
              e.stopPropagation()
              toggleSeries(item.seriesId)
            }}
            className="inline-flex items-center rounded text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Caret open={open} />
          </button>
        </td>
        <td className="px-4 py-3 text-sm text-foreground font-medium">
          {name}
          {(baseType === 'PS' || baseType === 'B2B') && (
            <span className="ml-2 text-xs text-muted-foreground">{baseType}</span>
          )}
          <RerunChip className="ml-2 text-[11px] px-1.5 py-0.5" />
          <span className="ml-2 text-xs text-muted-foreground font-normal">
            · {item.waves.length} waves{open ? '' : ' · click to expand'}
          </span>
        </td>
        <td className="px-4 py-3 text-sm">
          {latest.status === 'Open' ? (
            <span className="text-xs px-2 py-1 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              {latest.phase === 'Scoping' ? 'Scoping' : stageLabel(latest.board_column)}
            </span>
          ) : (
            <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground">
              {latest.status === 'Hold' ? 'On hold' : 'Archived'}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
          {formatDate(latest.submitted_date)}
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground/50 whitespace-nowrap">—</td>
        <td className="px-4 py-3 text-xs text-muted-foreground/50 whitespace-nowrap">—</td>
        <td className="px-4 py-3 text-sm text-muted-foreground/50 whitespace-nowrap">—</td>
      </tr>
    )
  }

  // Flatten grouped items into ordered <tr> rows; zebra tracks only top-level rows.
  const projectRows: ReactNode[] = []
  {
    let zi = 0
    for (const item of renderItems) {
      if (item.kind === 'single') {
        projectRows.push(renderProjectRow(item.project, { zebra: zi % 2 === 1 }))
        zi++
      } else {
        const open = expandedSeries.has(item.seriesId)
        projectRows.push(renderGroupRow(item, zi % 2 === 1, open))
        zi++
        if (open) for (const w of item.waves) projectRows.push(renderProjectRow(w, { zebra: false, child: true }))
      }
    }
  }

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/" className="text-muted-foreground hover:text-foreground text-sm transition-colors">
          ← Board
        </Link>
        <span className="text-muted-foreground/50">/</span>
        <ClientNameHeading id={c.id} name={c.name} />
        {c.code && (
          <span
            className="text-xs font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5"
            title="Client ID — permanent reference, matches the Unique Clients tab in the Survey Ops sheet"
          >
            {c.code}
          </span>
        )}
        <span className="ml-auto flex items-center gap-3">
          <MergeButton kind="client" record={c} />
          <Link
            href="/admin"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            title="All clients live on the Admin page"
          >
            All clients →
          </Link>
        </span>
      </div>

      {/* Main (stats + projects) leads; Contacts / Notes / Compliance move to the rail. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        <div className="flex flex-col gap-4">
          {rows.length === 0 ? (
            <div className="bg-card border border-border shadow-sm rounded-xl p-6 text-sm text-muted-foreground flex items-center justify-between gap-3 flex-wrap">
              <span>No projects yet for this client — it&apos;s on the approved client list, ready for its first project.</span>
              <button
                onClick={() => setShowNew(true)}
                className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg transition-colors shrink-0"
              >
                + New project
              </button>
            </div>
          ) : (
            <>
              {/* Stat tiles */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className={tile}>
                  <span className="text-xs text-muted-foreground flex items-center">
                    Client since
                    <InfoTooltip text="Date of their first project (submitted date, or when it was first recorded)." />
                  </span>
                  <span className="text-2xl font-semibold text-foreground leading-tight">
                    {formatDate(stats!.since)}
                  </span>
                  <span className="text-xs text-muted-foreground">last project {formatDate(stats!.last)}</span>
                </div>
                <div className={tile}>
                  <span className="text-xs text-muted-foreground flex items-center">
                    Projects
                    <InfoTooltip text="Everything this client has ever run with us, by current status." />
                  </span>
                  <span className="text-2xl font-semibold text-foreground leading-tight">{rows.length}</span>
                  <span className="text-xs text-muted-foreground">
                    {stats!.open} open{stats!.hold > 0 ? ` · ${stats!.hold} on hold` : ''} · {stats!.closed} closed
                    {stats!.overdue > 0 && <span className="text-red-600 dark:text-red-400"> · {stats!.overdue} overdue</span>}
                  </span>
                </div>
                <div className={tile}>
                  <span className="text-xs text-muted-foreground flex items-center">
                    Avg spend / project
                    <InfoTooltip text="Average of Actual Spend across projects where spend was recorded — internal cost, not client billing." />
                  </span>
                  <span className="text-2xl font-semibold text-foreground leading-tight">
                    {money(stats!.avgSpend != null ? Math.round(stats!.avgSpend) : null)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {stats!.spendCount > 0
                      ? `${money(stats!.totalSpend)} total · ${stats!.spendCount} project${stats!.spendCount > 1 ? 's' : ''} with spend`
                      : 'no spend recorded yet'}
                  </span>
                </div>
                <div className={tile}>
                  <span className="text-xs text-muted-foreground flex items-center">
                    Comes back every
                    <InfoTooltip text="Average days between project starts — the retention pulse. Lower means a steadier repeat client." />
                  </span>
                  <span className="text-2xl font-semibold text-foreground leading-tight">
                    {stats!.avgGapDays != null ? `${stats!.avgGapDays}d` : '—'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {stats!.avgGapDays != null ? 'avg between projects' : 'first project — no rhythm yet'}
                  </span>
                </div>
              </div>

              {/* Projects table */}
              <div className="bg-card border border-border shadow-sm rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                  <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Projects</span>
                  <button
                    onClick={() => setShowNew(true)}
                    title="Create a new project pre-filled with this client"
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    + New project
                  </button>
                </div>
                <div className="overflow-auto thin-scroll">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-background border-b border-border">
                        <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase tracking-wider font-medium" title="Permanent project ID">ID</th>
                        {(
                          [
                            ['project_name', 'Project', 'Click any row to open the project'],
                            ['status', 'Status', 'Open / Hold / Archived, with the pipeline stage for open projects'],
                            ['submitted_date', 'Submitted', 'When the project entered the pipeline'],
                            ['n', 'N', 'Responses collected vs target'],
                            ['due_date', 'Due', 'Internal deadline'],
                            ['spend', 'Spend', 'Actual spend (internal)'],
                          ] as [PSort, string, string][]
                        ).map(([field, label, title]) => (
                          <th
                            key={field}
                            title={`${title}. Click to sort.`}
                            onClick={() => handleSort(field)}
                            className="px-4 py-3 text-left text-xs text-muted-foreground uppercase tracking-wider font-medium cursor-pointer hover:text-foreground"
                          >
                            {label}
                            <SortIcon field={field} />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>{projectRows}</tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Rail — contacts, notes, and the compliance control */}
        <div className="flex flex-col gap-4">
          <ClientContacts clientId={clientId} />
          <ClientNotes clientId={clientId} />
          <ClientComplianceCard client={c} />
        </div>
      </div>

      {showNew && (
        <NewProjectModal
          teamMembers={teamMembers}
          initialClient={c.name}
          onClose={() => setShowNew(false)}
        />
      )}
    </div>
  )
}
