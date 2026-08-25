import { describe, it, expect } from 'vitest'
import {
  nFloorCheck,
  nFloorDeliveryGate,
  detectNFloorScope,
  NATIONAL_FLOOR,
  STATE_FLOOR,
  type NFloorScope,
} from './nFloor'

// ───────────────────────────────────────────────────────────────────────────────
// The production audience corpus, verbatim (a few strings are truncated in the
// source table with "…" and are kept exactly as they were pulled). This is the
// contract for the detector: it is not a set of invented sentences, it is every
// audience string in the live database at 2026-08-25, and the classification
// below is the reviewed decision for each one.
//
// `scope: null` means OUT OF SCOPE — the check says nothing at all.
// ───────────────────────────────────────────────────────────────────────────────
type Row = { code: string; type: string | null; audience: string; scope: NFloorScope | null; why: string }

const CORPUS: Row[] = [
  // ── Explicit gen-pop wording, national by default ──
  { code: 'PR00380', type: 'PS', audience: 'Gen pop', scope: 'national', why: 'gen-pop phrase' },
  { code: 'PR00367', type: 'PS', audience: 'Gen population', scope: 'national', why: 'gen-pop phrase' },
  { code: 'PR00308', type: 'PS', audience: 'General population', scope: 'national', why: 'gen-pop phrase' },
  { code: 'PR00303', type: 'PS', audience: 'General Population', scope: 'national', why: 'gen-pop phrase' },
  { code: 'PR00297', type: 'PS', audience: 'General Population', scope: 'national', why: 'gen-pop phrase' },
  { code: 'PR00285', type: 'PS', audience: 'General Population', scope: 'national', why: 'gen-pop phrase' },
  { code: 'PR00282', type: 'PS', audience: 'General Population', scope: 'national', why: 'gen-pop phrase' },
  { code: 'PR00273', type: 'PS', audience: 'General population', scope: 'national', why: 'gen-pop phrase' },
  { code: 'PR00228', type: 'PS', audience: 'General population', scope: 'national', why: 'gen-pop phrase' },
  {
    code: 'PR00320',
    type: 'PS',
    audience:
      'National US adults; split-sample message testing (3 statement variants, ~333-400 per cell)',
    scope: 'national',
    why: 'national adults; the split-sample design note is not a screen',
  },
  // ── Population-representative VOTER studies (David: in scope) ──
  {
    code: 'PR00304',
    type: 'Rerun',
    audience: 'US registered voters (national)',
    scope: 'national',
    why: 'national voters — the case the floor exists for',
  },
  {
    code: 'PR00301',
    type: 'PS',
    audience: 'US registered voters (national), analyzed by party and data-center proximity',
    scope: 'national',
    why: 'national voters; "analyzed by …" is an analysis note, not a screen',
  },
  { code: 'PR00293', type: 'PS', audience: 'Wisconsin registered voters', scope: 'state', why: 'one named state' },
  { code: 'PR00292', type: 'PS', audience: 'Minnesota registered voters', scope: 'state', why: 'one named state' },
  { code: 'PR00246', type: 'PS', audience: 'Oklahoma likely voters', scope: 'state', why: 'one named state' },
  {
    code: 'PR00321',
    type: 'PS',
    audience:
      'Previous Florida primary voters (audience pull from Xiaoxuan, >20k); fielded on both PS and B2B',
    scope: 'state',
    why: 'Florida voters — one named state (the "B2B" in the note must not disqualify it)',
  },

  // ── OUT: a qualifying clause beats gen-pop wording (the six traps) ──
  {
    code: 'PR00376',
    type: 'PS',
    audience:
      'US adults who currently take, have stopped, or are actively planning to start a prescription GLP-1 for weight loss',
    scope: null,
    why: 'TRAP: national adults wording, but "who currently take" is a screen (N target 20)',
  },
  {
    code: 'PR00372',
    type: 'PS',
    audience:
      'US adults responsible for their household electricity bill; oversample highest data-center-density grid regions',
    scope: null,
    why: 'TRAP: "responsible for" is a screen',
  },
  {
    code: 'PR00289',
    type: 'PS',
    audience: 'U.S. residents age 18+ who have self-directed trading experience',
    scope: null,
    why: 'TRAP: "18+" alone is fine, "who have … experience" is a screen',
  },
  {
    code: 'PR00281',
    type: 'PS',
    audience:
      'National college-educated professionals, ages 25-65, 10% oversample in California (~500)',
    scope: null,
    why: 'TRAP: "professionals", "college-educated", an upper age bound',
  },
  {
    code: 'PR00252',
    type: 'B2B',
    audience: 'General population, people who buy groceries',
    scope: null,
    why: 'TRAP: contains the literal words "General population" — the qualifier still wins',
  },
  {
    code: 'PR00277',
    type: 'PS',
    audience:
      'General consumers / jewelry buyers - US (primary), UK, Germany, Italy, France, Spain, Denmark',
    scope: null,
    why: 'TRAP: "General consumers" is a consumer screen; also seven countries',
  },

  // ── OUT: geography with no agreed floor ──
  {
    code: 'PR00365',
    type: 'PS',
    audience:
      '350+ Horry County, SC residents (general population). Client-proposed sample areas: statewide, legislative...',
    scope: null,
    why: 'sub-state (a county) — 1,350 is plainly wrong and 500 was never agreed for one county',
  },
  {
    code: 'PR00302',
    type: 'PS',
    audience: 'Registered voters in Pennsylvania, New Mexico, Michigan, Kansas and Illinois',
    scope: null,
    why: 'five states — a total judged against a one-state floor is a meaningless yardstick',
  },

  // ── OUT: screened / non-population audiences ──
  {
    code: 'PR00245',
    type: 'PS',
    audience: 'US adults 18 to 64 years old',
    scope: null,
    why: 'an upper age bound drops 65+, so it is not population-representative',
  },
  {
    code: 'PR00360',
    type: 'PS',
    audience: 'Consumers who recently participated in the used car market (usual screeners)',
    scope: null,
    why: 'consumers + screeners',
  },
  {
    code: 'PR00359',
    type: 'PS',
    audience:
      'US consumers currently purchasing GLP-1 medication through Hims/Hers or Ro telehealth platforms',
    scope: null,
    why: 'consumers + product screen',
  },
  {
    code: 'PR00322',
    type: 'PS',
    audience: 'Starbucks consumers (US); matched demographic/geographic profile to Wave 1',
    scope: null,
    why: 'brand consumers',
  },
  {
    code: 'PR00364',
    type: 'PS',
    audience:
      'Enrolled/blood members of Native American tribes nationwide (not limited to reservation residents)',
    scope: null,
    why: '"nationwide … residents" reads national, but enrolled tribal membership is a screen',
  },
  {
    code: 'PR00310',
    type: 'PS',
    audience: 'US consumers who are current customers of Rentokil or Rollins pest control services',
    scope: null,
    why: 'consumers / current customers',
  },
  {
    code: 'PR00379',
    type: 'PS',
    audience: 'Anthropic Retail Investors',
    scope: null,
    why: 'investors — no population frame at all',
  },
  {
    code: 'PR00377',
    type: 'PS',
    audience:
      'Seg 1 (~80%): Adult Children 45-64, HHI $125k+, involved in/anticipating aging-parent care decisions',
    scope: null,
    why: 'age band + income + "involved in"',
  },
  {
    code: 'PR00378',
    type: 'B2B',
    audience:
      'US-based cardiologists, lipidologists and endocrinologists, actively practicing, who personally prescribe...',
    scope: null,
    why: 'specialists + "who personally prescribe"',
  },
  {
    code: 'PR00382',
    type: 'B2B',
    audience:
      'Practice administrators, office managers, or billing/RCM decision-makers at physician practices',
    scope: null,
    why: 'occupational audience',
  },
  {
    code: 'PR00300',
    type: 'B2B',
    audience: 'US B2B software buyers & sellers, 500+ employees',
    scope: null,
    why: 'buyers & sellers',
  },

  // ── OUT: not an audience yet ──
  {
    code: 'PR00373',
    type: 'PS',
    audience: "TBD - pending SquarePoint's list of ~10 target states and audience definition",
    scope: null,
    why: '"TBD" is not an audience',
  },
]

