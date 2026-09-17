'use client'

import { useState } from 'react'
import Link from 'next/link'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { FieldCell, useSavedFlash } from './fields'
import { cn } from '@/lib/utils'
import { fmtNum } from '@/lib/utils/number'
import { useUpdateProject } from '@/lib/hooks/useProjects'
import { useClientTerms, useTermDollars } from '@/lib/hooks/useClientTerms'
import { useCanViewFinancials } from '@/lib/hooks/useCapabilities'
import { creditValues, valueCredits } from '@/lib/finance/credits'

const TIP = {
  header:
    'What this survey costs the CLIENT, in credits, and which contract it draws down. This is the revenue side in the client’s own unit — not our cost to run, which is the spend above. Sales can see both of these; cost and margin they cannot.',
  credits:
    'Credits for this survey. Entered when the scope is confirmed — i.e. when it moves to an active stage. BLANK IS NOT ZERO: blank means not priced yet, and the client-facing consumption totals count it as unknown rather than free. Enter 0 only for work genuinely done at no charge.',
  term:
    'Which contract this survey draws down. Until it is attached, its credits count toward nothing — the client’s remaining balance will not move. Contracts are created on the client page.',
  implied:
    'What these credits work out to per completed interview: (credits × the contract’s dollars per credit) ÷ N. FINANCE ONLY, because it is contract value in dollars — the credit count above is public, this is not. Divided by BILLABLE N once the survey has delivered, because that is what a rate-priced survey bills on and the two have to be comparable; before delivery it divides by target, which is the figure the work was quoted against, and says so.',
}

/**
 * Credits and the contract this survey draws down.
 *
 * PUBLIC, NOT FINANCE-GATED, and that is a deliberate line. Credits are what the
 * CLIENT is spending, in the client's own unit, and a salesperson has to be able
 * to say "this one is 12 credits" — the sales portal shows the same field. What
 * stays finance-only is our side: the dollar price per N, contract value, margin
 * and the budget ceiling. Cost and revenue are different questions.
 *
 * Migration 100 added both columns and nothing has ever written them: every row
 * in production has null credits and no contract. So this component is the
 * entire input path, and the consumption rollups on the client page and the
 * sales account page have been counting an empty set until now.
 */
