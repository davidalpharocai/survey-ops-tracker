'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { fmtNum } from '@/lib/utils/number'
import { downloadCsv, logExport } from '@/lib/utils/exportCsv'
import { exportLogMessage } from '@/lib/finance/exportFinance'
import { useModalDialog } from '@/components/finance/shell/useModalDialog'
import {
  isRerunWave, GROUP_LABEL, SEVERITY_LABEL, SEVERITY_TONE,
  type CheckResult, type CleanupScope,
} from '@/lib/admin/cleanup'
import { buildCleanupCsv, cleanupCsvFilename, cleanupCsvNotes } from '@/lib/admin/cleanupCsv'

/**
 * The surveys behind a tile.
 *
 * ── THE SAME DRILL THE REST OF THE APP HAS ──────────────────────────────────
 * A slide-over dialog with the finance hub's modal behaviour, reused rather
 * than re-implemented (components/finance/shell/useModalDialog.ts): focus moves
 * in, Tab stays in, Escape closes and hands focus back to the tile that opened
 * it, and the page behind does not scroll.
 *
 * ── IT SHOWS THE EMPTY FIELD ────────────────────────────────────────────────
 * Every column the check is about appears in the table with its value TODAY, so
 * "no launch date" is not a claim to be taken on trust — the column is there and
 * it is empty. Those are the same columns the CSV carries, derived from the
 * check's own `fields` list, so the screen and the file cannot drift apart. A
 * check with no editable field (nothing is typed to clear it) shows its remedy
 * in words where the column list would be, and exports a file with no blank
 * column in it.
 *
 * ── ONE SWITCH FOR THE WAVES ────────────────────────────────────────────────
 * "Include the repeat waves" adds them to the table AND to the download, so
 * what you are looking at is what you get. Off by default, matching the tile.
 */