describe('detectNFloorScope — every audience string in production', () => {
  for (const row of CORPUS) {
    const label = row.scope ? `${row.scope} (floor applies)` : 'OUT OF SCOPE'
    it(`${row.code} → ${label} — ${row.why}`, () => {
      expect(detectNFloorScope(row.audience, row.type)).toBe(row.scope)
    })
  }

  it('classifies exactly 16 of the 36 production rows as in scope', () => {
    const inScope = CORPUS.filter(r => detectNFloorScope(r.audience, r.type) !== null)
    expect(CORPUS).toHaveLength(36)
    expect(inScope.map(r => r.code)).toEqual([
      'PR00380', 'PR00367', 'PR00308', 'PR00303', 'PR00297', 'PR00285', 'PR00282', 'PR00273',
      'PR00228', 'PR00320', 'PR00304', 'PR00301', 'PR00293', 'PR00292', 'PR00246', 'PR00321',
    ])
  })
})

// The whole point of the rework: a qualifying clause disqualifies EVEN WHEN the
// audience is worded like a national gen-pop read. Two of these contain the
// literal phrase, so a text match on "general population" can never be enough.
describe('detectNFloorScope — gen-pop wording never survives a screener', () => {
  const TRAPS = CORPUS.filter(r =>
    ['PR00376', 'PR00372', 'PR00289', 'PR00281', 'PR00252', 'PR00277'].includes(r.code)
  )

  it('has all six traps in the corpus', () => {
    expect(TRAPS).toHaveLength(6)
  })

  it('silences every one of them', () => {
    for (const t of TRAPS) expect(detectNFloorScope(t.audience, t.type)).toBeNull()
  })

  it('would have fired on the two that name a general population, without the screener rule', () => {
    // Sanity check that the traps really are traps: strip the qualifier and the
    // same strings classify as gen pop.
    expect(detectNFloorScope('General population', 'B2B')).toBeNull() // B2B type excluded
    expect(detectNFloorScope('General population', 'PS')).toBe('national')
    expect(detectNFloorScope('US adults', 'PS')).toBe('national')
  })
})

