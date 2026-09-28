'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { fmtNum } from '@/lib/utils/number'
import { downloadCsv, logExport } from '@/lib/utils/exportCsv'
import { exportLogMessage } from '@/lib/finance/exportFinance'
import {
  isLegacyImport, runCleanup, LEGACY_IMPORT_CUTOFF,
  GROUP_HELP, GROUP_LABEL, SOURCE_LABEL,
  type CheckGroup, type CleanupScope,
} from '@/lib/admin/cleanup'
import {
  buildCleanupAllCsv, buildCleanupSummaryCsv, cleanupAllFilename, cleanupSummaryFilename,
} from '@/lib/admin/cleanupCsv'
import type { CleanupData } from '@/app/(app)/admin/cleanup/load'
import { CleanupTile } from './CleanupTile'
import { CleanupDrill } from './CleanupDrill'
import { groupsPresent, headline, orderResults } from './order'

/**
 * Data cleanup: every structural gap in the survey book, as tiles that should
 * all read 0.
 *
 * David, 2026-09-28: "they can just be tiles with numbers and then i can click
 * into them to see more details + the ability to export as csv so i can update
 * in the csv and return it to you. the idea is that every tile should be 0."
 *
 * ── THE MODEL DECIDES, THIS FILE DRAWS ──────────────────────────────────────
 * Every check, its severity, its wording, what counts as "applies", and the CSV
 * columns come from lib/admin/cleanup.ts. This component adds no rule of its
 * own — it cannot, or the tile and the file it exports would eventually
 * disagree. Adding a check is one entry in CHECKS and nothing here.
 *
 * ── THE SCOPE IS THE FIRST THING ON THE PAGE ────────────────────────────────
 * Rows created on or before the legacy import date are excluded by default. A
 * bare "since 1 June" filter would have filtered NOTHING: `created_at` on those
 * rows is the import stamp, not when the work happened, so every row in the
 * table dates from June onwards. The toggle says in words which surveys it adds
 * and why they are set aside, because a hidden 176-row exclusion on a dashboard
 * whose target is zero would be a lie of omission.
 *
 * ── NO MONEY ────────────────────────────────────────────────────────────────
 * Not one figure of it. The single spend-related check arrives as two booleans
 * from the server (see ../../../app/(app)/admin/cleanup/load.ts) and renders as
 * a count of surveys, never an amount.
 */
/** "June 10, 2026" — read from the model's own constant, so the sentence on
 *  screen cannot drift from the date the scope actually uses. Noon UTC keeps
 *  the bare date from sliding a day backwards in a western time zone. */
const CUTOFF_IN_WORDS = new Date(`${LEGACY_IMPORT_CUTOFF}T12:00:00Z`).toLocaleDateString('en-US', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
})

