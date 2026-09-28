'use client'

/**
 * "Blocked: needs data SOCC does not capture" — B1 to B6 of the finance spec.
 *
 * Listed so that nobody estimates them. Each one would take a new column or an
 * importer change to measure, and until then the page leaves the figure blank
 * rather than filling it with a guess that reads like a measurement. Where the
 * loaded data can say how much of the book a gap touches (B1, B5), the count is
 * computed; the rest are words only.
 */

import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { fmtNum } from '@/lib/utils/number'
import type { BlockedDatum } from '@/lib/finance/improve'
import type { FinanceTabProps } from '../tabs/types'
import { FinanceCard } from '../tabs/Card'

export function BlockedDataCard({ items, props }: {
  items: BlockedDatum[]
  props: Pick<FinanceTabProps, 'load' | 'scope'>
}) {
  return (
    <FinanceCard
      id="blocked-data"
      title="Blocked: needs data SOCC does not capture"
      help="None of these can be fixed by filling in a field that exists today. They are listed, never estimated, and each says what new data would unlock it."
      scope={props.scope.chip}
      needs={['survey_projects']}
      blocked={props.load.blocked}
      verdict={`${fmtNum(items.length)} measures stay blank until SOCC captures the data named above; none of them is estimated.`}
    >
      <ul className="divide-y divide-border">
        {items.map(b => (
          <li key={b.key} className="flex gap-3 px-4 py-2.5">
            <span className="w-7 shrink-0 pt-0.5 text-xs font-semibold text-muted-foreground" title="Its label in the finance spec">{b.key}</span>
            <div className="min-w-0 text-[13px] leading-relaxed">
              {/* Every label on this page carries its (i): the title alone
                  names a measure without saying what it would have told us. */}
              <div className="flex items-center font-medium">{b.title}<InfoTooltip text={b.help} /></div>
              <p className="text-muted-foreground">{b.what}</p>
              <p><span className="text-muted-foreground" title="What would have to be recorded to measure this">Needs: </span>{b.needs}</p>
            </div>
          </li>
        ))}
      </ul>
    </FinanceCard>
  )
}