describe('detectNFloorScope — the rules, stated directly', () => {
  it('reads an empty or missing audience as nothing to judge', () => {
    expect(detectNFloorScope(null)).toBeNull()
    expect(detectNFloorScope(undefined)).toBeNull()
    expect(detectNFloorScope('   ')).toBeNull()
  })

  it('never classifies an undecided audience', () => {
    expect(detectNFloorScope('TBD', 'PS')).toBeNull()
    expect(detectNFloorScope('US adults - audience to be determined', 'PS')).toBeNull()
  })

  it('excludes B2B and Internal project types outright, but never a null type', () => {
    expect(detectNFloorScope('General population', 'B2B')).toBeNull()
    expect(detectNFloorScope('General population', 'Internal')).toBeNull()
    expect(detectNFloorScope('General population', 'PS')).toBe('national')
    expect(detectNFloorScope('General population', 'Rerun')).toBe('national')
    expect(detectNFloorScope('General population', null)).toBe('national')
    expect(detectNFloorScope('General population')).toBe('national')
  })

  it('picks the state floor for one named state or explicit statewide wording', () => {
    expect(detectNFloorScope('Ohio adults', 'PS')).toBe('state')
    expect(detectNFloorScope('statewide adults', 'PS')).toBe('state')
    expect(detectNFloorScope('General population, Wisconsin', 'PS')).toBe('state')
    // Longest-name-first matching: "West Virginia" is one state, not two.
    expect(detectNFloorScope('West Virginia registered voters', 'PS')).toBe('state')
  })

  it('stays out of sub-state geographies rather than inventing a floor', () => {
    expect(detectNFloorScope('Cook County adults', 'PS')).toBeNull()
    expect(detectNFloorScope('Phoenix metro general population', 'PS')).toBeNull()
    expect(detectNFloorScope('registered voters in the 3rd congressional district', 'PS')).toBeNull()
  })

  it('stays out of multi-geography studies (2+ states, or any non-US country)', () => {
    expect(detectNFloorScope('Registered voters in Ohio and Michigan', 'PS')).toBeNull()
    expect(detectNFloorScope('General population - US and UK', 'PS')).toBeNull()
    expect(detectNFloorScope('General population, Canada', 'PS')).toBeNull()
  })

  it('needs a geography cue before "adults" or "voters" counts as a population', () => {
    expect(detectNFloorScope('adults', 'PS')).toBeNull()
    expect(detectNFloorScope('registered voters', 'PS')).toBeNull()
    expect(detectNFloorScope('US adults', 'PS')).toBe('national')
    expect(detectNFloorScope('US registered voters', 'PS')).toBe('national')
  })

  it('treats an open-ended 18+ as gen pop but an upper age bound as a screen', () => {
    expect(detectNFloorScope('US adults 18+', 'PS')).toBe('national')
    expect(detectNFloorScope('US adults age 18+', 'PS')).toBe('national')
    expect(detectNFloorScope('US adults 18 to 64 years old', 'PS')).toBeNull()
    expect(detectNFloorScope('US adults, ages 25-54', 'PS')).toBeNull()
  })

  it('does not read the numbers in a cell-size note as an age band (PR00320)', () => {
    expect(
      detectNFloorScope('National US adults; 3 statement variants, ~333-400 per cell', 'PS')
    ).toBe('national')
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// The verdict. The floor is an INTERNAL standard, so it is measured against
// n_internal_target — never the client's n_target.
// ───────────────────────────────────────────────────────────────────────────────
describe('nFloorCheck — judged against the INTERNAL target', () => {
  // The client's contracted range is not part of nFloorCheck's input any more.
  // Spread in from a loose object so these cases still carry it, exactly as a
  // caller spreading a whole project row would.
  const CLIENT_RANGE = { n_target: 1000, n_target_max: 1200 }

  it("Bryan's project (PR00380): client N target 1,000 under our 1,350 internal target is FINE", () => {
    const r = nFloorCheck({
      ...CLIENT_RANGE,
      audience: 'Gen pop',
      project_type: 'PS',
      n_internal_target: 1350,
      n_collected: 1410,
    })
    expect(r.applies).toBe(true)
    expect(r.scope).toBe('national')
    expect(r.band).toBe('ok')
    expect(r.requiresOverride).toBe(false)
    expect(r.internalTarget).toBe(1350)
  })

  it('warns when the internal target itself is under the floor (override required)', () => {
    const r = nFloorCheck({ audience: 'US registered voters (national)', n_internal_target: 1000 })
    expect(r.applies).toBe(true)
    expect(r.floor).toBe(NATIONAL_FLOOR)
    expect(r.band).toBe('warning')
    expect(r.internalTarget).toBe(1000)
    expect(r.requiresOverride).toBe(true)
  })

  it('treats an internal target exactly ON the floor as clearing it', () => {
    const r = nFloorCheck({ audience: 'General population', n_internal_target: NATIONAL_FLOOR })
    expect(r.band).toBe('ok')
    expect(r.requiresOverride).toBe(false)
  })

  it('grades against the 500 state floor when the audience names one state', () => {
    expect(nFloorCheck({ audience: 'Oklahoma likely voters', n_internal_target: 450 })).toMatchObject({
      floor: STATE_FLOOR,
      scope: 'state',
      band: 'warning',
      requiresOverride: true,
    })
    expect(nFloorCheck({ audience: 'Oklahoma likely voters', n_internal_target: 500 }).band).toBe('ok')
  })

  it('IGNORES the client N target range entirely — it is not our standard', () => {
    // A client range far under the floor, an internal target above it: silent.
    const tiny = { n_target: 200, n_target_max: 400 }
    const withRange = nFloorCheck({ ...tiny, audience: 'Gen pop', n_internal_target: 1400 })
    expect(withRange.band).toBe('ok')
    expect(withRange.requiresOverride).toBe(false)
    // …and byte-identical to the same project with no client range at all.
    expect(withRange).toEqual(nFloorCheck({ audience: 'Gen pop', n_internal_target: 1400 }))
  })
})

// "You are under the 1,350 floor" on a project with no internal target reads as
// nonsense — the fix is to type the number, not to sign anything off. PR00365,
// PR00293, PR00292 and PR00321 are all in this state in production.
describe('nFloorCheck — a missing internal target is a SETUP gap, not a shortfall', () => {
  it('reports band "unset" and asks for nothing to be overridden', () => {
    const r = nFloorCheck({ audience: 'Wisconsin registered voters', n_internal_target: null })
    expect(r.applies).toBe(true)
    expect(r.band).toBe('unset')
    expect(r.internalTarget).toBeNull()
    expect(r.floor).toBe(STATE_FLOOR)
    expect(r.requiresOverride).toBe(false)
  })

  it('behaves the same when the field is simply absent', () => {
    expect(nFloorCheck({ audience: 'Minnesota registered voters' }).band).toBe('unset')
  })

  it('still requires an override when a FACT is short and the target is blank', () => {
    const r = nFloorCheck({
      audience: 'General population',
      n_internal_target: null,
      n_actual: 900,
    })
    expect(r.band).toBe('unset')
    expect(r.shortfallActual).toBe(true)
    expect(r.requiresOverride).toBe(true)
  })

  it('never demands anything when the check does not apply at all', () => {
    const r = nFloorCheck({ audience: 'hospital CFOs', n_internal_target: null, n_actual: 12 })
    expect(r.applies).toBe(false)
    expect(r.band).toBe('ok')
    expect(r.internalTarget).toBeNull()
    expect(r.requiresOverride).toBe(false)
  })
})

// The actual-side check survives the rework untouched: Bryan's own project
// collected 1,410 but delivered 1,209 after cleaning, and that is a real flag.
describe('nFloorCheck — the FACTS: N actual and N collected', () => {
  it("flags PR00380's cleaned N actual of 1,209 even though the plan was fine", () => {
    const r = nFloorCheck({
      audience: 'Gen pop',
      project_type: 'PS',
      n_internal_target: 1350,
      n_collected: 1410,
      n_actual: 1209,
      collectionFinal: true,
    })
    expect(r.band).toBe('ok')
    expect(r.shortfallCollected).toBe(false)
    expect(r.shortfallActual).toBe(true)
    expect(r.requiresOverride).toBe(true)
  })

  it('ignores a light n_collected while fielding is still running', () => {
    const r = nFloorCheck({ audience: 'US adults 18+', n_internal_target: 1400, n_collected: 120 })
    expect(r.shortfallCollected).toBe(false)
    expect(r.requiresOverride).toBe(false)
  })

  it('requires an override once fielding is done and n_collected is under the floor', () => {
    const r = nFloorCheck({
      audience: 'US adults 18+',
      n_internal_target: 1400,
      n_collected: 900,
      collectionFinal: true,
    })
    expect(r.band).toBe('ok')
    expect(r.shortfallCollected).toBe(true)
    expect(r.requiresOverride).toBe(true)
  })

  it('treats a collected N exactly ON the floor as clearing it', () => {
    const r = nFloorCheck({
      audience: 'gen pop',
      n_internal_target: 1350,
      n_collected: NATIONAL_FLOOR,
      collectionFinal: true,
    })
    expect(r.shortfallCollected).toBe(false)
  })

  it('never flags a zero-collected placeholder wave (migration 075) as short', () => {
    const r = nFloorCheck({
      audience: 'US adults 18+',
      n_internal_target: 1400,
      n_collected: 0,
      collectionFinal: true,
    })
    expect(r.shortfallCollected).toBe(false)
    expect(r.requiresOverride).toBe(false)
  })

  it('uses the 500 state floor for the collected re-check too', () => {
    const base = { audience: 'Ohio adults', n_internal_target: 600, collectionFinal: true }
    expect(nFloorCheck({ ...base, n_collected: 420 }).shortfallCollected).toBe(true)
    expect(nFloorCheck({ ...base, n_collected: 520 }).shortfallCollected).toBe(false)
  })

  it('reports the internal target, the collected N and the delivered N independently', () => {
    const r = nFloorCheck({
      audience: 'US adults 18+',
      n_internal_target: 1000,
      n_collected: 700,
      n_actual: 650,
      collectionFinal: true,
    })
    expect(r.band).toBe('warning')
    expect(r.shortfallCollected).toBe(true)
    expect(r.shortfallActual).toBe(true)
    expect(r.requiresOverride).toBe(true)
  })

  it('does not apply the collected re-check to a screened project at all', () => {
    const r = nFloorCheck({
      audience: 'US adults who currently take a prescription GLP-1',
      n_internal_target: 20,
      n_collected: 12,
      collectionFinal: true,
    })
    expect(r.applies).toBe(false)
    expect(r.shortfallCollected).toBe(false)
    expect(r.requiresOverride).toBe(false)
  })
})

// The gate the pipeline calls on the Delivered transition. Pure, like
// occamOnboardingGate / complianceGate, so the app hook and the connector share
// one definition.
describe('nFloorDeliveryGate', () => {
  const SHORT = { audience: 'US adults 18+', n_internal_target: 1400, n_collected: 900 }

  it('blocks a delivery whose collected N is under the floor', () => {
    const g = nFloorDeliveryGate({ ...SHORT, willMarkDelivered: true })
    expect(g.blocked).toBe(true)
    expect(g.message).toContain('900')
    expect(g.message).toContain('1,350')
  })

  it('does nothing on any transition that is not the delivery one', () => {
    expect(nFloorDeliveryGate({ ...SHORT, willMarkDelivered: false }).blocked).toBe(false)
  })

  it('never re-asks once the override has been signed off', () => {
    const g = nFloorDeliveryGate({ ...SHORT, willMarkDelivered: true, n_floor_override: true })
    expect(g.blocked).toBe(false)
  })

  it('lets a delivery through when the collected N cleared the floor', () => {
    const g = nFloorDeliveryGate({ ...SHORT, n_collected: 1400, willMarkDelivered: true })
    expect(g.blocked).toBe(false)
  })

  it('does not block on the internal target alone — a plan is not a fact', () => {
    const g = nFloorDeliveryGate({
      audience: 'US adults 18+',
      n_internal_target: 800,
      n_collected: 1400,
      willMarkDelivered: true,
    })
    expect(g.blocked).toBe(false)
  })

  it('does not block a delivery just because no internal target was ever set', () => {
    const g = nFloorDeliveryGate({
      audience: 'Wisconsin registered voters',
      n_internal_target: null,
      n_collected: 900,
      willMarkDelivered: true,
    })
    expect(g.blocked).toBe(false) // 900 clears the 500 state floor
  })

  it('blocks on a light delivered N even when collection looked fine', () => {
    const g = nFloorDeliveryGate({
      audience: 'gen pop',
      n_internal_target: 1400,
      n_collected: 1500,
      n_actual: 1100,
      willMarkDelivered: true,
    })
    expect(g.blocked).toBe(true)
    expect(g.message).toContain('N actual 1,100')
  })

  it('lets a zero-collected placeholder wave deliver untouched', () => {
    const g = nFloorDeliveryGate({ ...SHORT, n_collected: 0, willMarkDelivered: true })
    expect(g.blocked).toBe(false)
  })

  it('does not gate a project the floor never applied to', () => {
    const g = nFloorDeliveryGate({
      audience: 'US B2B software buyers & sellers, 500+ employees',
      project_type: 'B2B',
      n_internal_target: 1400,
      n_collected: 200,
      willMarkDelivered: true,
    })
    expect(g.blocked).toBe(false)
  })
})

describe('regressions the adversarial review found', () => {
  // Same audience, different typing, opposite verdict — the worst kind of bug in
  // an advisory, because it looks arbitrary to the person reading it.
  it('treats a bare age band as a screen, with or without the word "age"', () => {
    expect(detectNFloorScope('US adults 18 to 64 years old', 'PS')).toBeNull()
    expect(detectNFloorScope('US adults 18 to 64', 'PS')).toBeNull()
    expect(detectNFloorScope('US adults 25-54', 'PS')).toBeNull()
    expect(detectNFloorScope('US adults aged 18-64', 'PS')).toBeNull()
    expect(detectNFloorScope('US adults (18-64)', 'PS')).toBeNull()
    expect(detectNFloorScope('Gen pop 18-34', 'PS')).toBeNull()
  })

  it('still counts an open-ended 18+ as population-representative', () => {
    // "18+" excludes nobody, so it is not a screen. Guards against the age-band
    // pattern above being over-eager.
    expect(detectNFloorScope('US adults 18+', 'PS')).toBe('national')
    expect(detectNFloorScope('Gen pop', 'PS')).toBe('national')
    expect(detectNFloorScope('General Population', 'PS')).toBe('national')
    expect(detectNFloorScope('US registered voters (national)', 'PS')).toBe('national')
    expect(detectNFloorScope('Wisconsin registered voters', 'PS')).toBe('state')
  })

  it('does not match a population word inside a longer word', () => {
    expect(detectNFloorScope('Hydrogen population study', 'PS')).toBeNull()
  })

  it('treats Washington DC as the city it is, not the state', () => {
    // Otherwise the word "Washington" hands a city the 500 state floor, while
    // "New York City adults" correctly falls through to silence.
    expect(detectNFloorScope('Washington DC adults', 'PS')).toBeNull()
    expect(detectNFloorScope('New York City adults', 'PS')).toBeNull()
    expect(detectNFloorScope('Washington State registered voters', 'PS')).toBe('state')
  })
})
