'use client'

import { useEffect } from 'react'
import { fmtNum } from '@/lib/utils/number'
import { describeRange, type DateBasis, type Range } from '@/lib/sales/dateRange'
import { BUCKETS } from '@/lib/sales/buckets'
import type { SalesRow } from './SalesPipeline'

/**
 * The printed survey list — the cross-account counterpart to the account report.
 *
 * STATES ITS OWN FILTER, in full: the group, the date basis and range, any
 * account or stage chips, and the search text. A table of 40 rows sent to a
 * client is only checkable if the reader can see what produced it, and the
 * sender needs to know too — "everything we delivered last quarter" and
 * "everything ACTIVE we delivered last quarter" are different documents that
 * look identical once printed.
 */

const COLS = [
  { id: 'code', label: 'Code', num: false },
  { id: 'survey', label: 'Survey', num: false },
  { id: 'client', label: 'Account', num: false },
  { id: 'requested', label: 'Requested by', num: false },
  { id: 'stage', label: 'Stage', num: false },
  { id: 'target', label: 'Target', num: true },
  { id: 'collected', label: 'Collected', num: true },
  { id: 'credits', label: 'Credits', num: true },
  { id: 'deliver', label: 'Delivered', num: false },
] as const

function cell(r: SalesRow, id: string): string {
  const stage = r.status !== 'Open' ? r.status
    : r.board_column === 'Delivery' || r.delivered_at ? 'Delivered'
    : r.board_column
  switch (id) {
    case 'code': return r.project_code ?? '—'
    case 'survey': return r.project_name
    case 'client': return r.client ?? '—'
    case 'requested': return r.requested_by_name ?? '—'
    case 'stage': return stage
    case 'target':
      return r.n_target == null ? '—'
        : r.n_target_max && r.n_target_max !== r.n_target
          ? `${fmtNum(r.n_target)}–${fmtNum(r.n_target_max)}`
          : fmtNum(r.n_target)
    case 'collected': { const v = r.n_actual ?? r.n_collected; return v == null ? '—' : fmtNum(v) }
    // Blank, never 0 — an unpriced survey is not a free one, and this page goes
    // to the client.
    case 'credits': return r.credits == null ? '—' : fmtNum(r.credits)
    case 'deliver': return (r.delivered_at ?? '').slice(0, 10) || r.deliver_date || '—'
    default: return ''
  }
}

export function SurveyListPrint({
  rows, totalBeforeDates, undated, basis, range, cols, bucket, clients, stages, search,
  salesperson, generatedOn, generatedBy,
}: {
  rows: SalesRow[]
  totalBeforeDates: number
  undated: number
  basis: DateBasis
  range: Range
  cols: string[]
  bucket: string
  clients: string[]
  stages: string[]
  search: string
  salesperson: string | null
  generatedOn: string
  generatedBy: string
}) {
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => window.print()))
    return () => cancelAnimationFrame(id)
  }, [])

  const shown = COLS.filter(c => (cols.length ? cols.includes(c.id) || c.id === 'survey' : true))
  const bucketLabel = bucket === 'all' ? 'All surveys' : (BUCKETS.find(b => b.id === bucket)?.label ?? bucket)
  const creditTotal = rows.reduce((t, r) => t + (r.credits ?? 0), 0)
  const unpriced = rows.filter(r => r.credits == null).length

  return (
    <>
      <style>{`
        @page { size: A4 landscape; margin: 14mm 12mm 16mm; }
        @media print {
          nav, header, .no-print { display: none !important; }
          body { background: #fff !important; }
          main { max-width: none !important; padding: 0 !important; margin: 0 !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
        }
        .pp { color:#111; background:#fff; font-size:10.5px; }
        .pp table { width:100%; border-collapse:collapse; }
        .pp th, .pp td { padding:4px 6px; border-bottom:1px solid #e5e7eb; text-align:left; }
        .pp th { background:#f3f4f6; font-size:8.5px; text-transform:uppercase; letter-spacing:.04em; color:#4b5563; }
        .pp td.num, .pp th.num { text-align:right; font-variant-numeric:tabular-nums; }
      `}</style>

      <div className="no-print mb-4 flex items-center gap-3">
        <button
          onClick={() => window.print()}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >
          Print / Save as PDF
        </button>
        <span className="text-xs text-muted-foreground">
          Choose &ldquo;Save as PDF&rdquo; as the destination. Landscape A4 is preset.
        </span>
      </div>

      <div className="pp">
        <div style={{ borderBottom: '2px solid #010B40', paddingBottom: 8, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div>
              <div style={{ fontSize: 8.5, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b7280' }}>
                AlphaROC · Survey activity
              </div>
              <div style={{ fontSize: 17, fontWeight: 600, marginTop: 2 }}>
                {salesperson ? `${salesperson} — ${bucketLabel}` : bucketLabel}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 8.5, color: '#6b7280', lineHeight: 1.5 }}>
              <div>Generated {generatedOn}</div>
              {generatedBy && <div>{generatedBy}</div>}
            </div>
          </div>
        </div>

        {/* Every filter that produced these rows, spelled out. */}
        <div style={{ fontSize: 9.5, color: '#4b5563', marginBottom: 10, lineHeight: 1.6 }}>
          <div>
            <strong style={{ color: '#111' }}>{describeRange(basis, range)}</strong>
            {' · '}{fmtNum(rows.length)} of {fmtNum(totalBeforeDates)} surveys in this group
            {undated > 0 && ` · ${undated} excluded for having no ${basis} date`}
          </div>
          {(clients.length > 0 || stages.length > 0 || search) && (
            <div style={{ marginTop: 2 }}>
              Filtered to
              {clients.length > 0 && <> accounts: <strong>{clients.join(', ')}</strong></>}
              {stages.length > 0 && <> stages: <strong>{stages.join(', ')}</strong></>}
              {search && <> matching &ldquo;<strong>{search}</strong>&rdquo;</>}
            </div>
          )}
          {creditTotal > 0 && (
            <div style={{ marginTop: 2 }}>
              {fmtNum(creditTotal)} credits across these surveys
              {unpriced > 0 && ` — ${unpriced} not yet priced, so that total is a floor`}
            </div>
          )}
        </div>

        {rows.length === 0 ? (
          <p style={{ fontSize: 10.5, color: '#6b7280' }}>No surveys match this filter.</p>
        ) : (
          <table>
            <thead>
              <tr>{shown.map(c => <th key={c.id} className={c.num ? 'num' : undefined}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  {shown.map(c => <td key={c.id} className={c.num ? 'num' : undefined}>{cell(r, c.id)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ marginTop: 12, fontSize: 8, color: '#9ca3af', borderTop: '1px solid #e5e7eb', paddingTop: 6 }}>
          Response counts are as recorded at the time of generation. A blank credit figure means the
          survey has not been priced yet — it does not mean zero.
        </div>
      </div>
    </>
  )
}
