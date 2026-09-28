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
  billedFor,
  overage,
  ceilingOvershoot,
  type PriceLine,
} from '@/lib/utils/pricing'
import {
  deliveredNOf, segmentCheck, segmentPriceDiffers, type RevenueSubject,
} from '@/lib/finance/revenue'
import { moneyAuto } from '@/lib/finance/format'

const TIP = {
  header:
    'What the CLIENT pays us — the revenue side. Visible only to the people who hold the finance capability (David, Shanu, Vineet); everyone else sees the cost side of this card and nothing here. That hiding also covers CSV export, the assistant/connector and the daily digest, because those are the paths a hidden number would otherwise walk out through. It is a visibility convenience, not a security control.',
  projectRate:
    'The price the client pays per completed response, for the whole project — the ONE rate the invoice uses, so it is the rate behind Profit and Billable below. Every segment inherits this unless it is given its own rate; a segment’s own rate feeds only the blended rate and contract value, never the bill.',
  segmentRate:
    'This segment’s price per completed response. Blank = inherits the project default; type a number to override it just for this segment (✕ puts it back to inheriting). The invoice uses ONE rate — the project’s Price / N above — so a segment price does not change what is billed or the profit below; it only feeds the blended rate and contract value. When they differ, this card and the Finance page say so.',
  blended:
    'The weighted average price per N = Σ(rate × N) ÷ ΣN. Shown at both ends of the N range because the segment mix — and therefore the average — shifts between the minimum and maximum N. Segments with no rate at all are left out of both halves of that division, so an unpriced segment can’t make the average look like a discount.',
  contract:
    'Contract value = Σ(rate × N target min) .. Σ(rate × N target max). Two numbers, not one, because the N target is a range: the low end is what we earn delivering the minimum we committed to, the high end if the client takes the full range. It reads each segment’s own price where one is set; the bill itself uses the project’s one Price / N (see Billable below).',
  profit:
    'What this survey has actually MADE: what the client is billable for — Price / N × min(N actual, top of the N range), on the survey as a whole — minus Actual $, the trigger-computed spend (blasts + suppliers + flat vendor fees). Billable N is capped at the top of the range the client bought, because delivery above it is never charged, and it uses the cleaned N actual — never the raw N collected — because the cleaned figure is what gets invoiced. Segments do not split the bill: the invoice is the survey’s. The same number the Finance page uses for this survey.',
  profitNoN:
    'Nothing is billable until the cleaned (post-QA) N actual is entered — the raw N collected is never billed. Any spend already incurred is shown as the hole it currently is, which is the honest reading before delivery.',
  profitNoCost:
    'Nothing has been logged on the cost side yet — no blast, no supplier, no flat vendor fee — so this figure is the billable amount, not a profit. Shown without a percentage on purpose: 100% would read as pure profit when the honest statement is that we do not yet know what running this costs.',
  profitPartialCost:
    'Some of this project’s cost is not recorded yet: a blast is missing either its completes (the reward half) or its sent count (the send half), and a blast only counts toward Actual $ once it has them. So the cost being subtracted is short and this profit is OVERSTATED. Fill in the blanks on the blast lines above and it settles.',
  overage:
    'Cleaned N delivered ABOVE the top of the N range, and what it would have been worth at this project’s rate. The client is never charged for it — over-delivery is a courtesy (new clients are sometimes over-delivered on purpose the first time) — but we paid the reward and the send cost to collect it. Measured on the survey as a whole, the way it is billed: a segment over its own target while another is under is not over-delivery when the survey is inside its range. Nothing in SOCC showed this figure before.',
  segmentCounts:
    'The segments’ N actuals should add up to the survey’s N actual. Nothing is held back when they do not — the bill uses the survey’s N actual — but a segment edit rolls the segments up into the survey’s figure on save, so a mismatch here can change the bill later. Fix whichever one is wrong.',
  segmentRolledUp:
    'The survey’s own N actual is blank, so the bill uses the segments’ total instead — every segment has one. Enter the survey’s N actual to make it the survey’s own figure.',
  segmentPrice:
    'The invoice uses one rate per survey — Price / N above. A segment priced differently changes nothing that is billed; it is shown so the two can be made to agree. The contract value and blended rate above still read the segment prices.',
  profitUnpriced:
    'No price per N is set, so there is no revenue side and no profit to compute. Set the rate above.',
  forecast:
    'What the job would be worth if it delivers to its N TARGET — contract value minus Actual $ — shown as a range because the target is a range. This is a PROJECTION, not a result: it assumes an N that has not been collected yet. The Profit row above is the actual position.',
  invoiced:
    'Price / N × min(N actual, top of the N range), on the survey as a whole — what the client is billable for on what has actually been delivered, before cost. The first of the two numbers behind Profit above. Two deliberate caps: the CLEANED N actual, not the raw N collected, and never more than the top of the range, because N delivered above it is not charged.',
  unpriced:
    'N belonging to segments with no rate — neither their own nor a project default. It is excluded from the blended rate and from the contract value, so both figures understate the job until it is priced.',
  ceiling:
    'The total budget is a COST CEILING (the most we intend to spend), not client revenue — so it is never expected to equal the contract value. What matters is the direction: a ceiling ABOVE what the contract earns at its minimum N means spending the full budget loses money if the client takes only that minimum. This check only appears once every segment has a rate: with unpriced N in the mix the contract value is understated, and comparing a real ceiling against a fraction of the revenue would raise the alarm on projects that are fine.',
}

