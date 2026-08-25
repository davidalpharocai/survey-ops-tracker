// Gen-pop N-floor check (SOFT advisory).
//
// AlphaROC has an INTERNAL sampling standard for population-representative
// studies: a national read wants at least 1,350 completes, a single-state read
// at least 500. This module is the one place that standard is encoded.
//
// ── WHAT IT JUDGES (reworked 2026-08-25, from Bryan's report) ────────────────
// The floor is OUR standard, so it is measured against `n_internal_target` —
// the cushion we set ourselves — and NEVER against `n_target`, which is only
// what the client contracted. A client buying 1,000 completes while we
// internally target 1,350 is a CORRECTLY set-up project, and the old check
// scolded exactly that (PR00380: n_target 1,000 / n_internal_target 1,350).
//
// Because `n_internal_target` is a single number by design — our own
// commitment, never a negotiated band — there is nothing left to grade across a
// range. The min/max banding that migration 078 introduced on `n_target`
// (n_target = min, n_target_max = max) is therefore GONE from this check on
// purpose: it graded the wrong number. See NFloorBand for the three states that
// remain.
//
// It also runs against FACTS, not just plans: once fielding is over, the N we
// actually collected, and the cleaned N we deliver. A study that internally
// targeted 1,400 and came home with 900 is exactly the case the floor exists to
// catch, and nothing else in the app looks at n_collected against the floor.
// `collectionFinal` turns that pass on. (Bryan's own project is the example:
// n_collected 1,410 cleared the floor, but n_actual came in at 1,209.)
//
// ── WHO IT APPLIES TO ───────────────────────────────────────────────────────
// Any population-representative study. The old `salesperson includes 'jenna'`
// gate is gone (David, 2026-08-25) — the standard is a company standard, not
// one person's. In its place the check keys off the free-text `audience` (plus
// `project_type` where that settles it).
//
// !! THIS DETECTOR IS DELIBERATELY BIASED TOWARD SILENCE. DO NOT MAKE IT MORE
// !! EAGER. A missed warning costs one conversation. A warning that fires on a
// !! screened B2B study teaches the whole team to click through every warning
// !! this app will ever show them, and we never get that credibility back.
// !! If a real study slips through, add a POSITIVE cue narrowly; if a screened
// !! study gets flagged, add a DISQUALIFIER. Every rule below was written
// !! against the real production audience corpus and the tests name the project
// !! codes it was derived from — run them before touching a regex.

import { fmtNum } from '@/lib/utils/number'

export const NATIONAL_FLOOR = 1350
export const STATE_FLOOR = 500

export type NFloorScope = 'national' | 'state'

/* ────────────────────────── audience detection ────────────────────────── */

/** Explicit general-population phrasing: "Gen pop", "General Population", … */
const GEN_POP =
  /\bgen(?:eral)?[\s-]?pop(?:ulation)?\b|\bgenpop\b|\bgeneral public\b|\bnat(?:ionally)?[\s-]?rep(?:resentative)?/i

/**
 * A whole-population frame stated without the gen-pop phrase — "US adults",
 * "Ohio residents". On its own it means nothing (a screened study opens the
 * same way), so it only counts alongside a geography cue AND after every
 * disqualifier below has passed.
 */
const POPULATION_NOUN = /\b(?:adults?|residents?|people|population)\b/i

/**
 * Voter frames count as population-representative (David's call). Not one row
 * in the corpus pairs "voters" with the words "general population", so a
 * literal gen-pop match would protect none of them — yet national registered
 * voters with an internal target of 1,000 (PR00304) is precisely what the floor
 * is for. Needs a geography cue, same as POPULATION_NOUN: "registered voters"
 * with no geography could be anything.
 */
const VOTERS = /\bvoters?\b/i

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
// Longest-first so "west virginia" is not consumed as "virginia" — the distinct
// count below is what decides single-state vs multi-state.
const STATE_NAME = new RegExp(
  `\\b(?:${[...US_STATES].sort((a, b) => b.length - a.length).join('|')})\\b`,
  'gi'
)
const STATE_GENERIC = /\b(?:statewide|state[\s-]?level|state[\s-]?wide)\b/i

