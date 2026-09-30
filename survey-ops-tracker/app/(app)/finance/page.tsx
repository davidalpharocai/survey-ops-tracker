'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { fmtNum } from '@/lib/utils/number'
import { useFinanceData } from '@/lib/finance/useFinanceData'
import { buildIndex } from '@/lib/finance/hub'
import { blockedText, integrityLine, integrityWarnings, isBlocked } from '@/lib/finance/load'
import {
  DEFAULT_FILTER, describe, formatRange, itemsOf, optionCounts, parseFilter, populationFor, resolveRange,
  sideBucketFor, TAB_LABEL, TAB_RULES, todayET, undatedDropped,
} from '@/lib/finance/filters'
import { exportLogMessage, exportTable } from '@/lib/finance/exportFinance'
import type { DrillSpec } from '@/lib/finance/drill'
import { ResultsTab } from '@/components/finance/tabs/ResultsTab'
import { ThisWeekTab } from '@/components/finance/tabs/ThisWeekTab'
import { PerRespondentTab } from '@/components/finance/tabs/PerRespondentTab'
import { ImproveTab } from '@/components/finance/tabs/ImproveTab'
import type { DrillOpts, FinanceExport, FinanceTabProps } from '@/components/finance/tabs/types'
import { DrillPanel, type DrillExportContext, type OpenDrill } from '@/components/finance/DrillPanel'
import { useFinanceAccess } from '@/components/finance/shell/FinanceAccess'
import { FinanceLimited } from '@/components/finance/shell/FinanceLimited'
import { FinanceSkeleton } from '@/components/finance/shell/FinanceSkeleton'
import { FilterBar } from '@/components/finance/shell/FilterBar'
import { DataBanner, IntegrityLine } from '@/components/finance/shell/DataBanner'
import { ExportControl } from '@/components/finance/shell/ExportControl'
import { GlossaryDrawer } from '@/components/finance/shell/GlossaryDrawer'
import { TabErrorBoundary } from '@/components/finance/shell/TabErrorBoundary'
import { buildBannerModel } from '@/components/finance/shell/banner'
import { exportContextFor } from '@/components/finance/shell/exportHeader'
import {
  canonicalHref, financeHref, needsCanonical, TAB_HINT, TAB_ORDER, tabFromParam, type HrefPatch,
} from '@/components/finance/shell/url'

/**
 * The finance hub: a thin shell around four tabs.
 *
 * ── WHAT THE SHELL DOES, AND WHAT IT LEAVES TO THE TABS ─────────────────────
 * The shell loads the book ONCE (lib/finance/load.ts), indexes and classifies
 * it once, parses the filter from the URL once, and hands every tab the same
 * props (components/finance/tabs/types.ts): its population, the Hold bucket
 * beside it, the scope chip, a real href builder, the drill panel and the
 * export registry. It owns the page chrome — header, tabs, the sticky filter
 * bar, the data banner and integrity line, "Export what you see", the drill
 * panel and the glossary — and computes no figure of its own beyond the counts
 * in the header and the banner's coverage sentences.
 *
 * ── WHO SEES IT ─────────────────────────────────────────────────────────────
 * Finance holders only, decided on the SERVER by ./layout.tsx. This page reads
 * the layout's answer back (useFinanceAccess) and shows the limited-access
 * page if it was rendered anywhere else. That is why there is no per-tile
 * capability branch here or in any tab.
 *
 * ── EVERY VIEW IS A URL ─────────────────────────────────────────────────────
 * The tab, the date range, the account and the route live in the address, so
 * a view can be bookmarked, shared and refreshed. The date defaults to Since
 * 1 June 2026 (David, 2026-09-24), with All time one click away. The previous
 * page's tab ids (now, unit, book, save) are mapped to the tab that now
 * answers the same question, and its other keys are dropped, once, on arrival.
 * The drill panel is the one thing not in the URL: a drill is built from the
 * tab's own model, which a URL cannot carry.
 */

