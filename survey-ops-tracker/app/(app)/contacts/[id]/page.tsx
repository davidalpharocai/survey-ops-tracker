'use client'
import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { RowLink } from '@/components/shared/RowLink'
import { Skeleton } from '@/components/shared/Skeleton'
import { formatDate, getDueUrgency, urgencyPrefix } from '@/lib/utils/date'
import { stageLabel } from '@/lib/utils/stage'
import { fmtNum } from '@/lib/utils/number'
import { formatNRange } from '@/lib/utils/nRange'
import { contactName } from '@/lib/utils/contact'
import type { Tables } from '@/lib/supabase/types'
import { isRerunProject } from '@/lib/reruns/isRerun'
import { RerunChip } from '@/components/reruns/RerunChip'

// The client page, one entity down: everything one client contact has asked us
// for. Surveys are attributed by requested_by_contact_id ONLY — the "Requested
// by" link a project carries. A compliance reviewer also touches a project, but
// reviewing isn't requesting, so those are deliberately not listed here.
// Deliberately NO money (budget / spend / margin): a requester's page is about
// what they asked for, and financial figures stay on the surfaces that gate them.

type Contact = Tables<'client_contacts'>
type ContactWithClient = Contact & { clients: { id: string; name: string; code: string | null } | null }

// Only what the stats and table below actually need — note the absence of
// budget/actual_spend: they are not selected, so they cannot leak into the page.
type ContactProject = {
  id: string
  project_code: string | null
  project_name: string
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
  n_target: number | null
  n_target_max: number | null
  n_collected: number
  is_placeholder: boolean
}

// n_target_max joins n_target because since migration 078 n_target is only the
// FLOOR of the agreed range, and a requester's page showing the floor as "the
// target" understates what we owe the person who asked for it. Safe to name:
// 078 is applied. price_per_n is NOT here — 082 isn't applied, one unknown
// column fails the whole request, and revenue has no business on this page
// anyway (see the header note above).
const PROJECT_COLS =
  'id, project_code, project_name, status, phase, board_column, project_type, series_id, rerun_number, submitted_date, due_date, deliver_date, delivered_at, created_at, n_target, n_target_max, n_collected, is_placeholder'

function useContactPage(contactId: string) {
  const supabase = createClient()
  const contact = useQuery({
    queryKey: ['contact', contactId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_contacts')
        .select('*, clients(id, name, code)')
        .eq('id', contactId)
        .maybeSingle()
      if (error) throw error
      return (data as unknown as ContactWithClient | null) ?? null
    },
    enabled: !!contactId,
  })
  const projects = useQuery({
    queryKey: ['contact-projects', contactId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('survey_projects')
        .select(PROJECT_COLS)
        .eq('requested_by_contact_id', contactId)
        .is('deleted_at', null)
        .order('submitted_date', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data as unknown as ContactProject[]
    },
    enabled: !!contactId,
  })
  return { contact, projects }
}

/** Earliest meaningful date for a project — submitted if known, else record creation. */
function projectDate(p: ContactProject): string {
  return p.submitted_date ?? p.created_at.slice(0, 10)
}

const tile = 'bg-card border border-border shadow-sm rounded-xl p-3 flex flex-col gap-1'

type PSort = 'project_name' | 'status' | 'submitted_date' | 'n' | 'due_date'

function projectSortValue(p: ContactProject, field: PSort): string | number {
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
  }
}

/** One label/value line in the details card — mirrors the project page's field rows. */
function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between items-start text-sm gap-2">
      <span className="text-muted-foreground text-xs shrink-0 mt-0.5">{label}</span>
      <span className="text-sm text-right min-w-0 truncate">{children}</span>
    </div>
  )
}

