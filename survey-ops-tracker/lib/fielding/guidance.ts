/**
 * Fielding guidance — what the measured history says to do about THIS survey.
 *
 * ── WHERE THE NUMBERS COME FROM ─────────────────────────────────────────────
 * Every constant below was measured against the live database on 2026-09-14/15
 * and then survived an adversarial pass whose job was to refute it. Of 47
 * candidate findings, 35 did not survive. The ones encoded here are the ones
 * that did, with the verifier's corrected figures rather than the first pass's.
 *
 * Each rule therefore carries its own `evidence` string naming the sample size,
 * and the UI shows it. A recommendation nobody can audit is a recommendation
 * nobody should follow — and two of the findings that DID get refuted looked
 * exactly as confident as these before someone re-ran them.
 *
 * ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────────
 * No margin advice, and no "this survey is/isn't profitable". Only 4 of 322
 * delivered surveys carry a client rate, and there is no contracts, invoices or
 * rate_cards table in the database at all. Revenue is not computable, so this
 * file talks about COST and never about profit.
 *
 * No bid recommendation either. $48,170 of bid escalation above $25 bought no
 * measurable response gain, and the apparent negative relationship is bid
 * REACTING to a failing blast rather than causing one — so the honest guidance
 * is "the bid is not your dial", which is the absence of a lever, not a lever.
 */

export const EVIDENCE_DATE = '2026-09-15'

/** Cost per complete by fielding route. Derived ONLY from projects whose
 *  recorded completes cover their n_collected — a rate taken from
 *  under-recorded projects has too small a denominator and runs ~40% high.
 *  Recomputed after migration 112, so email sends are no longer charged. */
export const ROUTE_COST = {
  blast: { p25: 37.04, median: 49.69, p75: 85.04, n: 40 },
  panel: { p25: 0.79, median: 0.88, p75: 1.00, n: 34 },
} as const

/** Response decay across successive blasts to the same list. Median ratio of
 *  each blast's response rate to the one before it (n=106 campaigns). Survived
 *  circularity, censoring and within-audience checks. */
export const WAVE_DECAY = [
  { step: '1 → 2', ratio: 0.62 },
  { step: '2 → 3', ratio: 0.69 },
  { step: '3 → 4', ratio: 0.77 },
] as const
/** After this many blasts to one list, the next one needs a reason. The last
 *  blast of a campaign runs at 46–58% of the first. */
export const WAVE_LIMIT = 3

/** SMS out-converts email on the same audience by this much. Measured at
 *  SEGMENT level — same project AND same named segment, the only clean test —
 *  across 8 matched segments. 0.0491% vs 0.0103%. 95% CI [2.49, 9.04]; sign
 *  test 7-0-1, p=0.016. Ordering was checked: email is not merely the mop-up. */
export const SMS_ADVANTAGE = { ratio: 4.74, ciLow: 2.49, ciHigh: 9.04, segments: 8 }

/** How much raw N you actually need to land n_target CLEAN completes. The
 *  measured requirement is 1.13x; anything beyond it is scrub nobody bills. */
export const BUY_MULTIPLE = 1.13

export interface BlastLike {
  completes?: number | null
  people?: number | null
  channel?: string | null
  blast_at?: string | null
  created_at?: string | null
}
export interface SupplierLike {
  cpi?: number | null
  n_collected?: number | null
}

export interface GuidanceInput {
  n_target?: number | null
  n_collected?: number | null
  n_actual?: number | null
  board_column?: string | null
  status?: string | null
  phase?: string | null
  blasts?: BlastLike[]
  suppliers?: SupplierLike[]
}

export type GuidanceCode = 'route-cost' | 'wave-stop' | 'channel' | 'buy-multiple'
export type GuidanceLevel = 'info' | 'watch' | 'act'

export interface GuidanceItem {
  code: GuidanceCode
  level: GuidanceLevel
  headline: string
  detail: string
  /** The measured basis, shown in the UI so the advice can be audited. */
  evidence: string
}

const money = (n: number) =>
  '$' + Math.round(n).toLocaleString('en-US')
const num = (n: number) => n.toLocaleString('en-US')