export default function FinancePage() {
  // useSearchParams needs a Suspense boundary in the app router.
  return (
    <Suspense fallback={<FinanceSkeleton />}>
      <FinanceGate />
    </Suspense>
  )
}

function FinanceGate() {
  return useFinanceAccess() ? <FinanceShell /> : <FinanceLimited />
}

interface Registered {
  tab: FinanceTabProps['tab']
  x: FinanceExport
}

function FinanceShell() {
  const verified = useFinanceAccess()
  const router = useRouter()
  const params = useSearchParams()
  const paramsKey = params.toString()
  const filter = useMemo(() => parseFilter(new URLSearchParams(paramsKey)), [paramsKey])
  const tab = tabFromParam(params.get('tab'))

  // An old bookmark (?tab=book, ?lifecycle=…) is rewritten to the canonical
  // address once, so the URL the reader copies from here on is the one the
  // page actually reads.
  useEffect(() => {
    const p = new URLSearchParams(paramsKey)
    if (needsCanonical(p)) router.replace(canonicalHref(p, parseFilter(p)), { scroll: false })
  }, [paramsKey, router])

  const { load, isLoading, isFetching, refetch } = useFinanceData()
  const raw = load?.raw ?? null
  // "Today" as of the read, in Eastern time, so a page left open overnight
  // moves to the new day when the data refreshes, not mid-render.
  const loadedAt = load?.integrity.loadedAt ?? null
  const today = useMemo(() => todayET(loadedAt ? new Date(loadedAt) : new Date()), [loadedAt])

  const ix = useMemo(() => (raw ? buildIndex(raw.blasts, raw.suppliers, raw.costs) : null), [raw])
  // Classified, routed and placed once per load; empty placeholders dropped.
  const items = useMemo(
    () => (raw && ix ? itemsOf(raw.projects, raw.blasts, raw.suppliers, raw.costs, ix) : []),
    [raw, ix],
  )
  const population = useMemo(() => populationFor(items, tab, filter, today), [items, tab, filter, today])
  const side = useMemo(() => sideBucketFor(items, tab, filter, today), [items, tab, filter, today])
  const delivered = useMemo(
    () => (tab === 'this-week' ? null : populationFor(items, 'results', filter, today).length),
    [items, tab, filter, today],
  )

  const nameById = useMemo(() => new Map((raw?.accounts ?? []).map(a => [a.id, a.name ?? '(unnamed)'])), [raw])
  const codeById = useMemo(() => new Map((raw?.projects ?? []).map(p => [p.id, p.project_code])), [raw])
  const accountName = useCallback(
    (id: string | null | undefined) => (id ? nameById.get(id) : undefined) ?? '(unknown account)',
    [nameById],
  )
  const filterAccountName = filter.account ? accountName(filter.account) : null
  const scope = useMemo(
    () => describe(filter, { tab, today, count: population.length, accountName: filterAccountName }),
    [filter, tab, today, population.length, filterAccountName],
  )

  const hrefFor = useCallback(
    (patch: HrefPatch) => financeHref(paramsKey, filter, tab, patch),
    [paramsKey, filter, tab],
  )
  const navigate = useCallback((href: string) => router.replace(href, { scroll: false }), [router])

  /* ── the drill ─────────────────────────────────────────────────────── */
  const [drill, setDrill] = useState<OpenDrill | null>(null)
  const openDrill = useCallback((spec: DrillSpec, opts?: DrillOpts) => setDrill({ spec, opts }), [])
  const closeDrill = useCallback(() => setDrill(null), [])
  // A drill belongs to the tab that opened it.
  useEffect(() => { setDrill(null) }, [tab])

  /* ── the export registry ───────────────────────────────────────────── */
  // The rows live in a ref; only what the button shows (which tab, how many
  // rows) is state, as ONE STRING, so a registration that changes nothing the
  // button shows leaves the state identical and React skips the re-render. A
  // tab's effect typically runs "register null" (cleanup) then "register x" in
  // the same commit; an object here would be a new identity every time, the
  // page would re-render the tab, the tab's effect would run again, and the
  // page would never settle. A string that ends where it started cannot loop.
  const registered = useRef<Registered | null>(null)
  const tabRef = useRef(tab)
  tabRef.current = tab
  const [exportKey, setExportKey] = useState<string | null>(null)
  const registerExport = useCallback((x: FinanceExport | null) => {
    const t = tabRef.current
    registered.current = x ? { tab: t, x } : null
    setExportKey(x ? `${t}|${x.rows.length}` : null)
  }, [])
  const exportRows = (() => {
    if (!exportKey) return null
    const [t, rows] = exportKey.split('|')
    return t === tab ? Number(rows) : null
  })()
  const [exporting, setExporting] = useState(false)
  const [logMsg, setLogMsg] = useState<ReturnType<typeof exportLogMessage> | null>(null)
  useEffect(() => { setLogMsg(null) }, [tab, paramsKey])

  const contextFor = useCallback((rows: number, route: string) => exportContextFor({
    filter, tab, today, rows, accountName: filterAccountName,
    loadedAt: loadedAt ?? new Date().toISOString(),
    surveysInView: population.length, onHold: side.length, route,
  }), [filter, tab, today, filterAccountName, loadedAt, population.length, side.length])

  const doExport = async () => {
    const reg = registered.current
    if (!reg || reg.tab !== tab || exporting) return
    setExporting(true)
    try {
      const ctx = contextFor(reg.x.rows.length, `finance-${tab}`)
      // The file downloads inside exportTable BEFORE the audit call; the
      // message below is only about the log.
      setLogMsg(exportLogMessage(await exportTable(reg.x, ctx.header, ctx.audit)))
    } finally {
      setExporting(false)
    }
  }
  const drillExport = useCallback((rows: number): DrillExportContext => contextFor(rows, 'finance-drill'), [contextFor])

  const [glossary, setGlossary] = useState(false)

  /* ── the chrome's own computed words ───────────────────────────────── */
  const options = useMemo(
    () => (raw ? optionCounts(items, tab, filter, raw.accounts, today) : { accounts: [], routes: [] }),
    [raw, items, tab, filter, today],
  )
  // Delivered surveys with no date that a range would drop — for the date
  // help, so it is measured with a range applied even when All time is on.
  const undated = useMemo(() => undatedDropped(
    items, TAB_RULES[tab].date ? tab : 'results', { ...filter, range: { ...DEFAULT_FILTER.range } }, today,
  ), [items, tab, filter, today])
  const banner = useMemo(() => (raw && ix && load ? buildBannerModel({
    tab, filter, today, items, raw, ix, blocked: load.blocked, pricesReturned: load.integrity.pricesReturned,
  }) : null), [raw, ix, load, tab, filter, today, items])

  if (isLoading && !load) return <FinanceSkeleton />
  if (!load || !raw || !ix || !banner) {
    return (
      <LoadError
        what="The finance data did not load."
        onRetry={refetch}
        busy={isFetching}
      />
    )
  }
  if (isBlocked(load.blocked, 'survey_projects')) {
    // Every figure on every tab is built from survey_projects. Without it
    // there is nothing to show, and an empty book would read as $0.
    return (
      <LoadError
        what={`${blockedText('survey_projects')}. Nothing on this page can be computed without it, so every figure is missing, not zero.`}
        onRetry={refetch}
        busy={isFetching}
      />
    )
  }

  const warnings = integrityWarnings(load, { canViewFinancials: verified })
  const line = integrityLine(load.integrity, {
    canViewFinancials: verified,
    time: new Date(load.integrity.loadedAt).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
    }),
  })
  const rule = TAB_RULES[tab]
  const headline = tab === 'this-week'
    ? `${fmtNum(population.length)} live ${population.length === 1 ? 'study' : 'studies'}` +
      (side.length ? ` · ${fmtNum(side.length)} on hold` : '') + ` · ${rule.ignoredNote ?? 'All dates'}`
    : `${fmtNum(delivered ?? 0)} delivered ${delivered === 1 ? 'study' : 'studies'} · ${formatRange(resolveRange(filter.range, today))}`

  const props: FinanceTabProps = {
    tab, load, ix, items, population, side, filter, today, scope, accountName, openDrill, hrefFor, registerExport,
  }

  return (
    <div className="mx-auto max-w-6xl space-y-3 py-2">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold text-foreground">Finance</h1>
        <span className="text-sm text-muted-foreground" title="Counted under the filters below.">
          {headline}
        </span>
        <button
          type="button"
          onClick={() => setGlossary(true)}
          aria-haspopup="dialog"
          className="ml-auto rounded text-sm text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--chart-price)]"
          title="The ten words this page uses, one sentence each"
        >
          How to read this
        </button>
      </header>

      {/* Real links, so a tab can be opened in a new browser tab or shared. */}
      <nav aria-label="Finance sections" className="-mb-px flex gap-1 overflow-x-auto border-b border-border">
        {TAB_ORDER.map(t => (
          <Link
            key={t}
            href={hrefFor({ tab: t })}
            scroll={false}
            title={TAB_HINT[t]}
            aria-current={t === tab ? 'page' : undefined}
            className={
              'relative -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ' +
              (t === tab
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground')
            }
          >
            {TAB_LABEL[t]}
          </Link>
        ))}
      </nav>

      <FilterBar
        tab={tab}
        filter={filter}
        today={today}
        accounts={options.accounts}
        routes={options.routes}
        undated={undated}
        costReliableFrom={banner.dates.cost.date}
        hrefFor={hrefFor}
        navigate={navigate}
        exportSlot={
          <ExportControl rows={exportRows} busy={exporting} message={logMsg} onExport={() => { void doExport() }} />
        }
      />

      <DataBanner
        model={banner}
        improveHref={tab === 'improve' ? null : hrefFor({ tab: 'improve' })}
        defaultHref={hrefFor({ range: { ...DEFAULT_FILTER.range } })}
      />
      <IntegrityLine line={line} warnings={warnings} />

      <TabErrorBoundary key={tab} label={TAB_LABEL[tab]}>
        {tab === 'results' && <ResultsTab {...props} />}
        {tab === 'this-week' && <ThisWeekTab {...props} />}
        {tab === 'per-respondent' && <PerRespondentTab {...props} />}
        {tab === 'improve' && <ImproveTab {...props} />}
      </TabErrorBoundary>

      <DrillPanel
        drill={drill}
        onClose={closeDrill}
        codeOf={id => codeById.get(id) ?? null}
        exportContext={drillExport}
      />
      <GlossaryDrawer open={glossary} onClose={() => setGlossary(false)} />
    </div>
  )
}

/** A load that failed outright: say so, offer Retry, and never blame or name
 *  a person — the reader cannot fix a network or a database, only try again. */
function LoadError({ what, onRetry, busy }: { what: string; onRetry: () => void; busy: boolean }) {
  return (
    <div className="mx-auto max-w-6xl py-2">
      <h1 className="mb-3 text-xl font-semibold text-foreground">Finance</h1>
      <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-6 text-center text-sm">
        <p className="font-medium text-red-700 dark:text-red-400">{what}</p>
        <p className="mt-1 text-muted-foreground">
          Nothing was changed. If it keeps failing, check your connection and try again in a few minutes.
        </p>
        <button
          type="button"
          onClick={onRetry}
          disabled={busy}
          className="mt-3 rounded-md border border-border bg-card px-3 py-1 text-[13px] text-foreground hover:bg-accent disabled:opacity-50"
        >
          {busy ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    </div>
  )
}
