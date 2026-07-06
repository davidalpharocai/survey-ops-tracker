'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useUpdateClient } from '@/lib/hooks/useClients'
import { ClientContacts } from '@/components/client/ClientContacts'
import { ClientNotes } from '@/components/client/ClientNotes'
import { ClientNameHeading } from '@/components/client/ClientNameHeading'
import { MergeButton } from '@/components/merge/MergeButton'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Skeleton } from '@/components/shared/Skeleton'
import { formatDate } from '@/lib/utils/date'
import { fmtNum } from '@/lib/utils/number'
import type { Tables } from '@/lib/supabase/types'

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
  submitted_date: string | null
  due_date: string | null
  deliver_date: string | null
  created_at: string
  updated_at: string
  budget: number | null
  actual_spend: number | null
  n_target: number | null
  n_collected: number
  n_actual: number | null
}

const PROJECT_COLS =
  'id, project_code, project_name, client, status, phase, board_column, project_type, submitted_date, due_date, deliver_date, created_at, updated_at, budget, actual_spend, n_target, n_collected, n_actual'

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
  return { client, projects }
}

function money(v: number | null): string {
  if (v == null) return '—'
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

// Editable compliance requirement for the client. Sourced initially from the
// sheet's Compliance tab; the app is the source of truth thereafter.
function ClientComplianceCard({ client }: { client: Client }) {
  const update = useUpdateClient()
  const [contact, setContact] = useState(client.compliance_contact ?? '')
  const [notes, setNotes] = useState(client.compliance_notes ?? '')
  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col gap-3">
      <h3 className="text-xs text-muted-foreground uppercase tracking-widest font-medium flex items-center">
        Compliance
        <InfoTooltip text="When set, this client's surveys are blocked from being fielded (before) or delivered (after) until the matching compliance review is approved. Seeded from the sheet's Compliance tab; editable here." />
      </h3>
      <div className="flex flex-col gap-2 text-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={client.compliance_before_fielding}
            onChange={e => update.mutate({ id: client.id, updates: { compliance_before_fielding: e.target.checked } })}
            className="accent-blue-600"
          />
          <span className="text-foreground">Review required <span className="text-muted-foreground">before fielding</span> — questions only</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={client.compliance_after_fielding}
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
    </div>
  )
}

/** Earliest meaningful date for a project — submitted if known, else record creation. */
function projectDate(p: ClientProject): string {
  return p.submitted_date ?? p.created_at.slice(0, 10)
}

const tile = 'bg-card border border-border shadow-sm rounded-xl p-3 flex flex-col gap-1'

export default function ClientPage() {
  const params = useParams()
  const router = useRouter()
  const clientId = params.id as string
  const { client, projects } = useClientPage(clientId)
  const rows = useMemo(() => projects.data ?? [], [projects.data])

  const stats = useMemo(() => {
    if (rows.length === 0) return null
    const dates = rows.map(projectDate).sort()
    const open = rows.filter(p => p.status === 'Open')
    const withSpend = rows.filter(p => p.actual_spend != null && p.actual_spend > 0)
    const totalSpend = withSpend.reduce((s, p) => s + (p.actual_spend ?? 0), 0)
    const totalBudget = rows.reduce((s, p) => s + (p.budget ?? 0), 0)
    // average gap between consecutive project starts — the "do they keep coming back" number
    let avgGapDays: number | null = null
    if (dates.length > 1) {
      const ms = dates.map(d => new Date(d).getTime())
      avgGapDays = Math.round((ms[ms.length - 1] - ms[0]) / (dates.length - 1) / 86_400_000)
    }
    return {
      since: dates[0],
      last: dates[dates.length - 1],
      open: open.length,
      hold: rows.filter(p => p.status === 'Hold').length,
      closed: rows.filter(p => p.status === 'Closed').length,
      totalSpend,
      avgSpend: withSpend.length > 0 ? totalSpend / withSpend.length : null,
      spendCount: withSpend.length,
      totalBudget,
      avgGapDays,
    }
  }, [rows])

  if (client.isLoading || projects.isLoading) {
    return (
      <div className="max-w-5xl mx-auto flex flex-col gap-4">
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

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
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

      <ClientComplianceCard client={c} />

      <ClientContacts clientId={clientId} />

      <ClientNotes clientId={clientId} />

      {rows.length === 0 ? (
        <div className="bg-card border border-border shadow-sm rounded-xl p-6 text-sm text-muted-foreground">
          No projects yet for this client — it&apos;s on the approved client list, ready for its first project.
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
            <table className="w-full">
              <thead>
                <tr className="bg-background border-b border-border">
                  {[
                    ['ID', 'Permanent project ID'],
                    ['Project', 'Click any row to open the project'],
                    ['Status', 'Open / Hold / Closed, with the pipeline stage for open projects'],
                    ['Submitted', 'When the project entered the pipeline'],
                    ['N', 'Responses collected vs target'],
                    ['Spend', 'Actual spend (internal)'],
                  ].map(([label, title]) => (
                    <th
                      key={label}
                      title={title}
                      className="px-4 py-3 text-left text-xs text-muted-foreground uppercase tracking-wider font-medium"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => (
                  <tr
                    key={p.id}
                    onClick={() => router.push(`/projects/${p.id}`)}
                    className={`border-t border-border cursor-pointer hover:bg-accent/50 transition-colors ${
                      i % 2 === 1 ? 'bg-muted/40' : ''
                    }`}
                  >
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">
                      {p.project_code ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground font-medium">
                      {p.status === 'Hold' && <span title="On hold">⏸ </span>}
                      {p.project_name}
                      {p.project_type && (
                        <span className="ml-2 text-xs text-muted-foreground">{p.project_type}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {p.status === 'Open' ? (
                        <span className="text-xs px-2 py-1 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                          {p.phase === 'Scoping' ? 'Scoping' : p.board_column}
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground">
                          {p.status === 'Hold' ? 'On hold' : 'Closed'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                      {formatDate(p.submitted_date)}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                      {fmtNum(p.n_collected)}{p.n_target != null ? ` / ${fmtNum(p.n_target)}` : ''}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                      {money(p.actual_spend)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
