'use client'

/**
 * The rules this engine refuses to recommend, with why.
 *
 * Moved here from the retired Save tab (components/finance/SaveTab.tsx, "What
 * this engine refuses to do"). Those were case studies from one day, typed in;
 * here each is recomputed on the view where the data allows
 * (lib/finance/perRespondent.ts rejectedRules), and the one figure the page
 * cannot recompute — it needs the change history — stays, dated. A reader who
 * does not see a rule that was rejected will propose it again next quarter.
 */

import { REJECTED_TESTED_ON, type PerRespondentModel } from '@/lib/finance/perRespondent'
import { FinanceCard, Note } from '@/components/finance/tabs/Card'

export const REJECTED_ANCHOR = 'rejected-rules'

export function RejectedRules({ model, onClose }: { model: PerRespondentModel; onClose: () => void }) {
  const t = model.levers
  return (
    <FinanceCard
      id={REJECTED_ANCHOR}
      title="Rules tested and rejected"
      help={`Rules that look obvious, were tested against the data on ${REJECTED_TESTED_ON}, and lose money. The figures are recomputed on this view where the data allows; a figure that cannot be is dated.`}
      scope={t.scope.chip}
      ignored={t.scope.ignored}
      actions={
        <button type="button" onClick={onClose} className="text-xs font-medium text-muted-foreground hover:text-foreground" title="Hide this section">
          Close
        </button>
      }
      verdict={model.rejectedVerdict}
    >
      <ol className="divide-y divide-border/60">
        {model.rejected.map((r, i) => (
          <li key={r.key} className="px-4 py-3">
            <div className="text-sm font-medium">
              <span className="mr-1.5 text-muted-foreground">{i + 1}.</span>{r.title}
            </div>
            {r.now.map((p, k) => (
              <p key={k} className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{p}</p>
            ))}
            {r.dated && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">Tested {REJECTED_TESTED_ON}:</span> {r.dated}
              </p>
            )}
          </li>
        ))}
      </ol>
      <Note>
        First tested on {REJECTED_TESTED_ON}. Listed because a rejected rule with its numbers is worth more than a silent omission.
      </Note>
    </FinanceCard>
  )
}
