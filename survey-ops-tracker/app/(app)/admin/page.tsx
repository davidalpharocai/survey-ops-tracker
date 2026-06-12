'use client'
import { useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useProjects } from '@/lib/hooks/useProjects'
import { useTeamMembers } from '@/lib/hooks/useTeamMembers'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import type { Tables } from '@/lib/supabase/types'

type Client = Tables<'clients'>

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

function useClients() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').order('name')
      if (error) throw error
      return data as Client[]
    },
  })
}

const tile = 'bg-card border border-border shadow-sm rounded-xl p-4'
const heading =
  'text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center'

export default function AdminPage() {
  const { data: projects = [] } = useProjects()
  const { data: clients = [], isLoading: clientsLoading } = useClients()
  const { data: teamMembers = [] } = useTeamMembers()

  const projectCountByClientId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of projects) {
      const cid = (p as { client_id?: string | null }).client_id
      if (cid) counts.set(cid, (counts.get(cid) ?? 0) + 1)
    }
    return counts
  }, [projects])

  // Slim projects don't carry client_id — fall back to name matching for counts
  const projectCountByClientName = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of projects) {
      const key = p.client.trim().toLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [projects])

  const health = useMemo(() => {
    const open = projects.filter(p => p.status === 'Open')
    return {
      noCaptain: open.filter(p => !p.captain && p.phase !== 'Scoping'),
      noDue: open.filter(p => !p.due_date && p.phase !== 'Scoping'),
      onHold: projects.filter(p => p.status === 'Hold'),
    }
  }, [projects])

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-foreground">Admin</h1>
        <span className="text-sm text-muted-foreground">
          Operational controls, reference data, and the systems behind the tracker.
        </span>
      </div>

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

      {/* Data health */}
      <div className={tile}>
        <h3 className={heading}>
          Data health
          <InfoTooltip text="Open pipeline projects with gaps worth fixing. Click a name to open it." />
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <HealthList label="No captain" items={health.noCaptain} empty="Every open project has a captain" />
          <HealthList label="No due date" items={health.noDue} empty="Every open project has a due date" />
          <HealthList label="On hold" items={health.onHold} empty="Nothing on hold" />
        </div>
      </div>

      {/* Clients */}
      <div className={tile}>
        <h3 className={heading}>
          Clients ({clients.length})
          <InfoTooltip text="The client list with their Cl##### ids (same ids as the sheet's Unique Clients tab). Cleanup pending — duplicates and contact-level entries will be consolidated." />
        </h3>
        {clientsLoading ? (
          <p className="text-xs text-muted-foreground/50">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            {clients.map(c => {
              const count =
                projectCountByClientId.get(c.id) ??
                projectCountByClientName.get(c.name.trim().toLowerCase()) ??
                0
              return (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-2 py-1 border-b border-border/40 last:border-0"
                >
                  <span className="text-sm text-foreground truncate">{c.name}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    {count > 0 && (
                      <span className="text-xs text-muted-foreground">{count} project{count > 1 ? 's' : ''}</span>
                    )}
                    <span className="text-xs font-mono text-muted-foreground w-16 text-right">
                      {c.code ?? '—'}
                    </span>
                  </span>
                </div>
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
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

      <p className="text-xs text-muted-foreground/60">
        Looking for something else here? Tell Claude — this page is meant to grow.
      </p>
    </div>
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
    <div>
      <p className="text-xs text-muted-foreground mb-1.5">
        {label} <span className="text-foreground font-medium">({items.length})</span>
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground/50">✓ {empty}</p>
      ) : (
        <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
          {items.map(p => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline truncate"
            >
              {p.project_name}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
