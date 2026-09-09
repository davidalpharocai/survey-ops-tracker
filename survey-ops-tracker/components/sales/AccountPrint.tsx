'use client'

import { useEffect } from 'react'
import { fmtNum } from '@/lib/utils/number'
import { rollUp, describeConsumption, type Term } from '@/lib/sales/credits'
import { describeRange, type DateBasis, type Range } from '@/lib/sales/dateRange'
import { ACCOUNT_COLS, cellFor, type AccountProject } from './AccountDetail'

/**
 * The printed account report — a page designed to be saved as a PDF and sent to
 * a hedge-fund client, so it has to look like a document rather than a webpage
 * someone printed by accident.
 *
 * What earns its place, from what good reports actually carry: a title and the
 * account, a generated-on stamp with who produced it, an explicit statement of
 * the filter that produced the rows, the row count against the total so a short
 * table is explained, the credit position, and repeating table headers with page
 * numbers. A number without its filter cannot be checked.
 *
 * The print stylesheet is inline and scoped here rather than in globals.css:
 * these rules are about ONE page, and putting @page in the global sheet would
 * change how every other screen prints.
 */
export function AccountPrint({
  client, rows, totalCount, undated, basis, range, cols, terms, generatedOn, generatedBy,
}: {
  client: { id: string; name: string; code: string | null }
  rows: AccountProject[]
  totalCount: number
  undated: number
  basis: DateBasis
  range: Range
  cols: string[]
  terms: Term[]
  generatedOn: string
  generatedBy: string
}) {
  // Open the print dialog once the page has painted. rAF rather than a timeout:
  // printing before layout settles produces a first page with a half-drawn
  // table, and a fixed delay is a guess about the reader's machine.
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => window.print()))
    return () => cancelAnimationFrame(id)
  }, [])

  const shown = ACCOUNT_COLS.filter(c => (cols.length ? cols.includes(c.id) : true))
  const allowance = terms.reduce<number | null>(
    (t, x) => (x.credits_total == null ? t : (t ?? 0) + Number(x.credits_total)), null)
  const credits = rollUp(rows, allowance)

  return (
    <>
      <style>{`
        @page { size: A4 landscape; margin: 14mm 12mm 16mm; }
        @media print {
          /* The app shell is chrome, not content. */
          nav, header, .no-print { display: none !important; }
          body { background: #fff !important; }
          main { max-width: none !important; padding: 0 !important; margin: 0 !important; }
          /* Force the ink. Browsers drop backgrounds by default, which turns a
             header band into invisible text on white. */
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          thead { display: table-header-group; }   /* repeat headers per page */
          tr { break-inside: avoid; }
          .print-page { color: #111; }
        }
        .print-page { color: #111; background: #fff; font-size: 11px; }
        .print-page table { width: 100%; border-collapse: collapse; }
        .print-page th, .print-page td { padding: 4px 6px; border-bottom: 1px solid #e5e7eb; text-align: left; }
        .print-page th { background: #f3f4f6; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: #4b5563; }
        .print-page td.num, .print-page th.num { text-align: right; font-variant-numeric: tabular-nums; }
      `}</style>

      {/* Screen-only, because a viewer who lands here from a bookmark should not
          be stuck if their browser blocked the automatic dialog. */}
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

      <div className="print-page">
        <div style={{ borderBottom: '2px solid #010B40', paddingBottom: 8, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div>
              <div style={{ fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b7280' }}>
                AlphaROC · Survey activity
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>
                {client.name}
                {client.code && <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>{client.code}</span>}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 9, color: '#6b7280', lineHeight: 1.5 }}>
              <div>Generated {generatedOn}</div>
              {generatedBy && <div>{generatedBy}</div>}
            </div>
          </div>
        </div>

        {/* The filter, stated on the page. Without it the reader cannot tell a
            complete report from a filtered one, and neither can the sender. */}
        <div style={{ fontSize: 10, color: '#4b5563', marginBottom: 10, lineHeight: 1.6 }}>
          <div>
            <strong style={{ color: '#111' }}>{describeRange(basis, range)}</strong>
            {' · '}
            {fmtNum(rows.length)} of {fmtNum(totalCount)} surveys
            {undated > 0 && ` · ${undated} excluded for having no ${basis} date`}
          </div>
          <div style={{ marginTop: 2 }}>{describeConsumption(credits)}</div>
        </div>

        {rows.length === 0 ? (
          <p style={{ fontSize: 11, color: '#6b7280' }}>No surveys fall in this range.</p>
        ) : (
          <table>
            <thead>
              <tr>
                {shown.map(c => (
                  <th key={c.id} className={c.numeric ? 'num' : undefined}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id}>
                  {shown.map(c => (
                    <td key={c.id} className={c.numeric ? 'num' : undefined}>{cellFor(p, c.id)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ marginTop: 12, fontSize: 8.5, color: '#9ca3af', borderTop: '1px solid #e5e7eb', paddingTop: 6 }}>
          Response counts are as recorded at the time of generation. A blank credit figure means the
          survey has not been priced yet — it does not mean zero.
        </div>
      </div>
    </>
  )
}