/** Which route this survey is ACTUALLY using, judged by the rows it holds —
 *  never by project_type. The label is wrong on 11 of the 117 projects that
 *  have any field row, including PR00425, which is typed B2B and holds 294
 *  PureSpectrum supplier rows. */
export function measuredRoute(i: GuidanceInput): 'blast' | 'panel' | 'both' | 'none' {
  const b = (i.blasts ?? []).length > 0
  const s = (i.suppliers ?? []).length > 0
  return b && s ? 'both' : b ? 'blast' : s ? 'panel' : 'none'
}

/** Blasts that went to a list, oldest first. Used for the wave count — a blast
 *  with no send date still counts as a send, so it is kept and sorted last. */
function orderedBlasts(i: GuidanceInput): BlastLike[] {
  return (i.blasts ?? []).slice().sort((a, b) =>
    (a.blast_at ?? a.created_at ?? '9999').localeCompare(b.blast_at ?? b.created_at ?? '9999'))
}

/**
 * What one excess complete cost THIS survey.
 *
 * A survey fielded through both routes is priced at its own blend, weighted by
 * the completes each route actually recorded — not at whichever route default
 * happens to be first in an || chain. And a survey with NO recorded field rows
 * returns null: we do not know how it was fielded, the two routes are 57x
 * apart, and picking one would be inventing the answer. The panel says nothing
 * rather than something confident and wrong.
 */
export function excessRate(i: GuidanceInput, route: ReturnType<typeof measuredRoute>):
  { median: number; label: string } | null {
  if (route === 'panel') return { median: ROUTE_COST.panel.median, label: 'the panel median' }
  if (route === 'blast') return { median: ROUTE_COST.blast.median, label: 'the blast median' }
  if (route === 'none') return null

  const blastN = (i.blasts ?? []).reduce((t, b) => t + (b.completes ?? 0), 0)
  const panelN = (i.suppliers ?? []).reduce((t, s) => t + (s.n_collected ?? 0), 0)
  const total = blastN + panelN
  // Both kinds of row exist but neither recorded a complete — the mix is
  // unknown, so the price is too.
  if (total <= 0) return null
  const median = (blastN * ROUTE_COST.blast.median + panelN * ROUTE_COST.panel.median) / total
  return {
    median,
    label: `this survey's own mix (${num(blastN)} blast / ${num(panelN)} panel completes)`,
  }
}

/**
 * The guidance for one survey.
 *
 * SILENT ON WORK IT CANNOT HELP. Delivered, held and closed surveys get
 * nothing — the decisions are already made, and advice on a finished study is
 * noise that teaches people to skip the panel. Same doctrine as risk, nFloor
 * and overTarget.
 */
