'use client'

import { useState } from 'react'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { CalcMark } from './fields'
import { fmtNum } from '@/lib/utils/number'
import { useProject } from '@/lib/hooks/useProjects'
import { useProjectSegments } from '@/lib/hooks/useProjectSegments'
import { useProjectBlasts } from '@/lib/hooks/useProjectBlasts'
import { unknownCostBlasts, unknownSendBlasts } from '@/lib/utils/blast'
import { useCapabilities, useCanViewFinancials } from '@/lib/hooks/useCapabilities'
import {
  useProjectRates,
  useSetProjectRate,
  useSetSegmentRate,
} from '@/lib/hooks/useProjectFinancials'
import {
  effectiveRate,
  isInherited,
  rollup,
  contractRange,
  margin,
  marginRange,
  marginPct,
  hasRecordedCost,
  invoicedAtCollected,
  ceilingOvershoot,
  type PriceLine,
} from '@/lib/utils/pricing'

const TIP = {
  header:
    'What the CLIENT pays us — the revenue side. Visible only to the people who hold the finance capability (David, Shanu, Vineet); everyone else sees the cost side of this card and nothing here. That hiding also covers CSV export, the assistant/connector and the daily digest, because those are the paths a hidden number would otherwise walk out through. It is a visibility convenience, not a security control.',
  projectRate:
    'The default price the client pays per completed response, for the whole project. Every segment inherits this unless it is given its own rate.',
  segmentRate:
    'This segment’s price per completed response. Blank = inherits the project default; type a number to override it just for this segment (✕ puts it back to inheriting).',
  blended:
    'The weighted average price per N = Σ(rate × N) ÷ ΣN. Shown at both ends of the N range because the segment mix — and therefore the average — shifts between the minimum and maximum N. Segments with no rate at all are left out of both halves of that division, so an unpriced segment can’t make the average look like a discount.',
  contract:
    'Contract value = Σ(rate × N target min) .. Σ(rate × N target max). Two numbers, not one, because the N target is a range: the low end is what we earn delivering the minimum we committed to, the high end if the client takes the full range.',
  margin:
    'Contract value minus Actual $ (the trigger-computed spend: blasts + suppliers + flat vendor fees). Margin against money already committed, not a forecast against the budget.',
  marginNoCost:
    'Nothing has been logged on the cost side yet — no blast, no supplier, no flat vendor fee — so Actual $ is still nothing and this figure is the contract value, not a margin. It is shown without a percentage on purpose: a 100% margin here would read as pure profit when the honest statement is that we don’t know yet what running this costs.',
  invoiced:
    'What the job is worth priced at the N actually collected so far, rather than at target — Σ(rate × N collected) — and the margin that leaves against Actual $.',
  invoicedNoCost:
    'What the job is worth priced at the N actually collected so far, rather than at target — Σ(rate × N collected). No margin is shown next to it because nothing has been logged on the cost side yet: it would repeat this same number at 100%.',
  // A THIRD state, distinct from "no cost logged". Some cost is recorded, so the
  // two NoCost strings above ("nothing has been logged") would be a plain lie —
  // and the number is worse than unknown here, it is knowably too high, because
  // every unrecorded blast is missing from the subtraction.
  marginPartialCost:
    'Some of this project’s cost is not recorded yet: one or more blasts is missing a figure its cost needs — the completes for the reward half, or the sent count for the send half — and a blast only counts toward Actual $ once it has them. So Actual $ is understated, and this margin is therefore OVERSTATED by whatever those blasts cost. Fill in the blank figures on the blast lines above and it settles.',
  invoicedPartialCost:
    'What the job is worth priced at the N actually collected so far — Σ(rate × N collected). The margin beside it is marked indicative because one or more blasts is missing a figure its cost needs (completes, or the sent count), so the cost being subtracted is incomplete and the margin reads higher than it is.',
  unpriced:
    'N belonging to segments with no rate — neither their own nor a project default. It is excluded from the blended rate and from the contract value, so both figures understate the job until it is priced.',
  ceiling:
    'The total budget is a COST CEILING (the most we intend to spend), not client revenue — so it is never expected to equal the contract value. What matters is the direction: a ceiling ABOVE what the contract earns at its minimum N means spending the full budget loses money if the client takes only that minimum. This check only appears once every segment has a rate: with unpriced N in the mix the contract value is understated, and comparing a real ceiling against a fraction of the revenue would raise the alarm on projects that are fine.',
}

