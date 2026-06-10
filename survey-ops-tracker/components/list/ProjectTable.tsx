'use client'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { formatDate, getDueDateStatus } from '@/lib/utils/date'
import type { SurveyProject } from '@/lib/hooks/useProjects'

type SortField = 'project_name' | 'client' | 'board_column' | 'due_date'
type SortDir = 'asc' | 'desc'

const STAGE_BADGE: Record<string, string> = {
  'Submitted': 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  'Doc Programming': 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  'Survey Programming': 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  'EdWin QA': 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
  'Fielding': 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  'Data QA': 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  'Delivery': 'bg-muted-foreground/15 text-foreground/80',
}

const TYPE_BADGE: Record<string, string> = {
  'PS': 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  'B2B': 'bg-violet-500/20 text-violet-600 dark:text-violet-400',
  'Rerun': 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
}

interface ProjectTableProps {
  projects: SurveyProject[]
}

function FlagCell({ value, warn = false }: { value: boolean; warn?: boolean }) {
  return (
    <td className="px-4 py-3 text-xs">
      {value ? (
        <span className={warn ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>✓</span>
      ) : (
        <span className="text-muted-foreground/50">—</span>
      )}
    </td>
  )
}

export function ProjectTable({ projects }: ProjectTableProps) {
  const router = useRouter()
  const [sortField, setSortField] = useState<SortField>('due_date')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

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
    if (sortField !== field) return <span className="text-muted-foreground/50 ml-1">↕</span>
    return <span className="text-foreground/80 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const headers: { field: SortField | null; label: string }[] = [
    { field: 'project_name', label: 'Project' },
    { field: 'client', label: 'Client' },
    { field: null, label: 'Type' },
    { field: 'board_column', label: 'Stage' },
    { field: null, label: 'Captain' },
    { field: null, label: 'N / Target' },
    { field: null, label: 'N Actual' },
    { field: null, label: 'Long.' },
    { field: null, label: 'Voter QA' },
    { field: null, label: 'Citation' },
    { field: 'due_date', label: 'Due' },
  ]

  return (
    <div className="bg-card rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-background border-b border-border">
            {headers.map(({ field, label }) => (
              <th
                key={label}
                onClick={() => field && handleSort(field)}
                className={`px-4 py-3 text-left text-xs text-muted-foreground uppercase tracking-wider font-medium ${
                  field ? 'cursor-pointer hover:text-foreground' : ''
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
              <td colSpan={11} className="px-4 py-8 text-center text-muted-foreground text-sm">
                No projects found
              </td>
            </tr>
          )}
          {sorted.map((p, i) => {
            const dueDateStatus = getDueDateStatus(p.due_date)
            const nMet = p.n_target != null && p.n_collected >= p.n_target
            return (
              <tr
                key={p.id}
                onClick={() => router.push(`/projects/${p.id}`)}
                className={`border-t border-border cursor-pointer hover:bg-accent/50 transition-colors ${
                  i % 2 === 1 ? 'bg-muted/40' : ''
                } ${p.status === 'Hold' ? 'opacity-60' : ''}`}
              >
                <td className="px-4 py-3 text-sm text-foreground font-medium">
                  {p.status === 'Hold' && <span title="On hold">⏸ </span>}
                  {p.project_name}
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">{p.client}</td>
                <td className="px-4 py-3">
                  {p.project_type && (
                    <span className={`text-xs px-2 py-0.5 rounded ${TYPE_BADGE[p.project_type] ?? ''}`}>
                      {p.project_type}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded ${STAGE_BADGE[p.board_column] ?? 'bg-muted text-muted-foreground'}`}>
                    {p.board_column}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  {p.captain ? (
                    <span className="bg-muted text-foreground/80 text-xs px-2 py-0.5 rounded-full">
                      {p.captain.initials}
                    </span>
                  ) : (
                    <span className="text-red-600 dark:text-red-400 text-xs">!</span>
                  )}
                </td>
                <td className={`px-4 py-3 text-xs ${nMet ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                  {p.n_collected} / {p.n_target ?? '—'}
                  {nMet && ' ✓'}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {p.n_actual ?? '—'}
                </td>
                <FlagCell value={p.longitudinal ?? false} />
                <FlagCell value={p.voter_survey_qa ?? false} warn />
                <FlagCell value={p.citation_language_needed ?? false} warn />
                <td className={`px-4 py-3 text-xs ${
                  dueDateStatus === 'overdue' ? 'text-red-600 dark:text-red-400' :
                  dueDateStatus === 'soon' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
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