// Through the finance formatter so a negative reads −$4,487 (not "$-4,487")
// and an amount under $10 keeps its cents.
function money(v: number | null): string {
  if (v == null) return '—'
  return moneyAuto(v)
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

  // THE PRICE LIST: one priced line per segment; a project with no segments is
  // a single line carrying the project's own N range. These feed the blended
  // rate and the contract value only — never the bill, which is the survey's.
  const lines: PriceLine[] = segList.length
    ? segList.map(s => ({
        rate: effectiveRate(overrideById.get(s.id) ?? null, projectRate),
        nMin: s.n_target,
        nMax: s.n_target_max,
        nCollected: s.n_collected,
        nActual: s.n_actual,
      }))
    : [
        {
          rate: projectRate,
          nMin: project?.n_target ?? null,
          nMax: project?.n_target_max ?? null,
          nCollected: project?.n_collected ?? null,
          nActual: project?.n_actual ?? null,
        },
      ]

  const lo = rollup(lines, 'min')
  const hi = rollup(lines, 'max')
  const contract = contractRange(lines)
  const margins = marginRange(lines, actualSpend)
  /* WHAT THE CLIENT OWES, not what we collected. This was invoicedAtCollected —
     Σ(rate × raw n_collected), uncapped — which broke both of David's rules
     (2026-09-10): bill the CLEANED n_actual, and never bill above target. On the
     twenty projects whose rate was recovered from email it overstated revenue by
     $44,326, 36% high. */
  // THE BILL: the survey as a whole (David, 2026-09-27: "when we bill its just
  // the n actual. we dont break it out usually on the invoice by segment"). Its
  // own N fields, plus the segments for the notes — the shape the Finance page
  // loads, handed to the ONE revenue function (lib/finance/revenue.ts), so this
  // figure is the same number the Finance page shows for this survey.
  // `billed.reason` says why there is none yet.
  const survey: RevenueSubject = {
    n_target: project?.n_target ?? null,
    n_target_max: project?.n_target_max ?? null,
    n_actual: project?.n_actual ?? null,
    segments: segList.map(s => ({
      n_target: s.n_target,
      n_target_max: s.n_target_max,
      n_actual: s.n_actual,
      price_per_n: overrideById.get(s.id) ?? null,
    })),
  }
  const billed = billedFor(survey, projectRate)
  const invoiced = billed.revenue
  const over = overage(survey, projectRate)
  // The two segment NOTES. Neither changes a figure on this card.
  const segCheck = segmentCheck(survey)
  const segPriceDiffers = segmentPriceDiffers(survey, projectRate)
  const segCountText = !segCheck.disagree
    ? null
    : (segCheck.missing > 0
        ? `${fmtNum(segCheck.missing)} of ${fmtNum(segCheck.segments)} segments ${segCheck.missing === 1 ? 'has' : 'have'} no N actual`
        : `The segments add up to ${fmtNum(segCheck.segmentSum ?? 0)} N, the survey says ${fmtNum(segCheck.surveyN ?? 0)}`) +
      (segCheck.surveyN == null
        ? ', and the survey’s own N actual is blank.'
        : ' — the bill uses the survey’s.')

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

  // The survey's delivered N — what decides whether there is any profit to
  // state at all. Delivered = has anything landed at all (gates "nothing
  // collected yet"). Billable = what that delivery can actually be invoiced for.
  // Cleaned N only: the raw collected count is never billed and never stands
  // in for a missing cleaned one. The survey's own figure, the same one the
  // bill reads (the segments' total only when that is blank and every segment
  // has one).
  const nDeliveredTotal = deliveredNOf(survey).n ?? 0
  const nBillableTotal = billed.billedN ?? 0
  // Why there is no billable figure yet, in words, when the survey is priced.
  const waitingFor =
    billed.reason === 'no-n-actual' ? 'no cleaned N yet'
      : billed.reason === 'no-cap' ? 'no N target to bill against'
        : null
  // Once delivered, "so far" is misleading — the number is final, not partial.
  const isDelivered = project?.board_column === 'Delivery' || project?.delivered_at != null
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

        {/* A NOTE, not a figure: the invoice uses one rate (David, 2026-09-27),
            so a segment priced differently changes nothing that is billed. */}
        {segPriceDiffers && (
          <p className="flex items-center text-[11px] text-amber-600 dark:text-amber-400">
            {projectRate == null
              ? 'A segment carries a price but the project has none. The invoice uses one rate: set Price / N above.'
              : `A segment is priced differently from ${rateText(projectRate)} / N. The bill uses ${rateText(projectRate)}.`}
            <InfoTooltip text={TIP.segmentPrice} />
          </p>
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

        {/* PROFIT — the headline, and it is computed from what the client is
            actually billable for (the survey's rate x its billed N), NOT from
            the contract value at target.

            This used to be the other way round: the row labelled "Margin" was
            contract-at-target minus spend, and the honest figure was the muted
            grey line beneath it. On PR00402 that read "Margin $513 - $8,013"
            while the real position was 11 delivered x $500 - $4,486.81 =
            $1,013. On PR00425 it read "$5,000" against 8 of 250 N collected and
            nothing spent, where the earned figure was $160. A forecast wearing
            the label of a result, in the one place the number is used to make
            decisions. */}
        <div className="flex items-center justify-between">
          <span className="flex items-center text-xs text-muted-foreground">
            Profit{nDeliveredTotal > 0 && !isDelivered ? ' so far' : ''}
            {!costKnown && invoiced != null ? ' (indicative)' : ''}
            <InfoTooltip
              text={
                invoiced == null
                  ? (waitingFor ? TIP.profitNoN : TIP.profitUnpriced)
                  : nDeliveredTotal === 0
                    ? TIP.profitNoN
                    : costKnown
                      ? TIP.profit
                      : unknownBlasts > 0 || unknownSend > 0
                        ? TIP.profitPartialCost
                        : TIP.profitNoCost
              }
            />
            <CalcMark from="(rate × billable N) − Actual $" />
          </span>
          {invoiced == null ? (
            // Priced, but not billable yet: say what it is waiting for rather
            // than a bare dash, and show any spend as the hole it currently is.
            <span className="text-sm tabular-nums text-muted-foreground">
              {waitingFor
                ? hasRecordedCost(actualSpend)
                  ? `${money(-(actualSpend ?? 0))} · spent, ${waitingFor}`
                  : `— · ${waitingFor}`
                : '—'}
            </span>
          ) : nDeliveredTotal === 0 ? (
            // Nothing collected yet, so there is nothing earned yet. Showing
            // -Actual$ in red would be true but useless before fielding starts;
            // say what is actually the case.
            <span className="text-sm tabular-nums text-muted-foreground">
              {hasRecordedCost(actualSpend) ? `${money(-(actualSpend ?? 0))} · spent, nothing collected yet` : '— · not started'}
            </span>
          ) : !costKnown ? (
            <span className="text-sm tabular-nums text-muted-foreground">
              {money(margin(invoiced, actualSpend))}
              <span className="ml-1">
                {unknownBlasts > 0 || unknownSend > 0
                  ? '· cost incomplete — overstated'
                  : '· no cost logged yet'}
              </span>
            </span>
          ) : (
            <span
              className={`text-sm font-medium tabular-nums ${
                margin(invoiced, actualSpend) < 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {money(margin(invoiced, actualSpend))}
              <span className="ml-1 font-normal text-muted-foreground">
                · {pctText(marginPct(invoiced, actualSpend))}
              </span>
            </span>
          )}
        </div>

        {/* The two inputs to it, spelled out, so the headline is checkable. */}
        {invoiced != null && (
          <div className="flex items-center justify-between pl-3">
            <span className="flex items-center text-[11px] text-muted-foreground">
              Billable at N {fmtNum(nBillableTotal)}
              <InfoTooltip text={TIP.invoiced} />
              <CalcMark from="Price / N × min(N actual, top of N range), whole survey" />
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {money(invoiced)} − {hasRecordedCost(actualSpend) ? money(actualSpend) : '$0.00'} spent
            </span>
          </div>
        )}

        {/* OVER-DELIVERY. Only rendered when there is some — an absent row is the
            good case and does not need a line saying "none". Amber, not red: it
            is not an error, it is work given away, and the fix is upstream in how
            hard we field rather than anything on this page. */}
        {over.n > 0 && (
          <div className="flex items-center justify-between pl-3">
            <span className="flex items-center text-[11px] text-muted-foreground">
              Over target by {fmtNum(over.n)} N — not billable
              <InfoTooltip text={TIP.overage} />
              <CalcMark from="max(0, N actual − top of N range), whole survey" />
            </span>
            <span className="text-xs font-medium tabular-nums text-amber-600 dark:text-amber-400">
              {over.dollars > 0 ? `${money(over.dollars)} given away` : 'unpriced'}
            </span>
          </div>
        )}

        {/* SEGMENT COUNT NOTES. The bill is the survey's, so neither changes a
            figure above; they are said out loud so someone makes the segments
            and the survey agree (the Finance page lists them under Improve). */}
        {billed.nSource === 'segments' && (
          <p className="flex items-center pl-3 text-[11px] text-muted-foreground">
            Billed on the segments’ total of {fmtNum(nDeliveredTotal)} N: the survey’s own N actual is blank.
            <InfoTooltip text={TIP.segmentRolledUp} />
          </p>
        )}
        {segCountText && (
          <p className="flex items-center pl-3 text-[11px] text-amber-600 dark:text-amber-400">
            {segCountText}
            <InfoTooltip text={TIP.segmentCounts} />
          </p>
        )}

        {/* FORECAST — the old headline, demoted and relabelled. Still worth
            showing: it is what the job is worth if it delivers to target, which
            is the number you price against. It is just not a result. */}
        <div className="flex items-center justify-between">
          <span className="flex items-center text-xs text-muted-foreground">
            Forecast at target
            <InfoTooltip text={TIP.forecast} />
            <CalcMark from="Contract value − Actual $, at N target" />
          </span>
          {margins == null ? (
            <span className="text-sm text-muted-foreground">—</span>
          ) : (
            <span className="text-sm tabular-nums text-muted-foreground">
              {marginText}
              {contract && costKnown && (
                <span className="ml-1">
                  ·{' '}
                  {contract.high > contract.low
                    ? `${pctText(marginPct(contract.low, actualSpend))}–${pctText(marginPct(contract.high, actualSpend))}`
                    : pctText(marginPct(contract.low, actualSpend))}
                </span>
              )}
            </span>
          )}
        </div>

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
