'use client'

/**
 * Tab 1 — Results: did we make money on finished work, and where did it come
 * from?
 *
 * Population: delivered × date × account × route (props.population). Every
 * figure is computed by lib/finance/results.ts `buildResultsModel`, the same
 * function the connector's finance_results tool calls, so the page and the
 * connector cannot disagree. This component only renders the model, opens its
 * drills and registers the export.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import type { FinanceTabProps } from './types'
import {
  buildResultsModel, parseGroupBy, resultsDrill, resultsExport,
  type ResultsDrillRequest, type ResultsInput,
} from '@/lib/finance/results'
import { ResultsTile1 } from '../results/ResultsTile1'
import { ResultsTile2 } from '../results/ResultsTile2'
import { GroupByPicker } from '../results/GroupByPicker'

const GUIDANCE =
  "Finished work only. The top card answers “did we make money” on the studies where we know both what the client pays and what we spent. The card below shows where it came from, by account, route, month, contact, study or panel. Click any bar or row to see the studies behind it."

export function ResultsTab(props: FinanceTabProps) {
  const params = useSearchParams()
  const by = parseGroupBy(params?.get('by'))

  const input: ResultsInput = useMemo(() => ({
    load: props.load, ix: props.ix, items: props.items, population: props.population,
    filter: props.filter, today: props.today, groupBy: by, scope: props.scope,
  }), [props.load, props.ix, props.items, props.population, props.filter, props.today, by, props.scope])
  const model = useMemo(() => buildResultsModel(input), [input])

  // The export is the rows behind Tile 1. Registered from an effect keyed on
  // what the rows ARE — not on object identity, which a parent re-render can
  // change without changing a figure — so registering can never loop.
  const exportRows = useMemo(() => resultsExport(model), [model])
  const exportKey = useMemo(
    () => `${model.scope.chip}|${JSON.stringify(exportRows.rows)}`, [model.scope.chip, exportRows])
  const register = useRef(props.registerExport)
  register.current = props.registerExport
  const latest = useRef(exportRows)
  latest.current = exportRows
  useEffect(() => { register.current(latest.current) }, [exportKey])
  useEffect(() => () => register.current(null), [])

  const open = (req: ResultsDrillRequest, month?: { label: string; from: string; to: string }) => {
    const spec = resultsDrill(input, model, req)
    props.openDrill(spec, month
      ? {
        filter: {
          href: props.hrefFor({ range: { preset: 'custom', from: month.from, to: month.to } }),
          label: `Filter the page to ${month.label}`,
        },
      }
      : undefined)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{GUIDANCE}</p>
      <ResultsTile1 props={props} model={model} open={open} />
      <GroupByPicker by={by} />
      <ResultsTile2 props={props} model={model} open={req => open(req)} />
    </div>
  )
}