export function fieldingGuidance(i: GuidanceInput): GuidanceItem[] {
  const out: GuidanceItem[] = []
  const open = (i.status ?? 'Open') === 'Open' && (i.phase ?? 'Active') === 'Active'
  const finished = i.board_column === 'Delivery'
  if (!open || finished) return out

  const route = measuredRoute(i)
  const target = i.n_target ?? null
  const collected = Number(i.n_collected ?? 0)

  // 1) What this N costs by route — the 57x gap is the single most consequential
  //    number in the system, and it is invisible at scoping time today.
  if (target && target > 0 && (route === 'none' || route === 'blast' || route === 'panel')) {
    const raw = Math.ceil(target * BUY_MULTIPLE)
    const b = ROUTE_COST.blast, p = ROUTE_COST.panel
    out.push({
      code: 'route-cost',
      level: 'info',
      headline: `${num(target)} clean N costs about ${money(raw * p.median)} on panel or ${money(raw * b.median)} on blasts`,
      detail:
        `Buying ${num(raw)} raw completes (${BUY_MULTIPLE}× target) costs ` +
        `${money(raw * p.p25)}–${money(raw * p.p75)} through PureSpectrum suppliers, or ` +
        `${money(raw * b.p25)}–${money(raw * b.p75)} through B2B blasts. ` +
        `The routes are not substitutes — pick on reach, then price the consequence.`,
      evidence:
        `Median ${money(b.median)}/complete on blasts (n=${b.n}) vs $${p.median.toFixed(2)} on panel ` +
        `(n=${p.n}), measured ${EVIDENCE_DATE} on surveys whose recorded completes cover their N.`,
    })
  }

  // 2) The wave stop rule. The cleanest signal in the whole dataset.
  if (route === 'blast' || route === 'both') {
    const sent = orderedBlasts(i).length
    if (sent >= WAVE_LIMIT) {
      out.push({
        code: 'wave-stop',
        level: sent > WAVE_LIMIT ? 'act' : 'watch',
        headline:
          sent > WAVE_LIMIT
            ? `${sent} blasts already sent — each further send to this list is buying less`
            : `${sent} blasts sent — the next one needs a reason`,
        detail:
          `Response decays every wave: ${WAVE_DECAY.map(w => `${w.step} ${Math.round(w.ratio * 100)}%`).join(', ')}. ` +
          `The last blast of a campaign runs at roughly half the first. If this list is not producing, ` +
          `a fresh audience beats another send to the same one.`,
        evidence:
          `Median step-down measured across 106 multi-blast campaigns, ${EVIDENCE_DATE}. ` +
          `Survived checks for under-recording, late-arriving completes, and cross-audience mixing.`,
      })
    }
  }

  // 3) Channel. Only raised when an email blast actually exists — advice about a
  //    channel you are not using is noise.
  const emails = (i.blasts ?? []).filter(b => b.channel === 'email').length
  if (emails > 0) {
    out.push({
      code: 'channel',
      level: 'watch',
      headline: `SMS converts about ${SMS_ADVANTAGE.ratio}× better than email on the same audience`,
      detail:
        `${emails} email blast${emails === 1 ? '' : 's'} on this survey. On matched segments — same ` +
        `project, same named audience — SMS returned 0.049% against email's 0.010%. Email still has ` +
        `no send cost, so it is cheap to try; it is not cheap to rely on.`,
      evidence:
        `${SMS_ADVANTAGE.ratio}× (95% CI ${SMS_ADVANTAGE.ciLow}–${SMS_ADVANTAGE.ciHigh}) across ` +
        `${SMS_ADVANTAGE.segments} matched segments, ${EVIDENCE_DATE}. Send order was checked — ` +
        `email was not merely the follow-up.`,
    })
  }

  // 4) The buy multiple. Fires only once there is enough raw N to have passed it,
  //    because before that it is a forecast and this panel does not forecast.
  //
  //    PRICED AT THE SURVEY'S OWN BLEND, not at a route default. An earlier
  //    version fell through to the blast rate for mixed and unknown routes, and
  //    on PR00425 — 294 PureSpectrum supplier rows alongside 11 blasts — that
  //    reported $36,572 of unbilled N against a true figure nearer $650, a 56x
  //    overstatement. Pricing someone's panel completes at blast rates is the
  //    single most expensive mistake available in this file.
  const rate = excessRate(i, route)
  if (rate && target && target > 0 && collected > target * BUY_MULTIPLE) {
    const excess = collected - Math.ceil(target * BUY_MULTIPLE)
    out.push({
      code: 'buy-multiple',
      level: 'act',
      headline: `${num(excess)} completes past what this target needs — about ${money(excess * rate.median)} unbilled`,
      detail:
        `${num(collected)} collected against a ${num(target)} target. Measured history says ${BUY_MULTIPLE}× ` +
        `raw is enough to land the clean N, so roughly ${num(excess)} of these are not billable under ` +
        `rate × min(delivered, target). Two-thirds of this kind of waste is scrub that never reaches the ` +
        `deliverable, not delivery above target — so the fix is the buy, not the stop.`,
      evidence:
        `${BUY_MULTIPLE}× measured on delivered surveys carrying target, collected and actual N; ` +
        `priced at ${rate.label} — ${money(rate.median)}/complete — ${EVIDENCE_DATE}.`,
    })
  }

  return out
}

export const GUIDANCE_STYLE: Record<GuidanceLevel, { label: string; className: string }> = {
  info: { label: 'Guidance', className: 'bg-muted text-muted-foreground border-border' },
  watch: { label: 'Worth knowing', className: 'bg-yellow-500/12 text-yellow-700 dark:text-yellow-400 border-yellow-500/30' },
  act: { label: 'Act', className: 'bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/30' },
}