export function CleanupDashboard({ data }: { data: CleanupData }) {
  const [includeLegacy, setIncludeLegacy] = useState(false)
  const [group, setGroup] = useState<CheckGroup | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [logged, setLogged] = useState<ReturnType<typeof exportLogMessage> | null>(null)

  const scope: CleanupScope = { includeLegacyImport: includeLegacy }

  const report = useMemo(() => runCleanup({
    projects: data.projects,
    fielding: new Map(Object.entries(data.fielding)),
    contacts: new Map(Object.entries(data.contacts)),
    internalTargets: data.internalTargets,
    blocked: data.blocked,
    today: data.today,
    scope,
    // `scope` is a fresh object each render; the primitive inside it is what
    // actually changes the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [data, includeLegacy])

  const legacyCount = useMemo(() => data.projects.filter(isLegacyImport).length, [data.projects])
  const head = headline(report)
  const ordered = orderResults(report.results)
  const shown = group ? ordered.filter(r => r.check.group === group) : ordered
  const open = openId ? report.results.find(r => r.check.id === openId) ?? null : null

  const exportFile = async (kind: 'summary' | 'all') => {
    if (busy) return
    setBusy(true)
    try {
      const text = kind === 'summary'
        ? buildCleanupSummaryCsv(report)
        : buildCleanupAllCsv(report, { includeWaves: true })
      downloadCsv(
        text,
        kind === 'summary' ? cleanupSummaryFilename(report.today) : cleanupAllFilename(report.today),
      )
      setLogged(exportLogMessage(await logExport({
        route: `admin-cleanup-${kind}`,
        rowCount: kind === 'summary' ? report.results.length : head.surveys + head.waves,
        filters: { legacyImport: includeLegacy ? 'included' : 'excluded' },
        includedRestricted: false,
      })))
    } finally {
      setBusy(false)
    }
  }

  if (data.error) {
    return (
      <div className="max-w-6xl mx-auto flex flex-col gap-4">
        <Header />
        <div className="bg-card border border-red-500/40 rounded-xl p-4">
          <p className="text-sm text-foreground font-medium">The surveys did not load, so there is nothing to report.</p>
          <p className="text-xs text-muted-foreground mt-1">
            This page shows no numbers at all rather than zeroes: a failed read is not a clean book.
          </p>
          <p className="text-xs text-muted-foreground/80 mt-2 font-mono break-all">{data.error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-4">
      <Header />

      {/* Headline — the number David is driving */}
      <div className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-3xl font-semibold text-foreground tabular-nums">
            {fmtNum(head.clear)} of {fmtNum(head.total)}
          </span>
          <span className="text-sm text-muted-foreground">
            tiles are at zero
            {head.blocked > 0 && (
              <span className="text-amber-700 dark:text-amber-300">
                {' '}· {fmtNum(head.blocked)} could not be measured
              </span>
            )}
          </span>
          <InfoTooltip text="A tile is at zero when every survey in scope passes that check. A check whose source failed to load is counted apart — we do not know that it is clean, so it is not called clean." />
        </div>
        <p className="text-sm text-muted-foreground">
          {head.surveys === 0 && head.waves === 0 ? (
            <span className="text-emerald-700 dark:text-emerald-400">
              Nothing to fix in this scope. Every survey carries the fields the app needs.
            </span>
          ) : (
            <>
              <span className="text-foreground font-medium">{fmtNum(head.surveys)}</span>{' '}
              {head.surveys === 1 ? 'survey needs' : 'surveys need'} work
              {head.waves > 0 && (
                <>, plus <span className="text-foreground font-medium">{fmtNum(head.waves)}</span> rerun{' '}
                  {head.waves === 1 ? 'wave' : 'waves'} not yet picked up</>
              )}
              . A survey failing several checks is counted once.
            </>
          )}
        </p>

        {/* Scope — said in words, not in the single word "legacy" */}
        <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
          <label className="text-sm text-foreground flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeLegacy}
              onChange={e => setIncludeLegacy(e.target.checked)}
              className="accent-primary mt-0.5"
            />
            <span>
              Include the {fmtNum(legacyCount)} surveys imported from the Survey Ops sheet on{' '}
              {CUTOFF_IN_WORDS} (and anything older)
              <span className="block text-xs text-muted-foreground mt-0.5">
                They were all created in one batch on import day, so they carry the import date rather than
                dates of their own and fail almost every check below. Off by default, so the tiles count the
                work the team has created since. {includeLegacy
                  ? 'They are counted in every number on this page right now.'
                  : `${fmtNum(report.excludedLegacy)} set aside; ${fmtNum(report.inScope)} surveys are being checked.`}
              </span>
            </span>
          </label>
        </div>

        {report.blocked.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              {report.blocked.map(s => SOURCE_LABEL[s]).join(', ')} did not load. The checks that need{' '}
              {report.blocked.length === 1 ? 'it' : 'them'} show a dash, not a zero.
            </p>
            {data.blockedWhy.map(b => (
              <p key={b.source} className="text-xs text-muted-foreground mt-1 font-mono break-all">
                {SOURCE_LABEL[b.source]}: {b.message}
              </p>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => exportFile('summary')}
            disabled={busy}
            className="text-xs border border-border rounded-lg px-3 py-1.5 hover:bg-accent disabled:opacity-50 transition-colors"
            title="One row per tile: the count, the rerun waves, what it applies to, and why it matters. A blank count where a source did not load."
          >
            Export every tile (CSV)
          </button>
          <button
            type="button"
            onClick={() => exportFile('all')}
            disabled={busy}
            className="text-xs border border-border rounded-lg px-3 py-1.5 hover:bg-accent disabled:opacity-50 transition-colors"
            title="One row per survey that needs work, with every check it fails. Repeat waves included. Read-only — the per-tile files are the ones to edit."
          >
            Export every survey needing work (CSV)
          </button>
          <span className="text-xs text-muted-foreground">
            Read {data.loadedAtLabel} ET · {fmtNum(report.scanned)} live surveys
          </span>
          {logged && (
            <span className={`text-xs ${logged.ok ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-300'}`} title={logged.title}>
              {logged.text}
            </span>
          )}
        </div>
      </div>

      {/* Group filter — the same chip idiom as the accounts list on /admin */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setGroup(null)}
          className={`text-sm px-2 py-1 rounded-lg border transition-colors ${
            group === null ? 'border-ring bg-accent text-foreground' : 'border-border text-muted-foreground hover:text-foreground hover:border-ring'
          }`}
        >
          All {fmtNum(report.results.length)} checks
        </button>
        {groupsPresent().map(g => {
          const n = report.results.filter(r => r.check.group === g).length
          const active = group === g
          return (
            <button
              key={g}
              type="button"
              onClick={() => setGroup(active ? null : g)}
              title={GROUP_HELP[g]}
              className={`text-sm px-2 py-1 rounded-lg border transition-colors ${
                active ? 'border-ring bg-accent text-foreground' : 'border-border text-muted-foreground hover:text-foreground hover:border-ring'
              }`}
            >
              {GROUP_LABEL[g]} <span className="text-muted-foreground">{fmtNum(n)}</span>
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 items-stretch">
        {shown.map(res => (
          <CleanupTile key={res.check.id} result={res} onOpen={setOpenId} />
        ))}
      </div>

      <p className="text-xs text-muted-foreground/60">
        Edit an exported file and hand it back in chat — Claude applies it through the ordinary tools, where
        every change is validated and audited. There is deliberately no upload here.{' '}
        <Link href="/admin" className="text-primary hover:underline">Back to Admin</Link>
      </p>

      <CleanupDrill result={open} scope={scope} today={report.today} onClose={() => setOpenId(null)} />
    </div>
  )
}

function Header() {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <h1 className="text-2xl font-bold text-foreground">Data cleanup</h1>
      <span className="text-sm text-muted-foreground">
        Structural gaps in the survey book. Every tile should read 0.
      </span>
    </div>
  )
}
