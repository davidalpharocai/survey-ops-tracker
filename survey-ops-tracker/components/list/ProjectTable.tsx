'use client'
import { useState, useMemo, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { formatDate, getDueUrgency, daysOverdue, urgencyPrefix, BADLY_OVERDUE_DAYS } from '@/lib/utils/date'
import type { SlimProject } from '@/lib/hooks/useProjects'
import { useLatestSubmissionStatuses } from '@/lib/hooks/useSubmissions'

export type SortField = 'project_name' | 'client' | 'board_column' | 'due_date'
export type SortDir = 'asc' | 'desc'

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

// Urgency shows as a strong LEFT accent bar on the row (first cell), matching
// the board cards — not a full rectangle, which fused adjacent overdue rows
// into one merged box. Badly-overdue rows additionally get a light red tint.
const URGENCY_LEFT_BAR: Record<string, string> = {
  overdue: 'border-l-4 border-l-red-500',
  tomorrow: 'border-l-4 border-l-orange-500',
  twodays: 'border-l-4 border-l-amber-400 dark:border-l-amber-400/70',
}

interface ProjectTableProps {
  projects: SlimProject[]
  // Controlled by the list page so they can be captured in saved views
  hiddenCols: Set<string>
  onToggleCol: (key: string) => void
  sortField: SortField
  sortDir: SortDir
  onSortChange: (field: SortField, dir: SortDir) => void
}

function FlagCell({ value, warn = false, className = '' }: { value: boolean; warn?: boolean; className?: string }) {
  return (
    <td className={`px-4 py-3 text-xs ${className}`}>
      {value ? (
        <span className={warn ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>✓</span>
      ) : (
        <span className="text-muted-foreground/50">—</span>
      )}
    </td>
  )
}

export function ProjectTable({
  projects,
  hiddenCols,
  onToggleCol,
  sortField,
  sortDir,
  onSortChange,
}: ProjectTableProps) {
  const router = useRouter()
  const { data: complianceStatuses } = useLatestSubmissionStatuses()

  const [colsOpen, setColsOpen] = useState(false)
  const colsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!colsOpen) return
    function onPointerDown(e: PointerEvent) {
      if (colsRef.current && !colsRef.current.contains(e.target as Node)) setColsOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [colsOpen])
  const show = (key: string) => !hiddenCols.has(key)

  function handleSort(field: SortField) {
    onSortChange(field, sortField === field ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc')
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
    if (sortField !== field) return <span className="text-muted-foreground ml-1">↕</span>
    return <span className="text-foreground/80 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  // key: hideable column id (null = always shown)
  const headers: { key: string | null; field: SortField | null; label: string; title: string }[] = [
    { key: null, field: 'project_name', label: 'Project', title: 'Project name. ⏸ marks projects on hold.' },
    { key: 'client', field: 'client', label: 'Client', title: 'The client this project is for.' },
    { key: 'type', field: null, label: 'Type', title: 'PS = PureSpectrum consumer panel, B2B = expert/business panel, Rerun = repeat wave of an earlier study.' },
    { key: 'stage', field: 'board_column', label: 'Stage', title: 'Current pipeline stage, from Submitted through Delivery.' },
    { key: 'captain', field: null, label: 'Captain', title: 'Team member responsible for the project end-to-end. ! = unassigned.' },
    { key: 'n', field: null, label: 'N / Target', title: 'Responses collected so far (auto-synced) vs the response goal.' },
    { key: 'nActual', field: null, label: 'N Actual', title: 'Usable responses after data cleaning.' },
    { key: 'long', field: null, label: 'Long.', title: 'Longitudinal — study tracked across multiple waves.' },
    { key: 'voterQA', field: null, label: 'Voter QA', title: 'Whether the project needs the extra voter-survey QA pass.' },
    { key: 'citation', field: null, label: 'Citation', title: 'Whether deliverables need citation language.' },
    { key: 'due', field: 'due_date', label: 'Due', title: 'Internal deadline — when our work must be done.' },
  ]
  const visibleHeaders = headers.filter(h => h.key === null || show(h.key))

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl overflow-hidden">
      <div className="flex justify-end px-2 pt-2 relative" ref={colsRef}>
        <button
          onClick={() => setColsOpen(o => !o)}
          title="Choose which columns you see — personal to you, remembered in this browser"
          className="text-xs text-muted-foreground hover:text-foreground border border-border hover:border-ring rounded px-2 py-1 transition-colors"
        >
          ⚙ Columns
        </button>
        {colsOpen && (
          <div className="absolute right-2 top-full mt-1 z-40 bg-popover border border-border rounded-lg shadow-xl p-2 flex flex-col gap-1 w-44">
            {headers
              .filter(h => h.key !== null)
              .map(h => (
                <label
                  key={h.key}
                  className="flex items-center gap-2 text-sm text-foreground/90 hover:bg-accent rounded px-1.5 py-1 cursor-pointer"
                  title={h.title}
                >
                  <input
                    type="checkbox"
                    checked={show(h.key!)}
                    onChange={() => onToggleCol(h.key!)}
                    className="accent-blue-600"
                  />
                  {h.label}
                </label>
              ))}
          </div>
        )}
      </div>
      <div className="overflow-auto thin-scroll max-h-[calc(100vh-16rem)]">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            {visibleHeaders.map(({ field, label, title }) => (
              <th
                key={label}
                title={field ? `${title} Click to sort.` : title}
                onClick={() => field && handleSort(field)}
                className={`sticky top-0 z-10 bg-background px-4 py-3 text-left text-xs text-muted-foreground uppercase tracking-wider font-medium border-b border-border ${
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
              <td colSpan={visibleHeaders.length} className="px-4 py-8 text-center text-muted-foreground text-sm">
                No projects found
              </td>
            </tr>
          )}
          {sorted.map((p, i) => {
            // Closed/Hold projects drop the due urgency treatment
            const openDue = p.status === 'Open'
            const urgency = openDue ? getDueUrgency(p.due_date) : null
            const nMet = p.n_target != null && p.n_collected >= p.n_target
            const complianceStatus = complianceStatuses?.get(p.id)
            // Left accent on the first cell only (matches the board) — no full
            // rectangle, so adjacent overdue rows no longer fuse into one box.
            const badlyOverdue = urgency === 'overdue' && daysOverdue(p.due_date) > BADLY_OVERDUE_DAYS
            const leftBar = urgency ? URGENCY_LEFT_BAR[urgency] : ''
            const dueColor =
              urgency === 'overdue'
                ? 'text-red-600 dark:text-red-400'
                : urgency === 'tomorrow' || urgency === 'twodays'
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground'
            // Row background: badly-overdue tint wins over the zebra stripe.
            const rowBg = badlyOverdue ? 'bg-red-500/5' : i % 2 === 1 ? 'bg-muted/70' : ''
            return (
              <tr
                key={p.id}
                role="button"
                tabIndex={0}
                aria-label={`Open ${p.project_name}`}
                onClick={() => router.push(`/projects/${p.id}`)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    router.push(`/projects/${p.id}`)
                  }
                }}
                className={`border-t border-border cursor-pointer hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring transition-colors ${rowBg} ${
                  p.status === 'Hold' ? 'opacity-60' : ''
                }`}
              >
                <td className={`px-4 py-3 text-sm text-foreground font-medium ${leftBar}`}>
                  <div className="flex items-center gap-2">
                    <span>
                      {p.status === 'Hold' && <span title="On hold">⏸ </span>}
                      {p.project_name}
                    </span>
                    {p.project_code && (
                      <span
                        className="text-xs font-mono text-muted-foreground shrink-0"
                        title="Project ID — permanent reference"
                      >
                        {p.project_code}
                      </span>
                    )}
                    {complianceStatus && (
                      <span
                        title={`Compliance: ${complianceStatus.replace('_', ' ')}`}
                        className={`text-xs px-1.5 py-0.5 rounded whitespace-nowrap ${
                          complianceStatus === 'approved'
                            ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                            : complianceStatus === 'rejected'
                              ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                              : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {complianceStatus === 'pending_review' ? 'Compliance ⏳' : complianceStatus === 'approved' ? 'Compliance ✓' : 'Compliance ✕'}
                      </span>
                    )}
                  </div>
                </td>
                {show('client') && (
                  <td className="px-4 py-3 text-sm text-muted-foreground">{p.client}</td>
                )}
                {show('type') && (
                  <td className="px-4 py-3">
                    {p.project_type && (
                      <span className={`text-xs px-2 py-0.5 rounded ${TYPE_BADGE[p.project_type] ?? ''}`}>
                        {p.project_type}
                      </span>
                    )}
                  </td>
                )}
                {show('stage') && (
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded ${STAGE_BADGE[p.board_column] ?? 'bg-muted text-muted-foreground'}`}>
                      {p.board_column}
                    </span>
                  </td>
                )}
                {show('captain') && (
                  <td className="px-4 py-3 text-sm">
                    {p.captain ? (
                      <span className="bg-muted text-foreground/80 text-xs px-2 py-0.5 rounded-full">
                        {p.captain.initials}
                      </span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400 text-xs">!</span>
                    )}
                  </td>
                )}
                {show('n') && (
                  <td className={`px-4 py-3 text-xs ${nMet ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                    {p.n_target == null && !p.n_collected ? (
                      <span className="text-muted-foreground/50">—</span>
                    ) : (
                      <>
                        {p.n_collected} / {p.n_target ?? '—'}
                        {nMet && ' ✓'}
                      </>
                    )}
                  </td>
                )}
                {show('nActual') && (
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {p.n_actual ?? '—'}
                  </td>
                )}
                {show('long') && <FlagCell value={p.longitudinal ?? false} />}
                {show('voterQA') && <FlagCell value={p.voter_survey_qa ?? false} warn />}
                {show('citation') && <FlagCell value={p.citation_language_needed ?? false} warn />}
                {show('due') && (
                  <td className={`px-4 py-3 text-xs whitespace-nowrap ${dueColor}`}>
                    {urgencyPrefix(urgency, p.due_date)}
                    {formatDate(p.due_date)}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
    </div>
  )
}
