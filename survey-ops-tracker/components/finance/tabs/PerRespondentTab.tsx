'use client'

/**
 * Tab 3 — PER RESPONDENT. What one respondent costs us, by route, and where
 * more margin could come from.
 *
 * Finance spec §4 "Tab 3 · Per respondent". Every figure is computed by
 * lib/finance/perRespondent.ts `buildPerRespondentModel` (pure, unit-tested);
 * this file only wires the shell's props into it and lays the tiles out.
 *
 * ── TWO POPULATIONS, EACH NAMED ON ITS CARD ─────────────────────────────────
 * Tile 4 describes DELIVERED work (the tab's population): a cost per qualified
 * respondent needs the final N actual. Tile 5's levers are computed on
 * delivered AND live work in the same window (filters.ts LEVER_RULE), because
 * live work is where acting still saves money. Each card's scope chip says
 * which, so a reader never compares the two as if they were one set.
 */

import { useEffect, useMemo } from 'react'
import { blockedText, isBlocked, priceBlockText } from '@/lib/finance/load'
import {
  buildPerRespondentModel, tile4ExportRows, TILE4_EXPORT_COLUMNS,
} from '@/lib/finance/perRespondent'
import { RespondentCostTile } from '@/components/finance/perrespondent/RespondentCostTile'
import { MarginLeversTile } from '@/components/finance/perrespondent/MarginLeversTile'
import type { FinanceTabProps } from './types'

export function PerRespondentTab(props: FinanceTabProps) {
  const { load, ix, items, population, filter, today, accountName, registerExport } = props

  // The page is gated to finance holders on the server, so a missing price is a
  // read problem to name, never a permission to respect here.
  const priceBlock = priceBlockText(load, { canViewFinancials: true })
  const launchesBlocked = isBlocked(load.blocked, 'project_launches') ? blockedText('project_launches') : null
  const accountLabel = filter.account ? accountName(filter.account) : null

  const model = useMemo(() => buildPerRespondentModel({
    items, population, filter, today, raw: load.raw, ix, accountLabel, priceBlock, launchesBlocked,
  }), [items, population, filter, today, load.raw, ix, accountLabel, priceBlock, launchesBlocked])

  // "Export what you see" writes the per-route survey rows behind Tile 4.
  // Keyed on the rows' CONTENT, not the model's identity: a shell that hands
  // down a fresh population array on every render would otherwise re-register
  // on every render, and a register that sets state would never settle.
  const exportRows = useMemo(() => tile4ExportRows(model), [model])
  const exportKey = useMemo(() => JSON.stringify(exportRows), [exportRows])
  useEffect(() => {
    registerExport({ name: 'finance-per-respondent-surveys', columns: TILE4_EXPORT_COLUMNS, rows: exportRows })
    return () => registerExport(null)
    // exportRows is read through exportKey on purpose (see above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportKey, registerExport])

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-[13px] leading-relaxed text-muted-foreground">{model.guidance}</p>
      <RespondentCostTile model={model} tab={props} />
      <MarginLeversTile model={model} tab={props} />
    </div>
  )
}
