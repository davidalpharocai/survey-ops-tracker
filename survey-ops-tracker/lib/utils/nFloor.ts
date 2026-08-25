// Gen-pop N-floor check (SOFT validation). For Jenna's general-population
// studies we expect a minimum sample: national gen pop -> 1,350; state-level
// -> 500. Detection is heuristic over the free-text `audience` (auto-detect
// only, per David) — misfires are handled by the per-project override, so this
// errs toward flagging rather than staying silent.
//
// Since migration 078 the target is a RANGE (n_target = min, n_target_max =
// max), so the verdict is GRADED rather than yes/no — see NFloorBand. A range
// whose top end clears the floor is still fieldable, so it must not demand a
// typed override; only a range that can't clear the floor at all does.
//
// The check runs at TWO moments against two different numbers. While a project
// is being planned it grades the target range — a plan. Once fielding is over it
// re-grades what we actually collected — a fact — because a study that planned
// 1,400 and came home with 900 is exactly the case the floor exists to catch,
// and nothing else in the app looks at n_collected against the floor. That
// second pass is what `collectionFinal` turns on.

import { fmtNum } from '@/lib/utils/number'
import { resolveNRange } from '@/lib/utils/nRange'

export const NATIONAL_FLOOR = 1350
export const STATE_FLOOR = 500

// Explicit gen-pop phrasing.
const GEN_POP = /gen(?:eral)?[\s-]?pop(?:ulation)?|genpop|general public|nat(?:ionally)?[\s-]?rep(?:resentative)?/i
// "adults" audiences read as gen pop when paired with a national or state cue
// (e.g. "US adults 18+", "California adults").
const ADULTS = /\badults?\b/i
const NATIONAL_CUE = /\b(?:u\.?s\.?|usa|american|national(?:ly)?|nationwide)\b/i

const US_STATES = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware',
  'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky',
  'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi',
  'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico',
  'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania',
  'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont',
  'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming',
]
const STATE_SIGNAL = new RegExp(
  `\\b(?:${US_STATES.join('|')}|statewide|state[\\s-]?level|state[\\s-]?wide)\\b`,
  'i'
)

export type NFloorScope = 'national' | 'state'

/**
 * How the agreed N-target RANGE grades against the floor:
 *   'ok'      — even the bottom of the range clears the floor. Silent.
 *   'notice'  — the max clears it but the min dips under. Soft FYI only, NO
 *               override: fielding to the top of the range is compliant, so
 *               there is nothing to sign off on yet.
 *   'warning' — even the max is under the floor. Nothing we could field inside
 *               this range clears it, so it needs a typed override + reason.
 */
export type NFloorBand = 'ok' | 'notice' | 'warning'

export interface NFloorResult {
  applies: boolean // salesperson Jenna + gen-pop audience
  scope: NFloorScope | null
  floor: number
  /** Graded verdict on the target range (see NFloorBand). */
  band: NFloorBand
  /** The graded range with nulls resolved (a null max reads as the min). */
  targetMin: number | null
  targetMax: number | null
  /** The target range dips below the floor at either end (band !== 'ok'). */
  shortfallTarget: boolean
  shortfallActual: boolean // n_actual is set and below the floor
  /**
   * Fielding is finished and n_collected came in under the floor — the
   * delivery-time re-check. Only ever true when `collectionFinal` was passed,
   * because a running tally is under the floor from its first response and
   * warning on that would fire on day one of every study.
   */
  shortfallCollected: boolean
  /**
   * A typed override is required: the whole range is short, or the N we actually
   * collected is, or the N we delivered is. A collected/delivered number is a
   * fact, not a plan, so a light one needs the sign-off even when the range
   * itself was fine.
   */
  requiresOverride: boolean
}

