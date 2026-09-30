'use client'

import { useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { fmtNum } from '@/lib/utils/number'
import { formatNRange } from '@/lib/utils/nRange'
import { drillRows, type DrillRow, type InsightsModel } from '@/lib/insights/model'
import { stageLabel } from '@/lib/utils/stage'
import type { DrillRequest } from './drill'

/**
 * The surveys behind a tile, column or bar, in a slide-over beside the chart.
 *
 * The rows are chosen by the request's query on their own, NOT copied from the
 * aggregate that drew the mark; the strip at the top compares the two counts
 * every time it opens. If they ever drift it says so in red, instead of quietly
 * listing a different set from the number the reader clicked.
 *
 * Every survey code is a real link, so right-click and middle-click open the
 * project in a new tab.
 */
export function SurveyDrill({ req, model, accounts, onClose }: {
  req: DrillRequest | null
  model: InsightsModel
  accounts: Map<string, string>
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    closeRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [req, onClose])

  const rows = useMemo(
    () => (req ? drillRows(model.items, model.filter, req.query, model.today, accounts) : []),
    [req, model, accounts],
  )
  if (!req) return null

  const agrees = rows.length === req.expected
  const delivered = req.query.kind === 'delivered'

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={req.title}
        className="fixed right-0 top-0 z-50 flex h-full w-full flex-col border-l border-border bg-card shadow-2xl md:w-[760px]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">{req.title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{req.population}</p>
            {(req.filterHref || req.listHref) && (
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                {req.filterHref && (
                  <Link href={req.filterHref} replace scroll={false} onClick={onClose} className="text-primary underline-offset-2 hover:underline">
                    {req.filterLabel ?? 'Filter the page to this'}
                  </Link>
                )}
                {req.listHref && (
                  <Link href={req.listHref} className="text-primary underline-offset-2 hover:underline" title={req.listNote}>
                    Open these in the List
                  </Link>
                )}
              </p>
            )}
            {req.listHref && req.listNote && <p className="mt-0.5 text-[11px] text-muted-foreground">{req.listNote}</p>}
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            ✕
          </button>
        </header>

        <div
          className={
            'border-b px-4 py-2 text-[13px] tabular-nums ' +
            (agrees
              ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
              : 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-400')
          }
        >
          {agrees
            ? `${fmtNum(rows.length)} ${rows.length === 1 ? 'study' : 'studies'} listed — the same as the ${fmtNum(req.expected)} ${req.expectedWhere} ✓`
            : `${fmtNum(rows.length)} listed, but ${fmtNum(req.expected)} ${req.expectedWhere}. The two disagree — please tell Claude so it can be fixed.`}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">No studies behind this figure.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-1.5 font-medium" title="The study's code; opens the project">Study</th>
                  <th className="px-3 py-1.5 font-medium" title="Project name, account and type">What</th>
                  <th className="px-3 py-1.5 font-medium" title="The study's lead captain">Captain</th>
                  {delivered ? (
                    <>
                      <th className="px-3 py-1.5 text-right font-medium" title="The deliver date — the day the client had it">Delivered</th>
                      <th className="px-3 py-1.5 text-right font-medium" title="On time: delivered on or before the due date. Late: after it. Blank: no due date to judge.">Due · result</th>
                      <th className="px-3 py-1.5 text-right font-medium" title="Calendar days from submitted to delivered">Days</th>
                      <th className="px-3 py-1.5 text-right font-medium" title="Respondents that passed QA (post-QA N)">Respondents</th>
                    </>
                  ) : (
                    <>
                      <th className="px-3 py-1.5 font-medium" title="The board column the study is in">Stage</th>
                      <th className="px-3 py-1.5 text-right font-medium" title="Internal due date">Due</th>
                      <th className="px-3 py-1.5 text-right font-medium" title="Responses collected so far, against the N target (a range when a maximum is set)">Collected</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map(r => <Row key={r.id} r={r} delivered={delivered} today={model.today} />)}
              </tbody>
            </table>
          )}
        </div>

        <footer className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Every code is a real link — right-click or middle-click to open it in a new tab. Esc closes.
        </footer>
      </aside>
    </>
  )
}

function Row({ r, delivered, today }: { r: DrillRow; delivered: boolean; today: string }) {
  return (
    <tr className="align-top hover:bg-accent/40">
      <td className="whitespace-nowrap px-3 py-1.5">
        <Link href={`/projects/${r.id}`} className="font-medium text-primary underline-offset-2 hover:underline">{r.code}</Link>
        {r.rerun && <span className="ml-1 text-xs text-muted-foreground" title="A rerun: a repeat wave of a recurring study">↻</span>}
      </td>
      <td className="w-full min-w-[10rem] max-w-0 px-3 py-1.5">
        <span className="block truncate text-foreground" title={r.name}>{r.name}</span>
        <span className="block truncate text-xs text-muted-foreground" title={`${r.account} · ${r.type}`}>{r.account} · {r.type}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{r.captain}</td>
      {delivered ? (
        <>
          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{r.deliver ?? '—'}</td>
          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
            <span className="text-muted-foreground">{r.due ?? 'no due date'}</span>
            {r.onTime != null && (
              <span className={r.onTime ? ' text-emerald-700 dark:text-emerald-400' : ' text-amber-700 dark:text-amber-400'}>
                {' · '}{r.onTime ? 'on time' : 'late'}
              </span>
            )}
          </td>
          <td className="px-3 py-1.5 text-right tabular-nums">{r.cycleDays == null ? '—' : fmtNum(r.cycleDays)}</td>
          <td className="px-3 py-1.5 text-right tabular-nums">{r.respondents == null ? '—' : fmtNum(r.respondents)}</td>
        </>
      ) : (
        <>
          <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{stageLabel(r.stage)}</td>
          <td className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${r.due && r.due < today ? 'text-red-600 dark:text-red-400' : ''}`}>
            {r.due ?? '—'}
          </td>
          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
            {fmtNum(r.collected)} / {formatNRange(r.targetMin, r.targetMax)}
          </td>
        </>
      )}
    </tr>
  )
}