export default function ContactPage() {
  const params = useParams()
  const router = useRouter()
  const contactId = params.id as string
  const { contact, projects } = useContactPage(contactId)
  const rows = useMemo(() => projects.data ?? [], [projects.data])
  const [sortField, setSortField] = useState<PSort>('submitted_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

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

  const stats = useMemo(() => {
    if (rows.length === 0) return null
    const today = new Date().toISOString().slice(0, 10)
    const dates = rows.map(projectDate).sort()
    const open = rows.filter(p => p.status === 'Open')
    // A delivered project keeps status 'Open' (board_column 'Delivery') until
    // archived, so exclude it from the overdue count — it's done.
    const overdue = open.filter(p => p.board_column !== 'Delivery' && p.due_date && p.due_date <= today).length
    const collected = rows.reduce((s, p) => s + (p.n_collected ?? 0), 0)
    const withData = rows.filter(p => (p.n_collected ?? 0) > 0).length
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
      archived: rows.filter(p => p.status === 'Closed').length,
      cancelled: rows.filter(p => p.status === 'Cancelled').length,
      collected,
      withData,
      avgGapDays,
    }
  }, [rows])

  if (contact.isLoading || projects.isLoading) {
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

  if (!contact.data) {
    return (
      <div className="text-muted-foreground text-sm">
        Contact not found.{' '}
        <Link href="/admin" className="text-blue-600 dark:text-blue-400 underline">
          Back to Admin
        </Link>
      </div>
    )
  }

  const ct = contact.data
  const name = contactName(ct)
  const client = ct.clients

  const SortIcon = ({ field }: { field: PSort }) => {
    if (sortField !== field) return <span className="text-muted-foreground ml-1">↕</span>
    return <span className="text-foreground/80 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  // A survey row, same shape as the client page's. The whole row stays clickable
  // for convenience, but the project name is a REAL <a href> (RowLink) so the
  // study can be opened in a new tab from the context menu / middle-click /
  // cmd-click.
  const renderProjectRow = (p: ContactProject, zebra: boolean) => {
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
        className={`border-t border-border cursor-pointer hover:bg-accent/50 transition-colors ${zebra ? 'bg-muted/40' : ''}`}
      >
        <td className="px-4 py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">
          {p.project_code ?? '—'}
        </td>
        <td className="px-4 py-3 text-sm text-foreground font-medium">
          {p.status === 'Hold' && <span title="On hold">⏸ </span>}
          <RowLink href={`/projects/${p.id}`}>{p.project_name}</RowLink>
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
              {p.status === 'Hold' ? 'On hold' : p.status === 'Cancelled' ? 'Cancelled' : 'Archived'}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
          {formatDate(p.submitted_date)}
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
          {/* "collected / target", the target being the agreed RANGE — a single
              number when both ends match, "1,350 – 1,600" when they differ. */}
          {fmtNum(p.n_collected)}
          {p.n_target != null || p.n_target_max != null
            ? ` / ${formatNRange(p.n_target, p.n_target_max)}`
            : ''}
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
      </tr>
    )
  }

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-4">
      {/* Header — Board / client / this person, so the roster is one click back. */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/" className="text-muted-foreground hover:text-foreground text-sm transition-colors">
          ← Board
        </Link>
        <span className="text-muted-foreground/50">/</span>
        {client ? (
          <Link
            href={`/clients/${client.id}`}
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            title="Back to the client page"
          >
            {client.name}
          </Link>
        ) : (
          <span className="text-muted-foreground text-sm">Unknown client</span>
        )}
        <span className="text-muted-foreground/50">/</span>
        <h1 className="text-2xl font-semibold text-foreground">{name}</h1>
        {ct.occam_invited && (
          <span
            className="text-[10px] leading-none px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
            title={`Invited to Occam${ct.occam_invited_at ? ` on ${formatDate(String(ct.occam_invited_at).slice(0, 10))}` : ''}${ct.occam_invited_by ? ` by ${ct.occam_invited_by}` : ''}`}
          >
            Occam ✓
          </span>
        )}
        {ct.archived && (
          <span
            className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
            title="Archived — out of the Requested-by picker, but still resolves on past projects"
          >
            Archived
          </span>
        )}
        <span className="ml-auto flex items-center gap-3">
          <Link
            href={`/list?contact=${ct.id}&contactName=${encodeURIComponent(name)}&view=full`}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            title={`Open the full list filtered to ${name}`}
          >
            See in list →
          </Link>
        </span>
      </div>

      {/* Main (stats + surveys) leads; who this person is sits in the rail — the
          same split the client page uses. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        <div className="flex flex-col gap-4">
          {rows.length === 0 ? (
            <div className="bg-card border border-border shadow-sm rounded-xl p-6 text-sm text-muted-foreground flex items-center justify-between gap-3 flex-wrap">
              <span>
                No surveys requested by {ct.first_name} yet — set them as a project&apos;s
                &ldquo;Requested by&rdquo; and it shows up here.
              </span>
              {client && (
                <Link
                  href={`/clients/${client.id}`}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                >
                  {client.name}&apos;s projects →
                </Link>
              )}
            </div>
          ) : (
            <>
              {/* Stat tiles — the client page's four, with the money tile replaced
                  by responses collected. */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className={tile}>
                  <span className="text-xs text-muted-foreground flex items-center">
                    Requesting since
                    <InfoTooltip text="Date of the first survey this contact requested (submitted date, or when it was first recorded)." />
                  </span>
                  <span className="text-2xl font-semibold text-foreground leading-tight">
                    {formatDate(stats!.since)}
                  </span>
                  <span className="text-xs text-muted-foreground">last request {formatDate(stats!.last)}</span>
                </div>
                <div className={tile}>
                  <span className="text-xs text-muted-foreground flex items-center">
                    Surveys
                    <InfoTooltip text="Every survey this contact is the 'Requested by' on, by current status. Projects they only reviewed for compliance are not counted." />
                  </span>
                  <span className="text-2xl font-semibold text-foreground leading-tight">{rows.length}</span>
                  <span className="text-xs text-muted-foreground">
                    {stats!.open} open{stats!.hold > 0 ? ` · ${stats!.hold} on hold` : ''} · {stats!.archived} archived
                    {stats!.cancelled > 0 ? ` · ${stats!.cancelled} cancelled` : ''}
                    {stats!.overdue > 0 && <span className="text-red-600 dark:text-red-400"> · {stats!.overdue} overdue</span>}
                  </span>
                </div>
                <div className={tile}>
                  <span className="text-xs text-muted-foreground flex items-center">
                    Responses collected
                    <InfoTooltip text="Total N collected across every survey this contact requested — what they have actually received data on, not what was targeted." />
                  </span>
                  <span className="text-2xl font-semibold text-foreground leading-tight">
                    {fmtNum(stats!.collected)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {stats!.withData === 0
                      ? 'no responses collected yet'
                      : `across ${stats!.withData} of ${rows.length} surveys`}
                  </span>
                </div>
                <div className={tile}>
                  <span className="text-xs text-muted-foreground flex items-center">
                    Comes back every
                    <InfoTooltip text="Average days between the surveys this person requests — their own repeat pulse. Lower means a steadier requester." />
                  </span>
                  <span className="text-2xl font-semibold text-foreground leading-tight">
                    {stats!.avgGapDays != null ? `${stats!.avgGapDays}d` : '—'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {stats!.avgGapDays != null ? 'avg between requests' : 'first request — no rhythm yet'}
                  </span>
                </div>
              </div>

              {/* Surveys table — the client page's columns, minus Spend. */}
              <div className="bg-card border border-border shadow-sm rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                  <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium">
                    Surveys requested
                  </span>
                  <span className="text-xs text-muted-foreground/70">{fmtNum(rows.length)} total</span>
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
                            ['n', 'N', 'Responses collected vs the target range agreed with the client (minimum – maximum)'],
                            ['due_date', 'Due', 'Internal deadline'],
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
                    <tbody>{sortedRows.map((p, i) => renderProjectRow(p, i % 2 === 1))}</tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Rail — the person. Editing stays on the client roster, which owns the
            contact record; this page is the read-only view of it. */}
        <div className="flex flex-col gap-4">
          <div className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col gap-3">
            <h3 className="text-xs text-muted-foreground uppercase tracking-widest font-medium flex items-center">
              Contact
              <InfoTooltip text="Details come from this client's contact roster — edit them there (client page, Contacts card)." />
            </h3>
            <div className="flex flex-col gap-2">
              <DetailRow label="Title">
                {ct.title ?? <span className="text-muted-foreground/50">—</span>}
              </DetailRow>
              <DetailRow label="Email">
                {ct.email ? (
                  <a href={`mailto:${ct.email}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                    {ct.email}
                  </a>
                ) : (
                  <span className="text-muted-foreground/50">—</span>
                )}
              </DetailRow>
              <DetailRow label="Phone">
                {ct.phone ?? <span className="text-muted-foreground/50">—</span>}
              </DetailRow>
              <DetailRow label="Client">
                {client ? (
                  <Link href={`/clients/${client.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                    {client.name}
                    {client.code ? <span className="text-muted-foreground"> · {client.code}</span> : null}
                  </Link>
                ) : (
                  <span className="text-muted-foreground/50">—</span>
                )}
              </DetailRow>
              <DetailRow label="Added">{formatDate(ct.created_at.slice(0, 10))}</DetailRow>
            </div>
            {/* Occam invite — the gate that has to clear before this person's first
                delivery, so it reads as a plain yes/no on their own page. */}
            <div className="border-t border-border pt-3 flex flex-col gap-1">
              <span className="text-xs text-muted-foreground flex items-center">
                Occam invite
                <InfoTooltip text="An external contact needs an Occam account before they can view delivered data. Until this is confirmed, their first delivery is gated. Confirm it from the client page's contact roster." />
              </span>
              {ct.occam_invited ? (
                <span className="text-sm text-emerald-600 dark:text-emerald-400">
                  Invited ✓
                  {ct.occam_invited_at ? ` · ${formatDate(String(ct.occam_invited_at).slice(0, 10))}` : ''}
                  {ct.occam_invited_by ? (
                    <span className="text-muted-foreground"> by {ct.occam_invited_by}</span>
                  ) : null}
                </span>
              ) : (
                <span className="text-sm text-amber-600 dark:text-amber-400">
                  Not confirmed yet — their first delivery will prompt for it
                </span>
              )}
            </div>
            {ct.archived && (
              <p className="text-xs text-amber-600 dark:text-amber-400 border-t border-border pt-3">
                Archived contact — out of the Requested-by picker, but it still resolves on the surveys listed here.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