export function nFloorCheck(p: {
  salesperson?: string | null
  audience?: string | null
  n_target?: number | null
  n_target_max?: number | null
  n_collected?: number | null
  n_actual?: number | null
  /**
   * True once n_collected has stopped being a running tally and is the number we
   * actually got — i.e. fielding is done. Pass `stage_fielding` on the project
   * page, and `true` unconditionally at the Delivered transition, which is
   * downstream of Fielding by definition. Left off, n_collected is ignored
   * entirely: this check must not nag a captain on the first afternoon of a
   * field.
   */
  collectionFinal?: boolean
}): NFloorResult {
  const none: NFloorResult = {
    applies: false,
    scope: null,
    floor: NATIONAL_FLOOR,
    band: 'ok',
    targetMin: null,
    targetMax: null,
    shortfallTarget: false,
    shortfallActual: false,
    shortfallCollected: false,
    requiresOverride: false,
  }

  // Mirror the Voter-QA trigger's tolerant match (nullable, legacy strings, canon).
  const isJenna = (p.salesperson ?? '').toLowerCase().includes('jenna')
  if (!isJenna) return none

  const audience = (p.audience ?? '').trim()
  if (!audience) return none
  const isState = STATE_SIGNAL.test(audience)
  const isGenPop = GEN_POP.test(audience) || (ADULTS.test(audience) && (NATIONAL_CUE.test(audience) || isState))
  if (!isGenPop) return none

  const scope: NFloorScope = isState ? 'state' : 'national'
  const floor = scope === 'state' ? STATE_FLOOR : NATIONAL_FLOOR

  // A pre-078 single number arrives as min-only; resolveNRange reads that as a
  // degenerate range, which keeps the old behaviour exactly (min = max = N).
  const { min, max } = resolveNRange(p.n_target, p.n_target_max)
  let band: NFloorBand = 'ok'
  if (max != null && max < floor) band = 'warning'
  else if (min != null && min < floor) band = 'notice'

  const shortfallActual = p.n_actual != null && p.n_actual < floor
  // The `> 0` guard is not cosmetic: a placeholder wave (migration 075 —
  // assumed-delivered, no real data yet, Sree backfills later) sits at 0
  // collected and gets marked delivered on purpose. Demanding a typed override
  // there would gate a row that has no N to judge.
  const shortfallCollected =
    p.collectionFinal === true && p.n_collected != null && p.n_collected > 0 && p.n_collected < floor
  return {
    applies: true,
    scope,
    floor,
    band,
    targetMin: min,
    targetMax: max,
    shortfallTarget: band !== 'ok',
    shortfallActual,
    shortfallCollected,
    requiresOverride: band === 'warning' || shortfallActual || shortfallCollected,
  }
}

export interface NFloorGateResult {
  blocked: boolean
  message: string
}

/**
 * The delivery-time gate: re-check the floor against what we actually collected
 * just before a project is marked Delivered.
 *
 * Pure + side-effect-free, mirroring occamOnboardingGate / complianceGate, so the
 * app hook (lib/hooks/usePipelineStage.ts) and the connector's advance_project
 * can share one definition. `collectionFinal` is forced true here: the delivered
 * transition is downstream of Fielding by definition, so n_collected is final
 * whatever the checkbox says.
 *
 * SOFT, like the card: an existing `n_floor_override` clears it (the sign-off has
 * already been given and is recorded on the project), and it is advice at a
 * decision point, not a permission check.
 */
export function nFloorDeliveryGate(p: {
  willMarkDelivered: boolean
  salesperson?: string | null
  audience?: string | null
  n_target?: number | null
  n_target_max?: number | null
  n_collected?: number | null
  n_actual?: number | null
  n_floor_override?: boolean | null
}): NFloorGateResult {
  if (!p.willMarkDelivered) return { blocked: false, message: '' }
  // Already signed off — never re-ask. Same "confirmed once" rule as the Occam gate.
  if (p.n_floor_override) return { blocked: false, message: '' }
  const check = nFloorCheck({ ...p, collectionFinal: true })
  // Facts only. A target RANGE that never cleared the floor is a planning
  // question and belongs to the card during scoping — blocking delivery on it
  // would re-litigate a decision at the worst possible moment. What must not
  // pass unremarked is the N we ended up with.
  if (!check.applies || !(check.shortfallCollected || check.shortfallActual)) {
    return { blocked: false, message: '' }
  }
  const scopeLabel = check.scope === 'state' ? 'state-level' : 'national'
  const short: string[] = []
  if (check.shortfallCollected) short.push(`N collected ${fmtNum(p.n_collected ?? 0)}`)
  if (check.shortfallActual) short.push(`N actual ${fmtNum(p.n_actual ?? 0)}`)
  return {
    blocked: true,
    message:
      `Fielding finished with ${short.join(' and ')}, under the ${fmtNum(check.floor)} expected for a ` +
      `${scopeLabel} general-population study. Confirm this N is intentional before delivering.`,
  }
}
