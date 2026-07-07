'use client'
import { useMemo, useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useClients } from '@/lib/hooks/useClients'
import { useProjects } from '@/lib/hooks/useProjects'
import { useTeamMembers } from '@/lib/hooks/useTeamMembers'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { MasterAuditLog } from '@/components/admin/MasterAuditLog'
import { RecentlyDeleted } from '@/components/admin/RecentlyDeleted'
import { SprintCadence } from '@/components/admin/SprintCadence'
import { SystemStatus } from '@/components/admin/SystemStatus'
import { AiUsagePanel } from '@/components/admin/AiUsagePanel'
import { NewClientModal } from '@/components/client/NewClientModal'

const SUPABASE_PROJECT = 'xcfoyxyxovibltwfydbf'

const LINKS: { label: string; href: string; desc: string }[] = [
  {
    label: 'Supabase — Users',
    href: `https://supabase.com/dashboard/project/${SUPABASE_PROJECT}/auth/users`,
    desc: 'Add teammates and send password resets. New accounts must be @alpharoc.ai.',
  },
  {
    label: 'Supabase — Database & SQL Editor',
    href: `https://supabase.com/dashboard/project/${SUPABASE_PROJECT}/editor`,
    desc: 'The data itself: tables, SQL editor, daily backups.',
  },
  {
    label: 'Vercel — Deployments',
    href: 'https://vercel.com/alpha-roc/survey-ops-tracker',
    desc: 'Hosting. A bad deploy can be rolled back here (Promote previous to Production).',
  },
  {
    label: 'GitHub — Code',
    href: 'https://github.com/davidalpharocai/survey-ops-tracker',
    desc: 'Source code. Pushing to main publishes automatically.',
  },
  {
    label: 'Survey Ops sheet (legacy)',
    href: 'https://docs.google.com/spreadsheets/d/1ZTTJ0PQZ7vj13tmZmsMvKAcEEf0Nc0s8dVbfaYJju7Q',
    desc: 'The original spreadsheet. Client Ids (Cl#####) live in its Unique Clients tab.',
  },
  {
    label: 'User Guide',
    href: 'https://docs.google.com/document/d/1FtnUeytOj1OI54dEhB5ogmoIcVKK18c9E1FztwKpQXE/edit',
    desc: 'How to use the tracker.',
  },
  {
    label: 'Systems & Handover',
    href: 'https://docs.google.com/document/d/1rkT0KYApcvYU1BlK-TO_lfiXyhL0FuGIPz9UjduSJgk/edit',
    desc: 'Every system, account, and what-to-do-if-it-breaks runbook.',
  },
]

const tile = 'bg-card border border-border shadow-sm rounded-xl p-4'
const heading =
  'text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center'

// The Admin page groups many sections; tabs keep it scannable as it grows.
const ADMIN_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'accounts', label: 'Accounts & Team' },
  { key: 'operations', label: 'Operations' },
  { key: 'audit', label: 'Audit Log' },
] as const
type AdminTab = (typeof ADMIN_TABS)[number]['key']
const ADMIN_TAB_KEY = 'sot.adminTab'