function money(v: number | null): string {
  if (v == null) return '—'
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function rateText(v: number | null): string {
  if (v == null) return '—'
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pctText(v: number | null): string {
  if (v == null) return '—'
  return `${Math.round(v)}%`
}

/** Inline-editable $/N. Its own control rather than NumberCell because a rate has
 *  cents and commitNumber Math.rounds — $3.50 would save as $4. Matches the
 *  click-to-edit amount in BudgetWidget. */
function EditableRate({
  value,
  editValue,
  onSave,
  placeholder,
  muted = false,
}: {
  value: number | null
  /**
   * What the editor starts with, when that differs from what is displayed. An
   * inherited segment DISPLAYS the project default but must open EMPTY: seeding
   * the box with the inherited number means opening a cell and pressing Enter
   * silently pins an override at today's default, and a later change to the
   * project rate then quietly stops reaching that segment.
   */
  editValue?: number | null
  onSave: (v: number | null) => void
  placeholder: string
  /** Render an inherited value dimmed, so an override reads as the darker one. */
  muted?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEdit() {
    const seed = editValue === undefined ? value : editValue
    setDraft(seed != null ? String(seed) : '')
    setEditing(true)
  }
  function commitEdit() {
    const raw = draft.trim().replace(/[$,]/g, '')
    const parsed = parseFloat(raw)
    onSave(raw === '' || Number.isNaN(parsed) ? null : parsed)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={e => {
          if (e.key === 'Enter') commitEdit()
          if (e.key === 'Escape') setEditing(false)
        }}
        placeholder={placeholder}
        className="w-24 rounded border border-border bg-muted px-2 py-0.5 text-right text-sm text-foreground focus:border-blue-500 focus:outline-none"
      />
    )
  }
  return (
    <button
      onClick={startEdit}
      className={`cursor-pointer text-sm tabular-nums transition-colors hover:underline ${muted ? 'text-muted-foreground' : 'text-foreground'}`}
      title="Click to edit"
    >
      {rateText(value)}
    </button>
  )
}

interface PricingWidgetProps {
  projectId: string
  /** The cost ceiling from survey_projects.budget — used ONLY for the
   *  negative-margin-at-the-ceiling check, never reconciled against revenue. */
  budget: number | null
  /** Combined actual spend (blasts + suppliers + flat cost lines). */
  actualSpend: number | null
}

/**
 * The revenue half of the Money section: client price per N (project default plus
 * per-segment overrides), the blended rate at both ends of the N range, contract
 * value, and margin against actual spend.
 *
 * RESTRICTED to holders of the `view_financials` capability. Everything renders
 * from a single settled `true` — never while the check is in flight — because a
 * flash of a price before the gate resolves is the whole leak. Non-holders get a
 * neutral one-liner, not an access-denied.
 */
export function PricingWidget({ projectId, budget, actualSpend }: PricingWidgetProps) {
  const canViewFinancials = useCanViewFinancials()
  // useCanViewFinancials already fails closed while in flight; this second call
  // shares its query key (one fetch) and only tells us WHY it is false, so a
  // holder doesn't see the "tracked by David, Shanu & Vineet" line flash past
  // before their own numbers arrive.
  const { isLoading } = useCapabilities()
  // Both of these are already in the page's cache under the same keys, so this
  // is a read, not a second round-trip.
  const { data: project } = useProject(projectId)
  const { data: segments } = useProjectSegments(projectId)
  // Passing '' disables the query: a non-holder never even asks for the prices.
  const { data: rates } = useProjectRates(canViewFinancials ? projectId : '')
  const setProjectRate = useSetProjectRate(projectId)
  const setSegmentRate = useSetSegmentRate(projectId)
  // MUST stay above the early returns below, with every other hook.
  //
  // This used to sit ~80 lines further down, beside the cost-confidence logic
  // that consumes it — readable, and a violation of the rules of hooks that took
  // the whole project page down. On the first render `isLoading` is true, the
  // component returns null, and this line never runs; the moment capabilities
  // resolve it does, so React sees more hooks than the render before and throws
  // "Rendered more hooks than during the previous render". The page's error
  // boundary then replaced the entire project view with "Something went wrong",
  // for exactly the three people who can see financials.
  //
  // It reads the same react-query key the Money section already uses, so this is
  // a cache hit rather than a second fetch — moving it up costs nothing.
  const { data: blastRows = [] } = useProjectBlasts(projectId)

  // Hidden until the capability check has actually come back true.
  if (isLoading) return null

  if (!canViewFinancials) {
    return (
      <div className="border-t border-border pt-3">
        <p className="text-xs text-muted-foreground/70">
          Client pricing and margin are tracked by David, Shanu &amp; Vineet.
        </p>
      </div>
    )
  }

  // The hook degrades a missing table/column to "no rate" rather than throwing, so
  // this reads its flag rather than isError — otherwise the pre-082 state would
  // render as a priced project whose every rate happens to be blank.
  if (rates?.unavailable) {
    return (
      <div className="border-t border-border pt-3">
        <p className="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">Client price</p>
        <p className="text-xs text-muted-foreground/70">
          Client pricing couldn’t be read — it needs the project_financials migration (082) in Supabase.
        </p>
      </div>
    )
  }

  const projectRate = rates?.projectRate ?? null
  const overrideById = new Map((rates?.segments ?? []).map(s => [s.id, s.rate]))
  const segList = segments ?? []

  // One priced line per segment; a project with no segments is a single line
  // carrying the project's own N range. Both shapes feed the same pure math.
  const lines: PriceLine[] = segList.length
    ? segList.map(s => ({
        rate: effectiveRate(overrideById.get(s.id) ?? null, projectRate),
        nMin: s.n_target,
        nMax: s.n_target_max,
        nCollected: s.n_collected,
      }))
    : [
        {
          rate: projectRate,
          nMin: project?.n_target ?? null,
          nMax: project?.n_target_max ?? null,
          nCollected: project?.n_collected ?? null,
        },
      ]

  const lo = rollup(lines, 'min')
  const hi = rollup(lines, 'max')
  const contract = contractRange(lines)
  const margins = marginRange(lines, actualSpend)
  const invoiced = invoicedAtCollected(lines)

  // Totals across ALL lines (priced or not) — this is the N the client is being
  // quoted, which is not the same as the N that has a price on it.
  const nMinTotal = lo.pricedN + lo.unpricedN
  const nMaxTotal = hi.pricedN + hi.unpricedN
  const isRange = nMaxTotal > nMinTotal
  const unpriced = Math.max(lo.unpricedN, hi.unpricedN)

  // Only compare the ceiling against a COMPLETE contract value. contractRange()
  // excludes unpriced lines — the same exclusion the amber notice below warns
  // about — so with one segment priced out of three this would confidently
  // announce a loss off a third of the revenue. The notice is already on screen
  // saying the figures understate the job, so staying quiet loses nothing.
  const overshoot = unpriced === 0 ? ceilingOvershoot(budget, contract?.low ?? null) : null

  // Whether Actual $ means anything yet. Two ways it can fail, and the second one
  // is newer and nastier.
  //
  //  1. Null or still 0 — nothing logged on the cost side at all, which must NOT
  //     render as a green 100% margin.
  //  2. PARTIALLY logged. actual_spend counts only the blasts whose completes
  //     someone has recorded, so one recorded blast plus one unrecorded one gives
  //     a spend that is > 0 and therefore passes hasRecordedCost() — while being
  //     understated by the whole missing blast. The widget would then drop the
  //     "(indicative)" qualifier and state a confident margin and margin %, both
  //     too high, on the exact screen this change exists to make trustworthy.
  const unknownBlasts = unknownCostBlasts(blastRows)
  // BOTH halves. 095 made a blast cost the reward AND the send, and they are
  // unknown independently: a blast can have every completion recorded and no
  // sent count, which leaves unknownBlasts at 0 while the spend is still
  // knowably short. Counting only the reward here would drop the
  // "(indicative)" qualifier and state a confident margin off an understated
  // cost, which is precisely what the note above says this code exists to
  // stop. Reachable through "+ Log blast", which starts a blast with no
  // sent count on purpose.
  const unknownSend = unknownSendBlasts(blastRows)
  const costKnown = hasRecordedCost(actualSpend) && unknownBlasts === 0 && unknownSend === 0
  const marginText =
    margins == null
      ? '—'
      : margins.high > margins.low
        ? `${money(margins.low)} – ${money(margins.high)}`
        : money(margins.low)

  return (
    <div className="border-t border-border pt-3">
      <p className="mb-3 flex items-center text-xs font-medium uppercase tracking-widest text-muted-foreground">
        Client price &amp; margin
        <InfoTooltip text={TIP.header} />
        <span
          className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-muted-foreground"
          title="Only holders of the finance capability see this block."
        >
          Finance-only
        </span>
      </p>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center text-xs text-muted-foreground">
            Price / N {segList.length > 0 ? '(default)' : ''}
            <InfoTooltip text={TIP.projectRate} />
          </span>
          <EditableRate
            value={projectRate}
            onSave={v => setProjectRate.mutate(v)}
            placeholder="e.g. 3.50"
          />
        </div>

        {segList.length > 0 && (
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-background/60 p-2">
            <p className="flex items-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Per segment
              <InfoTooltip text={TIP.segmentRate} />
            </p>
            {segList.map((s, i) => {
              const override = overrideById.get(s.id) ?? null
              const inherited = isInherited(override)
              const eff = effectiveRate(override, projectRate)
              return (
                <div key={s.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {s.label || `Segment ${i + 1}`}
                    <span className="ml-1 text-muted-foreground/60">
                      · {inherited ? 'inherited' : 'override'}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <EditableRate
                      value={eff}
                      editValue={override}
                      muted={inherited}
                      onSave={v => setSegmentRate.mutate({ id: s.id, rate: v })}
                      placeholder={projectRate != null ? `${rateText(projectRate)} default` : 'e.g. 4.00'}
                    />
                    {!inherited && (
                      <button
                        onClick={() => setSegmentRate.mutate({ id: s.id, rate: null })}
                        title="Clear the override — inherit the project default"
                        className="text-xs text-muted-foreground/50 transition-colors hover:text-foreground"
                      >
                        ✕
                      </button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="flex items-center text-xs text-muted-foreground">
            Blended $ / N
            <InfoTooltip text={TIP.blended} />
            {/* NOT "contract value ÷ total N" — that was wrong and shipped a
                formula the reader could follow to the wrong number. `blended` is
                revenue ÷ pricedN (lib/utils/pricing.ts:90): unpriced lines are
                excluded from BOTH halves. The "at N …" beside it is the TOTAL
                including unpriced, so on a partly-priced project dividing the two
                figures on screen gives a number pricing.test.ts:72-83 exists to
                forbid. Worded to match the (i) two pixels to its left. */}
            <CalcMark from="Σ(rate × N) ÷ ΣN, priced segments only" />
          </span>
          <span className="text-sm tabular-nums text-foreground">
            {isRange ? (
              <>
                {rateText(lo.blended)} <span className="text-muted-foreground">at N {fmtNum(nMinTotal)}</span>
                {' → '}
                {rateText(hi.blended)} <span className="text-muted-foreground">at N {fmtNum(nMaxTotal)}</span>
              </>
            ) : (
              <>
                {rateText(lo.blended)} <span className="text-muted-foreground">at N {fmtNum(nMinTotal)}</span>
              </>
            )}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="flex items-center text-xs text-muted-foreground">
            Contract value
            <InfoTooltip text={TIP.contract} />
            {/* Phrased to match the (i) beside it. Two wordings of one formula is
                the drift this whole change exists to stop. */}
            <CalcMark from="Σ (price / N × N target), min end .. max end" />
          </span>
          <span className="text-sm font-medium tabular-nums text-foreground">
            {contract == null
              ? '—'
              : contract.high > contract.low
                ? `${money(contract.low)} – ${money(contract.high)}`
                : money(contract.low)}
          </span>
        </div>

        {unpriced > 0 && (
          <p className="flex items-center text-[11px] text-amber-600 dark:text-amber-400">
            Excludes {fmtNum(unpriced)} N with no rate — both figures above understate the job.
            <InfoTooltip text={TIP.unpriced} />
          </p>
        )}

        <div className="flex items-center justify-between">
          <span className="flex items-center text-xs text-muted-foreground">
            Margin{!costKnown && margins != null ? ' (indicative)' : ''}
            <InfoTooltip text={costKnown ? TIP.margin : unknownBlasts > 0 ? TIP.marginPartialCost : TIP.marginNoCost} />
            <CalcMark from="Contract value − Actual $" />
          </span>
          {margins == null ? (
            <span className="text-sm text-muted-foreground">—</span>
          ) : !costKnown ? (
            // Neutral, and with no percentage: green and "100%" would sell an
            // unknown cost as the best possible news. Two different reasons land
            // here and they need different words — "no cost logged yet" is simply
            // untrue when some blasts ARE recorded and others are not, and that
            // second case is the more dangerous one, because the number is not
            // merely unknown, it is knowably too high.
            <span className="text-sm tabular-nums text-muted-foreground">
              {marginText}
              <span className="ml-1">
                {unknownBlasts > 0
                  ? `· ${unknownBlasts} blast${unknownBlasts === 1 ? '' : 's'} with no completes recorded — overstated`
                  : '· no cost logged yet'}
              </span>
            </span>
          ) : (
            <span
              className={`text-sm font-medium tabular-nums ${
                margins.low < 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {marginText}
              {contract && (
                <span className="ml-1 font-normal text-muted-foreground">
                  ·{' '}
                  {contract.high > contract.low
                    ? `${pctText(marginPct(contract.low, actualSpend))}–${pctText(marginPct(contract.high, actualSpend))}`
                    : pctText(marginPct(contract.low, actualSpend))}
                </span>
              )}
            </span>
          )}
        </div>

        {invoiced != null && (
          <div className="flex items-center justify-between">
            <span className="flex items-center text-xs text-muted-foreground">
              At N collected
              <InfoTooltip text={costKnown ? TIP.invoiced : unknownBlasts > 0 ? TIP.invoicedPartialCost : TIP.invoicedNoCost} />
              <CalcMark from="rate × N collected, then − Actual $ for the margin beside it" />
            </span>
            <span className="text-sm tabular-nums text-foreground">
              {money(invoiced)}
              <span className="ml-1 text-muted-foreground">
                {costKnown ? (
                  <>
                    · margin {money(margin(invoiced, actualSpend))} ·{' '}
                    {pctText(marginPct(invoiced, actualSpend))}
                  </>
                ) : (
                  // Same reason as the Margin row: with no cost recorded, the
                  // margin here would just be this number again, at 100%.
                  <>· no cost logged yet</>
                )}
              </span>
            </span>
          </div>
        )}

        {overshoot != null && (
          <div className="mt-1 flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
            <span className="shrink-0">⚠</span>
            <span>
              The {money(budget)} cost ceiling is {money(overshoot)} above the {money(contract?.low ?? null)}{' '}
              contract value at the minimum N of {fmtNum(nMinTotal)} — if the client takes only that
              minimum, spending the full budget loses money.
              <InfoTooltip text={TIP.ceiling} />
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
