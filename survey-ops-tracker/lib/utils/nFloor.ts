// Gen-pop N-floor check (SOFT validation). For Jenna's general-population
// studies we expect a minimum sample: national gen pop -> 1,350; state-level
// -> 500. Detection is heuristic over the free-text `audience` (auto-detect
// only, per David) — misfires are handled by the per-project override, so this
// errs toward flagging rather than staying silent.

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

export interface NFloorResult {
  applies: boolean // salesperson Jenna + gen-pop audience
  scope: NFloorScope | null
  floor: number
  shortfallTarget: boolean // n_target is set and below the floor
  shortfallActual: boolean // n_actual is set and below the floor
}

export function nFloorCheck(p: {
  salesperson?: string | null
  audience?: string | null
  n_target?: number | null
  n_actual?: number | null
}): NFloorResult {
  const none: NFloorResult = {
    applies: false,
    scope: null,
    floor: NATIONAL_FLOOR,
    shortfallTarget: false,
    shortfallActual: false,
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
  return {
    applies: true,
    scope,
    floor,
    shortfallTarget: p.n_target != null && p.n_target < floor,
    shortfallActual: p.n_actual != null && p.n_actual < floor,
  }
}
