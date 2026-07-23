// Status + color model for a rerun-series wave. Drives the colored badges in
// the Wave series view (WaveSeriesView) on the project page and /reruns.
// Three states, each a meaning-encoding color (see the "more color" UX rule):
//   delivered → green   (sent to the client / in the Delivery column)
//   active    → blue    (being worked or in field — the live wave)
//   upcoming  → amber   (auto-scheduled next wave, not yet started)
// Kept pure (a `today` string is passed in) so it's unit-testable.

export type WaveStatusKey = 'delivered' | 'active' | 'upcoming'

export interface WaveLike {
  board_column?: string | null
  delivered_at?: string | null
  deliver_date?: string | null
  launch_date?: string | null
}

export interface WaveStatusMeta {
  key: WaveStatusKey
  label: string
  /** Tailwind classes for a filled status chip. */
  chip: string
  /** Tailwind bg for a small status dot. */
  dot: string
  /** Tailwind border classes for the wave card/row accent. */
  ring: string
  /** Upcoming waves render with a dashed edge to read as "not yet real". */
  dashed: boolean
  /** One-line explainer for the (i) tooltip. */
  tip: string
}

const COLORS: Record<WaveStatusKey, { chip: string; dot: string; ring: string }> = {
  delivered: {
    chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    ring: 'border-emerald-500/50',
  },
  active: {
    chip: 'bg-primary/15 text-primary',
    dot: 'bg-primary',
    ring: 'border-primary/50',
  },
  upcoming: {
    chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
    ring: 'border-amber-400/70',
  },
}

/** Derive a wave's status from its pipeline fields, relative to `today` (YYYY-MM-DD). */
export function waveStatus(w: WaveLike, today: string): WaveStatusMeta {
  let key: WaveStatusKey
  let label: string
  let tip: string

  if (w.delivered_at || w.board_column === 'Delivery') {
    key = 'delivered'
    label = 'Delivered'
    tip = 'Delivered to the client.'
  } else if (w.board_column === 'Submitted' && (!w.launch_date || w.launch_date > today)) {
    key = 'upcoming'
    label = 'Upcoming'
    tip = 'Scheduled but not yet fielded — often the next wave auto-created by the rerun cadence.'
  } else {
    key = 'active'
    label = w.board_column === 'Fielding' ? 'In field' : 'In progress'
    tip = 'Being worked right now (in the pipeline, not yet delivered).'
  }

  return { key, label, dashed: key === 'upcoming', tip, ...COLORS[key] }
}

/** Legend entries in display order — for the small colour key above the view. */
export const WAVE_STATUS_LEGEND: { key: WaveStatusKey; label: string; dot: string; tip: string }[] = [
  { key: 'delivered', label: 'Delivered', dot: COLORS.delivered.dot, tip: 'Sent to the client.' },
  { key: 'active', label: 'In field', dot: COLORS.active.dot, tip: 'Live or being worked.' },
  { key: 'upcoming', label: 'Upcoming', dot: COLORS.upcoming.dot, tip: 'Auto-scheduled, not yet fielded.' },
]
