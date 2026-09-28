'use client'

/**
 * Tab 4 — IMPROVE. What to record next, ranked by how much each gap hides.
 *
 * Every figure comes from `buildImproveModel` (lib/finance/improve.ts); this
 * file only lays the model out and wires its drills and export:
 *
 *   C6 coverage heatmap  every month (the date filter only highlights) × the
 *                        seven fields the page leans on, with the banner's
 *                        computed reliability lines
 *   live-logging strip   whether rows are written within a week of the work
 *   what to record next  the price-coverage header, then the gaps fixable with
 *                        fields that exist today, ranked by dollars hidden
 *   blocked              what needs data SOCC does not capture, never faked
 *
 * The export is the ranked gap list, so "Export what you see" writes the rows
 * this tab's main tile shows.
 */

import { useEffect, useMemo, useRef } from 'react'
import { buildImproveModel, type ImproveInput } from '@/lib/finance/improve'
import type { FinanceTabProps } from './types'
import { CoverageCard } from '../improve/CoverageCard'
import { LoggingCard } from '../improve/LoggingCard'
import { GapsCard } from '../improve/GapsCard'
import { BlockedDataCard } from '../improve/BlockedDataCard'

export function ImproveTab(props: FinanceTabProps) {
  const { items, population, load, ix, filter, today, registerExport } = props
  // The name lookup may be a fresh function on every render of the shell; the
  // model reads it through a ref so it is not rebuilt for that alone. It is
  // derived from `load`, which IS a dependency, so it cannot go stale.
  const nameRef = useRef(props.accountName)
  nameRef.current = props.accountName
  const filterKey = JSON.stringify(filter)

  const input = useMemo<ImproveInput>(() => ({
    items, population, load, ix, filter, today,
    accountName: id => nameRef.current(id),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- filter by value
  }), [items, population, load, ix, filterKey, today])
  const model = useMemo(() => buildImproveModel(input), [input])

  // Register the ranked list for "Export what you see". Keyed on the rows'
  // content, not the model's identity, so a shell that re-renders on every
  // registration cannot loop; cleared when the tab unmounts.
  const exportRef = useRef(registerExport)
  exportRef.current = registerExport
  const exportKey = JSON.stringify(model.exportData.rows)
  useEffect(() => {
    exportRef.current(model.exportData)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on content
  }, [exportKey])
  useEffect(() => () => exportRef.current(null), [])

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        What to record next, ranked by how much each gap hides. Each row names the field, who records it and when, and opens the exact surveys.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <CoverageCard grid={model.grid} input={input} props={props} />
        </div>
        <div className="min-w-0">
          <LoggingCard strip={model.logging} input={input} props={props} />
        </div>
      </div>
      <GapsCard model={model} props={props} />
      <BlockedDataCard items={model.blockedData} props={props} />
    </div>
  )
}