/**
 * Sub-state geography. A county, city, metro or district read is a real study
 * but the internal standard has no number for it, and the national 1,350 is
 * plainly wrong for one South Carolina county (PR00365). Rather than invent a
 * floor we stay out of it entirely — see detectNFloorScope's doc comment.
 */
const SUB_STATE =
  // 'd.c.' is here rather than with the state names on purpose: DC is a city, so
  // 'Washington DC adults' must fall through to silence like 'New York City
  // adults' does, not inherit the 500 state floor via the word 'Washington'.
  /\b(?:count(?:y|ies)|cit(?:y|ies)|towns?|townships?|villages?|metro(?:politan)?|msa|dma|districts?|congressional|legislative|precincts?|wards?|zips?|zipcodes?|boroughs?|parish(?:es)?|neighbou?rhoods?|d\.?c\.?|district of columbia)\b/i

/**
 * A non-US geography makes this an international study; our floors are US
 * standards, and a seven-country consumer read (PR00277) is not what they
 * describe. "Georgia" and "Mexico" are left out on purpose — as bare words they
 * are far more likely to be the US state and "New Mexico".
 */
const FOREIGN_COUNTRY =
  /\b(?:u\.?k\.?|united kingdom|england|scotland|wales|ireland|canada|germany|france|italy|spain|denmark|sweden|norway|finland|netherlands|belgium|poland|portugal|switzerland|austria|australia|new zealand|japan|china|india|brazil|israel|singapore|south africa|u\.?a\.?e\.?|emirates)\b/i

/** The audience has not actually been decided yet (PR00373). Never classify it. */
const NOT_YET_DEFINED = /\btbd\b|\bto be (?:determined|defined|confirmed)\b|\bunknown audience\b/i

/**
 * DISQUALIFIERS — a qualifying clause beats gen-pop wording every time.
 *
 * This is the rule the corpus insists on: "General population, people who buy
 * groceries" (PR00252) and "General consumers / jewelry buyers" (PR00277) both
 * contain the literal words, and neither is a 1,350 study. So the presence of
 * the phrase can never be sufficient on its own — the qualifier has to win.
 */
const SCREENERS: RegExp[] = [
  // A relative "who" clause is the single strongest screening tell in the whole
  // corpus: "who currently take … a prescription GLP-1", "who have
  // self-directed trading experience", "who personally prescribe". Deliberately
  // blunt — ANY "who" — because not one population-representative row in
  // production contains the word at all, and a false silence is the cheap
  // mistake here.
  /\bwho\b/i,
  // The same screen expressed without "who".
  /\bresponsible for\b|\binvolved in\b|\benrolled\b|\bmembers? of\b|\bcurrent(?:ly)? customers?\b|\bsubscribers?\b|\bpolicy ?holders?\b|\bwith .{0,30}experience\b/i,
  // Commercial / occupational audiences. "General consumers" is a consumer
  // screen, not a population.
  /\b(?:consumers?|buyers?|sellers?|shoppers?|customers?|investors?|traders?|professionals?|executives?|managers?|administrators?|owners?|employers?|employees|decision[\s-]?makers?|practitioners?|physicians?|doctors?|nurses?|patients?|clinicians?|\w+ologists?|\w+iatrists?|c[efiot]os?)\b/i,
  // Product / treatment screens.
  /\bglp-?1\b|\bprescriptions?\b|\bmedications?\b|\btelehealth\b/i,
  // Demographic narrowing past plain "adults": an UPPER age bound excludes part
  // of the population ("18 to 64 years old" drops 65+), and income or education
  // filters are screens. An open-ended "18+" is NOT a screen and is not matched.
  /\bages?\s*\d{1,2}\s*(?:to|through|[-–—])\s*\d{1,2}\b/i,
  /\b\d{1,2}\s*(?:to|through|[-–—])\s*\d{1,2}\s*years?[\s-]?old\b/i,
  // ...and the same band with NO keyword at all. Without this, identical
  // audiences got opposite verdicts on typing alone: "US adults 18 to 64 years
  // old" was silent but "US adults 18 to 64", "US adults 25-54" and
  // "Gen pop 18-34" all read as national gen-pop. Verified against the whole
  // production corpus: this matches only rows already out of scope on other
  // grounds (25-65, 18 to 64, 45-64) and touches no true-positive row.
  /\b\d{1,2}\s*(?:to|through|[-–—])\s*\d{1,2}\b/,
  /\bhhi\b|\bhousehold income\b|\$\s?\d+\s?k\b|\bcollege[\s-]?educated\b/i,
]