export function CleanupDrill({ result, scope, today, onClose }: {
  result: CheckResult | null
  scope: CleanupScope
  today: string
  onClose: () => void
}) {
  const open = result != null
  const closeRef = useRef<HTMLButtonElement>(null)
  const ref = useModalDialog(open, onClose, { initialFocus: closeRef })
  const titleId = useId()
  const popId = useId()
  const [withWaves, setWithWaves] = useState(false)
  const [busy, setBusy] = useState(false)
  const [logged, setLogged] = useState<ReturnType<typeof exportLogMessage> | null>(null)

  // A different tile starts a fresh drill: no stale export message, and the
  // wave switch back to the tile's own default — except on a tile whose whole
  // count IS waves, where starting switched off would open an empty table.
  const checkId = result?.check.id ?? null
  const wavesOnly = result != null && result.count === 0 && result.waveCount > 0
  useEffect(() => { setLogged(null); setBusy(false); setWithWaves(wavesOnly) }, [checkId, wavesOnly])

  if (!result) return null
  const { check } = result
  const rows = withWaves ? [...result.rows, ...result.waves] : result.rows
  // Empty for the two checks nothing is typed to fix; they carry a `remedy`.
  const notes = cleanupCsvNotes(check)

  const download = async () => {
    if (busy) return
    setBusy(true)
    try {
      downloadCsv(
        buildCleanupCsv(result, { includeWaves: withWaves }),
        cleanupCsvFilename(check, today),
      )
      // Logged like every other export in the app. `includedRestricted: false`
      // is the truth about this file — there is no money column on this
      // dashboard to include. (The server may still revise the flag upward for
      // a finance-capability holder; that is its call, not ours.)
      setLogged(exportLogMessage(await logExport({
        route: `admin-cleanup-${check.id}`,
        rowCount: rows.length,
        filters: {
          check: check.id,
          legacyImport: scope.includeLegacyImport ? 'included' : 'excluded',
          rerunWaves: withWaves ? 'included' : 'excluded',
        },
        includedRestricted: false,
      })))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={popId}
        tabIndex={-1}
        className="relative bg-card border-l border-border shadow-xl w-full sm:max-w-4xl h-full flex flex-col focus:outline-none"
      >
        <div className="p-4 border-b border-border flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap mb-1">
              <span className={`text-[11px] px-1.5 py-0.5 rounded border ${SEVERITY_TONE[check.severity]}`}>
                {SEVERITY_LABEL[check.severity]}
              </span>
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {GROUP_LABEL[check.group]}
              </span>
            </div>
            <h2 id={titleId} className="text-lg font-semibold text-foreground">
              {check.label}
              <InfoTooltip text={check.help} />
            </h2>
            <p id={popId} className="text-xs text-muted-foreground mt-1 max-w-2xl">
              {fmtNum(result.count)} {result.count === 1 ? 'survey' : 'surveys'}
              {result.waveCount > 0 && <>, plus {fmtNum(result.waveCount)} rerun {result.waveCount === 1 ? 'wave' : 'waves'}</>}
              {' '}· checked against {fmtNum(result.applies)} in scope · {check.why}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent transition-colors shrink-0"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-2 border-b border-border flex items-center gap-3 flex-wrap">
          {result.waveCount > 0 && (
            <label className="text-xs text-muted-foreground flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={withWaves}
                onChange={e => setWithWaves(e.target.checked)}
                className="accent-primary"
              />
              Include the {fmtNum(result.waveCount)} rerun {result.waveCount === 1 ? 'wave' : 'waves'}
            </label>
          )}
          <button
            type="button"
            onClick={download}
            disabled={busy || rows.length === 0}
            className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
            title={notes.length > 0
              ? 'A worksheet: the survey code, what is there today, and a blank column headed with the database field to type into. Edit it and hand it back in chat.'
              : 'The list of surveys, with no column to type into — nothing is filled in to clear this one. Hand the codes back in chat.'}
          >
            {busy ? 'Preparing…' : `Export these ${fmtNum(rows.length)} rows (CSV)`}
          </button>
          <span className="text-xs text-muted-foreground">
            {notes.length > 0 ? (
              <>
                Fill in{' '}
                {notes.map((n, i) => (
                  <span key={n.column}>
                    {i > 0 && ', '}
                    <code className="font-mono text-foreground">{n.column}</code> — {n.entry}
                  </span>
                ))}
              </>
            ) : (
              // Nothing is typed to clear this one, so the file carries no blank
              // column at all and the remedy is said in words instead.
              check.remedy
            )}
          </span>
          {logged && (
            <span className={`text-xs ${logged.ok ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-300'}`} title={logged.title}>
              {logged.text}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto thin-scroll">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card border-b border-border">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Survey</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Captain</th>
                <th className="px-3 py-2 font-medium">Stage</th>
                {check.fields.map(f => (
                  <th key={f.column} className="px-3 py-2 font-medium whitespace-nowrap">
                    <code className="font-mono">{f.column}</code>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-accent/40">
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <Link
                      href={`/projects/${r.id}`}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {r.project_code ?? '(no code)'}
                    </Link>
                    {isRerunWave(r) && (
                      <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground align-middle">
                        wave
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 max-w-[16rem] truncate" title={r.project_name ?? ''}>
                    {r.project_name ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 max-w-[12rem] truncate" title={r.client ?? ''}>
                    {r.client ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{r.captain_name ?? '—'}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{r.board_column ?? '—'}</td>
                  {check.fields.map(f => (
                    <td key={f.column} className="px-3 py-1.5 whitespace-nowrap">
                      <Cell value={f.current(r)} />
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5 + check.fields.length} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {result.waveCount > 0
                      ? 'Every survey failing this check is a repeat wave — switch them on above.'
                      : 'Nothing here — this check is clear.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/** The value as it reads today. An empty one is the POINT of most of these
 *  tiles, so it is named "empty" rather than drawn as an em dash that could be
 *  mistaken for "not applicable". */
function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return <span className="text-amber-700 dark:text-amber-300">empty</span>
  }
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>
  if (typeof value === 'number') return <span className="tabular-nums">{fmtNum(value)}</span>
  return <>{String(value)}</>
}
