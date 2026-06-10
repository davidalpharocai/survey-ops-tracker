'use client'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { formatDate, getDueDateStatus } from '@/lib/utils/date'
import type { SurveyProject } from '@/lib/hooks/useProjects'
import { useLatestSubmissionStatuses } from '@/lib/hooks/useSubmissions'

type SortField = 'project_name' | 'client' | 'board_column' | 'due_date'
type SortDir = 'asc' | 'desc'

const STAGE_BADGE: Record<string, string> = {
  'Submitted': 'bg-blue-500/15 text-blue-400',
  'Doc Programming': 'bg-amber-500/15 text-amber-400',
  'Survey Programming': 'bg-amber-500/15 text-amber-400',
  'EdWin QA': 'bg-cyan-500/15 text-cyan-400',
  'Fielding': 'bg-emerald-500/15 text-emerald-400',
  'Data QA': 'bg-violet-500/15 text-violet-400',
  'Delivery': 'bg-slate-500/15 text-slate-300',
}

const TYPE_BADGE: Record<string, string> = {
  'PS': 'bg-blue-500/20 text-blue-400',
  'B2B': 'bg-violet-500/20 text-violet-400',
  'Rerun': 'bg-emerald-500/20 text-emerald-400',
}

interface ProjectTableProps {
  projects: SurveyProject[]
}

export function ProjectTable({ projects }: ProjectTableProps) {
  const router = useRouter()
  const [sortField, setSortField] = useState<SortField>('due_date')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const { data: complianceStatuses } = useLatestSubmissionStatuses()

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const sorted = useMemo(() => {
    return [...projects].sort((a, b) => {
      const av = (a[sortField] ?? '') as string
      const bv = (b[sortField] ?? '') as string
      const cmp = av.localeCompare(bv)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [projects, sortField, sortDir])

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="text-slate-600 ml-1">↕</span>
    return <span className="text-slate-300 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const headers: { field: SortField | null; label: string }[] = [
    { field: 'project_name', label: 'Project' },
    { field: 'client', label: 'Client' },
    { field: null, label: 'Type' },
    { field: 'board_column', label: 'Stage' },
    { field: null, label: 'Captain' },
    { field: null, label: 'N / Target' },
    { field: 'due_date', label: 'Due' },
  ]

  return (
    <div className="bg-slate-900 rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-slate-950 border-b border-slate-800">
            {headers.map(({ field, label }) => (
              <th
                key={label}
                onClick={() => field && handleSort(field)}
                className={`px-4 py-3 text-left text-xs text-slate-500 uppercase tracking-wider font-medium ${
                  field ? 'cursor-pointer hover:text-slate-300' : ''
                }`}
              >
                {label}
                {field && <SortIcon field={field} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">
                No projects found
              </td>
            </tr>
          )}
          {sorted.map((p, i) => {
            const dueDateStatus = getDueDateStatus(p.due_date)
            const nMet = p.n_target != null && p.n_collected >= p.n_target
            const complianceStatus = complianceStatuses?.get(p.id)
            return (
              <tr
                key={p.id}
                onClick={() => router.push(`/projects/${p.id}`)}
                className={`border-t border-slate-800 cursor-pointer hover:bg-slate-800/50 transition-colors ${
                  i % 2 === 1 ? 'bg-slate-900/40' : ''
                }`}
              >
                <td className="px-4 py-3 text-sm text-slate-100 font-medium">
                  <div className="flex items-center gap-2">
                    {p.project_name}
                    {complianceStatus && (
                      <span
                        title={`Compliance: ${complianceStatus.replace('_', ' ')}`}
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          complianceStatus === 'approved'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : complianceStatus === 'rejected'
                              ? 'bg-red-500/20 text-red-400'
                              : 'bg-amber-500/20 text-amber-400'
                        }`}
                      >
                        {complianceStatus === 'pending_review' ? 'Compliance ⏳' : complianceStatus === 'approved' ? 'Compliance ✓' : 'Compliance ✕'}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-400">{p.client}</td>
                <td className="px-4 py-3">
                  {p.project_type && (
                    <span className={`text-xs px-2 py-0.5 rounded ${TYPE_BADGE[p.project_type] ?? ''}`}>
                      {p.project_type}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded ${STAGE_BADGE[p.board_column] ?? 'bg-slate-700 text-slate-400'}`}>
                    {p.board_column}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  {p.captain ? (
                    <span className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded-full">
                      {p.captain.initials}
                    </span>
                  ) : (
                    <span className="text-red-400 text-xs">!</span>
                  )}
                </td>
                <td className={`px-4 py-3 text-xs ${nMet ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {p.n_collected} / {p.n_target ?? '—'}
                  {nMet && ' ✓'}
                </td>
                <td className={`px-4 py-3 text-xs ${
                  dueDateStatus === 'overdue' ? 'text-red-400' :
                  dueDateStatus === 'soon' ? 'text-amber-400' : 'text-slate-400'
                }`}>
                  {dueDateStatus === 'overdue' && '⚠ '}
                  {formatDate(p.due_date)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