/**
 * Project types the standard does not describe. A B2B panel is a business
 * audience by definition and an Internal project is not a client population
 * read. A NULL type is never excluded — plenty of rows carry none.
 */
const OUT_OF_SCOPE_TYPES = new Set(['B2B', 'Internal'])

/**
 * Decide whether an audience string describes a population-representative
 * study, and at which geography — the floor follows from the geography:
 * national → 1,350, one named state (or "statewide") → 500.
 *
 * Returns null — out of scope, silent — for everything else, INCLUDING two
 * geographies that are real studies but have no agreed floor:
 *   · SUB-STATE (a county, city or district): 1,350 is plainly wrong for one
 *     county and 500 is a number nobody agreed to for one, so we say nothing
 *     rather than invent a third standard.
 *   · MULTI-GEOGRAPHY (two or more named states, or any non-US country):
 *     comparing a five-state total against a one-state floor is a meaningless
 *     yardstick — 500 total across five states would "pass" at 100 per state.
 *     A per-cell floor would be a new standard; that is a decision for David
 *     and Bryan, not for a regex.
 */
export function detectNFloorScope(
  audience: string | null | undefined,
  projectType?: string | null
): NFloorScope | null {
  const text = (audience ?? '').trim()
  if (!text) return null
  if (NOT_YET_DEFINED.test(text)) return null
  if (projectType && OUT_OF_SCOPE_TYPES.has(projectType)) return null

  // Geography first: it can rule the study out before any positive cue matters.
  if (SUB_STATE.test(text)) return null
  if (FOREIGN_COUNTRY.test(text)) return null
  const named = new Set(text.toLowerCase().match(STATE_NAME) ?? [])
  if (named.size > 1) return null

  if (SCREENERS.some(re => re.test(text))) return null

  const isState = named.size === 1 || STATE_GENERIC.test(text)
  const hasGeography = isState || NATIONAL_CUE.test(text)
  const framed = (POPULATION_NOUN.test(text) || VOTERS.test(text)) && hasGeography
  if (!GEN_POP.test(text) && !framed) return null

  // Explicit gen-pop wording with no geography at all ("General Population")
  // means the default we field: a US national read.
  return isState ? 'state' : 'national'
}

/**
 * How `n_internal_target` sits against the floor. Three states survive the
 * collapse of the old min/max grading, but the third one is a different case:
 *
 *   'ok'      — an internal target is set and clears the floor. Silent.
 *   'unset'   — NO internal target on the project. A soft SETUP prompt, not a
 *               sample problem: "you are under the 1,350 floor" on a project
 *               with no internal target reads as nonsense, and the fix is to
 *               type the number, not to sign anything off. No override.
 *   'warning' — an internal target is set and is below the floor. That is a
 *               deliberate choice against our own standard, so it takes the
 *               typed override + reason.
 */
export type NFloorBand = 'ok' | 'unset' | 'warning'