export default function AdminPage() {
  const router = useRouter()
  const { data: projects = [] } = useProjects()
  const { data: clients = [], isLoading: clientsLoading } = useClients()
  const { data: teamMembers = [] } = useTeamMembers()
  const [showNewClient, setShowNewClient] = useState(false)

  // Slim projects carry the contact-level text ("BAM - Jeff Cummings");
  // clients are firm-level, so group by the firm prefix before " - ".
  const firmStats = useMemo(() => {
    const stats = new Map<string, { total: number; activePipeline: number; activeScoping: number; closed: number }>()
    for (const p of projects) {
      const key = p.client.split(' - ')[0].trim().toLowerCase()
      const s = stats.get(key) ?? { total: 0, activePipeline: 0, activeScoping: 0, closed: 0 }
      s.total++
      if (p.status === 'Closed') s.closed++
      else if (p.phase === 'Scoping') s.activeScoping++
      else s.activePipeline++
      stats.set(key, s)
    }
    return stats
  }, [projects])

  // Account buckets per David: Prospect = only scoping activity, no other
  // active projects. Client = active pipeline work. Former = closed work only.
  type Bucket = 'client' | 'former' | 'prospect' | 'none'
  function bucketOf(name: string): Bucket {
    const s = firmStats.get(name.trim().toLowerCase())
    if (!s) return 'none'
    if (s.activePipeline > 0) return 'client'
    if (s.activeScoping > 0) return 'prospect'
    if (s.closed > 0) return 'former'
    return 'none'
  }
  const bucketCounts = useMemo(() => {
    const counts = { client: 0, former: 0, prospect: 0, none: 0 }
    for (const c of clients) counts[bucketOf(c.name)]++
    return counts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, firmStats])

  const BUCKET_BADGE: Record<Bucket, { label: string; cls: string; help: string }> = {
    client: {
      label: 'Client',
      cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
      help: 'Has active projects in the pipeline right now.',
    },
    prospect: {
      label: 'Prospect',
      cls: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
      help: 'Only scoping-phase projects — a deal in the works, nothing else active.',
    },
    former: {
      label: 'Former',
      cls: 'bg-muted text-muted-foreground',
      help: 'Past projects only — nothing active. A re-engagement candidate.',
    },
    none: {
      label: 'No projects',
      cls: 'text-muted-foreground/50',
      help: 'On the approved account list but no projects recorded yet.',
    },
  }

  const [accountFilter, setAccountFilter] = useState<Bucket | null>(null)
  const [complianceOnly, setComplianceOnly] = useState(false)
  const requiresCompliance = (c: { compliance_before_fielding?: boolean; compliance_after_fielding?: boolean }) =>
    !!c.compliance_before_fielding || !!c.compliance_after_fielding
  const complianceCount = clients.filter(requiresCompliance).length
  const visibleClients = clients.filter(c => {
    if (accountFilter && bucketOf(c.name) !== accountFilter) return false
    if (complianceOnly && !requiresCompliance(c)) return false
    return true
  })

  const health = useMemo(() => {
    const open = projects.filter(p => p.status === 'Open')
    return {
      noCaptain: open.filter(p => !p.captain && p.phase !== 'Scoping'),
      noDue: open.filter(p => !p.due_date && p.phase !== 'Scoping'),
      onHold: projects.filter(p => p.status === 'Hold'),
    }
  }, [projects])

  const [tab, setTab] = useState<AdminTab>('overview')
  useEffect(() => {
    const saved = localStorage.getItem(ADMIN_TAB_KEY)
    if (saved && ADMIN_TABS.some(t => t.key === saved)) setTab(saved as AdminTab)
  }, [])
  function changeTab(t: AdminTab) {
    setTab(t)
    localStorage.setItem(ADMIN_TAB_KEY, t)
  }

  return (
    <>
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-foreground">Admin</h1>
        <span className="text-sm text-muted-foreground">
          Operational controls, reference data, and the systems behind the tracker.
        </span>
      </div>

      {/* Tabs — keep the growing page scannable */}
      <div className="flex bg-muted border border-border rounded-lg p-1 gap-1 w-fit flex-wrap">
        {ADMIN_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => changeTab(t.key)}
            className={`text-sm px-3 py-1.5 rounded font-medium transition-colors ${
              tab === t.key ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
      {/* Quick links */}
      <div className={tile}>
        <h3 className={heading}>
          Systems
          <InfoTooltip text="The dashboards behind the tracker. Full context, accounts, and runbooks live in the Systems & Handover doc." />
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {LINKS.map(l => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="border border-border rounded-lg px-3 py-2 hover:bg-accent transition-colors group"
            >
              <span className="text-sm font-medium text-foreground group-hover:text-foreground flex items-center justify-between">
                {l.label}
                <span className="text-xs text-muted-foreground">↗</span>
              </span>
              <span className="text-xs text-muted-foreground leading-snug">{l.desc}</span>
            </a>
          ))}
        </div>
      </div>

      {/* Operational health — backend jobs + AI spend, side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <SystemStatus />
        <AiUsagePanel />
      </div>

      {/* Data health */}
      <div className={tile}>
        <h3 className={heading}>
          Data health
          <InfoTooltip text="Open pipeline projects with gaps worth fixing. Click a name to open it." />
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
          <HealthList label="No captain" items={health.noCaptain} empty="Every open project has a captain" />
          <HealthList label="No due date" items={health.noDue} empty="Every open project has a due date" />
          <HealthList label="On hold" items={health.onHold} empty="Nothing on hold" />
        </div>
      </div>
        </>
      )}

      {tab === 'operations' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <SprintCadence />
          <RecentlyDeleted />
        </div>
      )}

      {tab === 'audit' && <MasterAuditLog />}

      {tab === 'accounts' && (
        <>
      {/* Accounts */}
      <div className={tile}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className={`${heading} mb-0`}>
            Accounts ({clients.length})
            <InfoTooltip text="Every approved account with its Cl##### id (same ids as the sheet's Unique Clients tab). Click one for its client page — projects, spend, and history." />
          </h3>
          <button
            onClick={() => setShowNewClient(true)}
            title="Add a new client directly. It gets a Cl##### id automatically."
            className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors shrink-0"
          >
            + New Client
          </button>
        </div>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {([
            { key: 'client' as Bucket, label: 'Clients', count: bucketCounts.client },
            { key: 'former' as Bucket, label: 'Former Clients', count: bucketCounts.former },
            { key: 'prospect' as Bucket, label: 'Prospects', count: bucketCounts.prospect },
            ...(bucketCounts.none > 0
              ? [{ key: 'none' as Bucket, label: 'No projects yet', count: bucketCounts.none }]
              : []),
          ]).map(({ key, label, count }) => {
            const active = accountFilter === key
            return (
              <button
                key={key}
                onClick={() => setAccountFilter(active ? null : key)}
                title={`${BUCKET_BADGE[key].help} Click to ${active ? 'show all accounts' : 'filter to these'}.`}
                className={`text-sm flex items-center gap-1 px-2 py-1 rounded-lg border transition-colors ${
                  active
                    ? 'border-ring bg-accent text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-ring'
                }`}
              >
                <span className="text-foreground font-semibold">{count}</span> {label}
              </button>
            )
          })}
          {complianceCount > 0 && (
            <button
              onClick={() => setComplianceOnly(v => !v)}
              title={`Clients with a compliance requirement. Click to ${complianceOnly ? 'show all accounts' : 'filter to these'}.`}
              className={`text-sm flex items-center gap-1 px-2 py-1 rounded-lg border transition-colors ${
                complianceOnly
                  ? 'border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-ring'
              }`}
            >
              <span className="font-semibold">{complianceCount}</span> 🛡 Compliance
            </button>
          )}
          {(accountFilter || complianceOnly) && (
            <button
              onClick={() => { setAccountFilter(null); setComplianceOnly(false) }}
              className="text-xs text-muted-foreground hover:text-foreground px-1 transition-colors"
              title="Clear the account filter"
            >
              ✕ clear
            </button>
          )}
        </div>
        {clientsLoading ? (
          <p className="text-xs text-muted-foreground/50">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 max-h-[20rem] overflow-y-auto thin-scroll pr-1">
            {visibleClients.length === 0 && (
              <p className="text-xs text-muted-foreground/50">No accounts in this status.</p>
            )}
            {visibleClients.map(c => {
              const count = firmStats.get(c.name.trim().toLowerCase())?.total ?? 0
              const bucket = bucketOf(c.name)
              const badge = BUCKET_BADGE[bucket]
              const compLabel = c.compliance_before_fielding && c.compliance_after_fielding
                ? 'before + after fielding'
                : c.compliance_before_fielding
                  ? 'before fielding'
                  : c.compliance_after_fielding
                    ? 'after fielding'
                    : null
              return (
                <Link
                  key={c.id}
                  href={`/clients/${c.id}`}
                  title={`Open ${c.name}'s client page — projects, spend, and history. ${badge.help}`}
                  className="flex items-center justify-between gap-2 py-1 border-b border-border/40 last:border-0 hover:bg-accent/50 rounded px-1 -mx-1 transition-colors group"
                >
                  <span className="text-sm text-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400 truncate transition-colors">
                    {c.name}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    {bucket !== 'none' && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
                    )}
                    {count > 0 && (
                      <span className="text-xs text-muted-foreground">{count} project{count > 1 ? 's' : ''}</span>
                    )}
                    {compLabel && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 whitespace-nowrap"
                        title={`Compliance review required: ${compLabel}. Client ID is on the client page.`}
                      >
                        🛡 Compliance
                      </span>
                    )}
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* Roster */}
      <div className={tile}>
        <h3 className={heading}>
          Team roster
          <InfoTooltip text="Everyone the tracker knows. Members marked (former employee) stay for history but can't be assigned to projects. Logins are managed in Supabase — Users." />
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 max-h-[16rem] overflow-y-auto thin-scroll pr-1">
          {teamMembers.map(m => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-2 py-1 border-b border-border/40 last:border-0"
            >
              <span className="text-sm text-foreground truncate">
                <span className="text-xs font-mono text-muted-foreground mr-2">{m.initials}</span>
                {m.name}
              </span>
              <span className="text-xs text-muted-foreground shrink-0">{m.email}</span>
            </div>
          ))}
        </div>
      </div>
        </>
      )}

      <p className="text-xs text-muted-foreground/60">
        Looking for something else here? Tell Claude — this page is meant to grow.
      </p>
    </div>
    {showNewClient && (
      <NewClientModal
        onClose={() => setShowNewClient(false)}
        onCreated={created => router.push(`/clients/${created.id}`)}
      />
    )}
    </>
  )
}

function HealthList({
  label,
  items,
  empty,
}: {
  label: string
  items: { id: string; project_name: string }[]
  empty: string
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5 flex flex-col min-w-0">
      <p className="text-xs text-muted-foreground mb-1.5 shrink-0">
        {label} <span className="text-foreground font-medium">({items.length})</span>
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground/50">✓ {empty}</p>
      ) : (
        <div className="max-h-[11rem] overflow-y-auto thin-scroll pr-1 min-w-0 space-y-0.5">
          {items.map(p => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="block text-sm text-blue-600 dark:text-blue-400 hover:underline truncate"
            >
              {p.project_name}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
