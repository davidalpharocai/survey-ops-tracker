/**
 * The Insights page's ONE filter object, and its round trip through the URL.
 *
 * The URL is the state: an analyst can send "the view I am looking at" and a
 * reload keeps it. Defaults are left off the URL so the everyday view is plain
 * `/insights`. An unknown value falls back to the default rather than emptying
 * the page, because an empty dashboard reads as "we delivered nothing".
 *
 * Keys: `range` (preset), `from`, `to` (custom only), `type`, `captain`,
 * `account`.
 */

import { DEFAULT_PRESET, PRESET_IDS, isoOrNull, type RangeChoice, type RangePreset } from './range'

/** A survey's type as the filter and the charts see it. `none` = no type
 *  recorded. 'Rerun' is the OLDER type value (before rerun became its own tag);
 *  today's reruns are PS or B2B surveys and are counted by the rerun tile. */
export const TYPE_KEYS = ['PS', 'B2B', 'Rerun', 'none'] as const
export type TypeKey = (typeof TYPE_KEYS)[number]

export const TYPE_LABEL: Record<TypeKey, string> = {
  PS: 'PS',
  B2B: 'B2B',
  Rerun: 'Rerun (older type)',
  none: 'No type set',
}

export const TYPE_HELP: Record<TypeKey, string> = {
  PS: 'PureSpectrum panel studies.',
  B2B: 'B2B studies, fielded by email or text blasts.',
  Rerun: 'Studies filed with the type "Rerun" before rerun became a separate tag. Newer reruns are PS or B2B studies with the rerun tag.',
  none: 'No type is recorded on the study.',
}

/** The value the filter stores for "no captain" — a real team member id is a
 *  uuid, so this can never collide with one. */
export const NO_CAPTAIN = 'none'

export interface InsightsFilter {
  range: RangeChoice
  /** A TypeKey, or null for every type. */
  type: TypeKey | null
  /** team_members.id, NO_CAPTAIN, or null for everyone. */
  captain: string | null
  /** clients.id, or null for every account. */
  account: string | null
}

export const DEFAULT_FILTER: InsightsFilter = {
  range: { preset: DEFAULT_PRESET, from: null, to: null },
  type: null,
  captain: null,
  account: null,
}

type ParamSource = URLSearchParams | { get(k: string): string | null } | Record<string, string | null | undefined>
const read = (src: ParamSource, k: string): string | null => {
  if (typeof (src as { get?: unknown }).get === 'function') return (src as { get(k: string): string | null }).get(k)
  const v = (src as Record<string, string | null | undefined>)[k]
  return v == null ? null : String(v)
}

const TYPE_SET = new Set<string>(TYPE_KEYS)

export function parseInsightsFilter(src: ParamSource): InsightsFilter {
  const raw = read(src, 'range')
  let preset: RangePreset = raw && PRESET_IDS.has(raw) ? (raw as RangePreset) : DEFAULT_PRESET
  const from = isoOrNull(read(src, 'from'))
  const to = isoOrNull(read(src, 'to'))
  // A custom range with neither bound is not a range.
  if (preset === 'custom' && !from && !to) preset = DEFAULT_PRESET
  const type = read(src, 'type')
  const captain = read(src, 'captain')?.trim() || null
  const account = read(src, 'account')?.trim() || null
  return {
    range: { preset, from: preset === 'custom' ? from : null, to: preset === 'custom' ? to : null },
    type: type && TYPE_SET.has(type) ? (type as TypeKey) : null,
    captain,
    account,
  }
}

const KEYS = ['range', 'from', 'to', 'type', 'captain', 'account'] as const

/** Write the filter into URL params, carrying anything else on `base` through. */
export function serializeInsightsFilter(f: InsightsFilter, base?: URLSearchParams | string): URLSearchParams {
  const out = new URLSearchParams(typeof base === 'string' ? base : base?.toString() ?? '')
  for (const k of KEYS) out.delete(k)
  if (f.range.preset !== DEFAULT_PRESET) out.set('range', f.range.preset)
  if (f.range.preset === 'custom') {
    if (f.range.from) out.set('from', f.range.from)
    if (f.range.to) out.set('to', f.range.to)
  }
  if (f.type) out.set('type', f.type)
  if (f.captain) out.set('captain', f.captain)
  if (f.account) out.set('account', f.account)
  return out
}

/** A real href to this page with the filter patched — for "Filter the page to
 *  Alex" links, so right-click / middle-click work. */
export function insightsHref(f: InsightsFilter, patch: Partial<InsightsFilter> = {}): string {
  const qs = serializeInsightsFilter({ ...f, ...patch }).toString()
  return qs ? `/insights?${qs}` : '/insights'
}

/** True when anything differs from the default — what shows "Clear filters". */
export function isFiltered(f: InsightsFilter): boolean {
  return f.range.preset !== DEFAULT_PRESET || f.type != null || f.captain != null || f.account != null
}