export interface NFloorResult {
  /** The audience reads as population-representative (and the type allows it). */
  applies: boolean
  scope: NFloorScope | null
  floor: number
  /** Verdict on `n_internal_target` — see NFloorBand. */
  band: NFloorBand
  /** The number actually being judged, echoed so callers name it in copy. */
  internalTarget: number | null
  /** n_actual is set and below the floor — the cleaned sample we deliver. */
  shortfallActual: boolean
  /**
   * Fielding is finished and n_collected came in under the floor — the
   * delivery-time re-check. Only ever true when `collectionFinal` was passed,
   * because a running tally is under the floor from its first response and
   * warning on that would fire on day one of every study.
   */
  shortfallCollected: boolean
  /**
   * A typed override is required: our internal target is short, or the N we
   * actually collected is, or the N we delivered is. A collected/delivered
   * number is a fact, not a plan, so a light one needs the sign-off even when
   * the internal target itself was fine. A MISSING internal target does not —
   * there is nothing to sign off on, only a field to fill in.
   */
  requiresOverride: boolean
}

export function nFloorCheck(p: {
  audience?: string | null
  project_type?: string | null
  /**
   * OUR internal collection goal — the number the floor is a standard for.
   * `n_target` / `n_target_max` (the client's contracted range) are deliberately
   * NOT read here; see the header.
   */
  n_internal_target?: number | null
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
  const scope = detectNFloorScope(p.audience, p.project_type)
  if (!scope) {
    return {
      applies: false,
      scope: null,
      floor: NATIONAL_FLOOR,
      band: 'ok',
      internalTarget: null,
      shortfallActual: false,
      shortfallCollected: false,
      requiresOverride: false,
    }
  }

  const floor = scope === 'state' ? STATE_FLOOR : NATIONAL_FLOOR
  const internalTarget = p.n_internal_target ?? null
  const band: NFloorBand =
    internalTarget == null ? 'unset' : internalTarget < floor ? 'warning' : 'ok'

  // No `> 0` guard here, unlike shortfallCollected below, and the asymmetry is
  // deliberate rather than an oversight: n_actual is nullable with no default,
  // so an unfielded project reads null and is skipped, whereas n_collected is
  // NOT NULL DEFAULT 0 and would otherwise flag every placeholder wave.
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
    internalTarget,
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
 * app hook and the connector can share one definition. Wired into
 * lib/hooks/usePipelineStage.ts (the checkbox / dot-spine path); the connector's
 * advance_project does NOT call it yet, so a project moved to Delivered through
 * the MCP tool or the ✦ Assistant skips this check — the same partial coverage
 * the compliance gate had before lib/mcp/writes.ts picked it up. `collectionFinal`
 * is forced true here: the delivered
 * transition is downstream of Fielding by definition, so n_collected is final
 * whatever the checkbox says.
 *
 * SOFT, like the card: an existing `n_floor_override` clears it (the sign-off has
 * already been given and is recorded on the project), and it is advice at a
 * decision point, not a permission check.
 */
export function nFloorDeliveryGate(p: {
  willMarkDelivered: boolean
  audience?: string | null
  project_type?: string | null
  /** Accepted so callers can spread a whole project; the gate judges facts only. */
  n_internal_target?: number | null
  n_collected?: number | null
  n_actual?: number | null
  n_floor_override?: boolean | null
}): NFloorGateResult {
  if (!p.willMarkDelivered) return { blocked: false, message: '' }
  // Already signed off — never re-ask. Same "confirmed once" rule as the Occam gate.
  if (p.n_floor_override) return { blocked: false, message: '' }
  const check = nFloorCheck({ ...p, collectionFinal: true })
  // Facts only. An internal target under the floor — or a missing one — is a
  // planning question and belongs to the card during scoping; blocking delivery
  // on it would re-litigate a decision at the worst possible moment. What must
  // not pass unremarked is the N we ended up with.
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
      `Fielding finished with ${short.join(' and ')}, under the ${fmtNum(check.floor)} we target ` +
      `internally for a ${scopeLabel} general-population study. Confirm this N is intentional ` +
      `before delivering.`,
  }
}
