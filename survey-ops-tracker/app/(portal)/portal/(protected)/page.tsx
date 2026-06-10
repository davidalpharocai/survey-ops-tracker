import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const STATUS_BADGE: Record<string, string> = {
  pending_review: 'bg-amber-500/20 text-amber-400',
  approved: 'bg-emerald-500/20 text-emerald-400',
  rejected: 'bg-red-500/20 text-red-400',
}
const STATUS_LABEL: Record<string, string> = {
  pending_review: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected',
}

export default async function PortalQueuePage() {
  const supabase = await createClient()

  const { data: submissions } = await supabase
    .from('question_submissions')
    .select('id, project_id, version, status, submitted_at')
    .order('submitted_at', { ascending: false })

  const projectIds = [...new Set((submissions ?? []).map(s => s.project_id))]
  let projects: { id: string; project_name: string }[] = []
  if (projectIds.length) {
    const { data } = await supabase
      .from('portal_projects')
      .select('id, project_name')
      .in('id', projectIds)
    projects = data ?? []
  }
  const nameById = new Map(projects.map(p => [p.id, p.project_name]))

  const pending = (submissions ?? []).filter(s => s.status === 'pending_review')
  const decided = (submissions ?? []).filter(s => s.status !== 'pending_review')

  function Row({ s }: { s: NonNullable<typeof submissions>[number] }) {
    return (
      <Link
        href={`/portal/review/${s.id}`}
        className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 hover:border-slate-600 transition-colors"
      >
        <div>
          <p className="text-sm text-white font-medium">{nameById.get(s.project_id) ?? 'Survey project'}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Version {s.version} · submitted {new Date(s.submitted_at).toLocaleDateString()}
          </p>
        </div>
        <span className={`text-xs px-2 py-1 rounded ${STATUS_BADGE[s.status]}`}>
          {STATUS_LABEL[s.status]}
        </span>
      </Link>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-xs text-slate-400 uppercase tracking-widest mb-3 font-medium">
          Awaiting your review
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing waiting for review right now.</p>
        ) : (
          <div className="flex flex-col gap-2">{pending.map(s => <Row key={s.id} s={s} />)}</div>
        )}
      </section>
      <section>
        <h2 className="text-xs text-slate-400 uppercase tracking-widest mb-3 font-medium">
          History
        </h2>
        {decided.length === 0 ? (
          <p className="text-sm text-slate-500">No completed reviews yet.</p>
        ) : (
          <div className="flex flex-col gap-2">{decided.map(s => <Row key={s.id} s={s} />)}</div>
        )}
      </section>
    </div>
  )
}