export function ProjectCredits({
  projectId, clientId, credits, termId, nTarget, nActual,
}: {
  projectId: string
  clientId: string | null
  credits: number | null
  termId: string | null
  /** For the implied $ / N. Optional so existing call sites keep compiling; the
   *  implied figure simply does not render without them. */
  nTarget?: number | null
  nActual?: number | null
}) {
  const updateProject = useUpdateProject()
  const canFinance = useCanViewFinancials()
  const { data: terms = [] } = useClientTerms(clientId ?? '')
  // RLS-gated (100): a non-holder gets an empty object, indistinguishable from
  // "not set" on purpose, so the implied row simply does not appear.
  const { data: dollars = {} } = useTermDollars(terms.map(t => t.id))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saved, flash] = useSavedFlash()

  function commit() {
    const raw = draft.trim().replace(/,/g, '')
    // Empty clears back to "not priced", which is a real and different state
    // from 0 — see the tooltip. An unparseable entry leaves the value alone
    // rather than guessing.
    const next = raw === '' ? null : Number(raw)
    if (raw !== '' && !Number.isFinite(next)) { setEditing(false); return }
    updateProject.mutate({ id: projectId, updates: { credits: next } })
    flash()
    setEditing(false)
  }

  const term = terms.find(t => t.id === termId) ?? null

  return (
    <div className="border-t border-border pt-3">
      <p className="mb-3 flex items-center text-xs font-medium uppercase tracking-widest text-muted-foreground">
        Client credits
        <InfoTooltip text={TIP.header} />
      </p>

      <div className="flex flex-col gap-2">
        {editing ? (
          <FieldCell label="Credits" tooltip={TIP.credits} editing saved={saved}>
            <input
              autoFocus type="text" inputMode="numeric" value={draft}
              placeholder="e.g. 12 — blank means not priced yet"
              onChange={e => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
                if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
              }}
              className="w-full rounded border border-border bg-muted px-2 py-1 text-sm focus:border-ring focus:outline-none"
            />
          </FieldCell>
        ) : (
          <FieldCell
            label="Credits" tooltip={TIP.credits} editable saved={saved}
            onEdit={() => { setDraft(credits == null ? '' : String(credits)); setEditing(true) }}
          >
            {credits == null
              ? <span className="text-muted-foreground/50">— not priced</span>
              : <span className="tabular-nums">{fmtNum(credits)}</span>}
          </FieldCell>
        )}

        <FieldCell label="Contract" tooltip={TIP.term}>
          {clientId == null ? (
            <span className="text-muted-foreground/50">— no client on this project</span>
          ) : terms.length === 0 ? (
            <span className="text-xs text-muted-foreground/70">
              No contracts on this client yet —{' '}
              <Link href={`/clients/${clientId}`} className="text-primary hover:underline">add one</Link>
            </span>
          ) : (
            <select
              value={termId ?? ''}
              onChange={e =>
                updateProject.mutate({ id: projectId, updates: { term_id: e.target.value || null } })
              }
              className={cn(
                'w-full rounded border border-border bg-transparent px-1.5 py-0.5 text-sm focus:border-ring focus:outline-none',
                !termId && 'text-muted-foreground/60',
              )}
            >
              <option value="">— not attached</option>
              {terms.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.credits_total != null ? ` · ${fmtNum(t.credits_total)} credits` : ''}
                </option>
              ))}
            </select>
          )}
        </FieldCell>

        {/* The $ / N David asked for on a credit-priced survey (2026-09-17):
            "a record may have credits associated with it, but id ideally still
            want to see the $ / N so i can better understand costs".

            Finance-only, because it is contract value in dollars — the credit
            count above is deliberately public and this is deliberately not.
            Derived from the contract's own dollars ÷ credits rather than a
            stored rate: a third number could disagree with the two it came
            from. */}
        {canFinance && (() => {
          const values = creditValues(
            terms.map(t => ({ id: t.id, client_id: t.client_id, name: t.name, credits_total: t.credits_total })),
            new Map(Object.entries(dollars)))
          const v = valueCredits(
            { id: projectId, project_code: null, project_name: null, client: null,
              client_id: clientId, project_type: null, board_column: null, status: null,
              phase: null, deliver_date: null, launch_date: null, submitted_date: null,
              n_target: nTarget ?? null, n_collected: null, n_actual: nActual ?? null,
              credits, term_id: termId },
            values)
          if (!v || v.contracted == null) return null
          return (
            <FieldCell label="Implied $ / N" tooltip={TIP.implied}>
              <span className="tabular-nums">
                {v.impliedRatePerN != null
                  ? '$' + v.impliedRatePerN.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : <span className="text-muted-foreground/50">— no N recorded</span>}
                <span className="ml-2 text-xs text-muted-foreground">
                  {'$' + Math.round(v.contracted).toLocaleString('en-US')} contracted
                  {v.impliedBasis === 'target' && ' · against target, not yet delivered'}
                </span>
              </span>
            </FieldCell>
          )
        })()}

        {/* The two failure modes worth naming, because each makes a client-facing
            total silently wrong rather than visibly missing. */}
        {credits != null && termId == null && terms.length > 0 && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            Priced at {fmtNum(credits)} credits but not attached to a contract, so it draws down nothing.
          </p>
        )}
        {credits == null && term != null && (
          <p className="text-[11px] text-muted-foreground">
            Attached to {term.name}, but unpriced — it counts as unknown against that contract, not as zero.
          </p>
        )}
      </div>
    </div>
  )
}
