import { getDueUrgency, type DueUrgency } from '@/lib/utils/date'

// ---------------------------------------------------------------------------
// Pure calendar-event derivation. No React / Supabase imports here so the whole
// module is unit-testable in isolation (see events.test.ts). The hook
// (lib/hooks/useCalendarEvents.ts) wires this up to the cached queries.
// ---------------------------------------------------------------------------

export type CalendarEventType = 'due' | 'deliver' | 'launch' | 'rerun' | 'reminder'

// Chip render order within a day (and stable sort inside a bucket).
const TYPE_ORDER: Record<CalendarEventType, number> = {
  due: 0,
  deliver: 1,
  launch: 2,
  rerun: 3,
  reminder: 4,
}

/** All event types, in display order — the legend renders in this order. */
export const EVENT_TYPES: CalendarEventType[] = ['due', 'deliver', 'launch', 'rerun', 'reminder']

/**
 * Per-type presentation metadata shared by the grid, agenda, and legend so the
 * color-coding never drifts between surfaces. Colors are semantic-ish Tailwind
 * utilities that read in both light and dark themes.
 */
export const EVENT_TYPE_META: Record<
  CalendarEventType,
  { label: string; short: string; icon: string; dot: string; chip: string; tip: string }
> = {
  due: {
    label: 'Due (internal)',
    short: 'Due',
    icon: '⏰',
    dot: 'bg-red-500',
    chip: 'bg-red-500/15 text-red-700 dark:text-red-300',
    tip: "Internal due date — when the team needs the work done (survey_projects.due_date). Keeps its overdue/soon tint.",
  },
  deliver: {
    label: 'Deliver (client)',
    short: 'Deliver',
    icon: '📤',
    dot: 'bg-primary',
    chip: 'bg-primary/15 text-primary',
    tip: 'Client delivery date — when results go to the client (survey_projects.deliver_date). Keeps its overdue/soon tint.',
  },
  launch: {
    label: 'Launch',
    short: 'Launch',
    icon: '🚀',
    dot: 'bg-violet-500',
    chip: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    tip: 'Field go-live date — when the survey launches into field (survey_projects.launch_date).',
  },
  rerun: {
    label: 'Rerun (next wave)',
    short: 'Rerun',
    icon: '🔁',
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    tip: 'Next wave of a longitudinal study (survey_projects.rerun_date). Shown only when a rerun date is set.',
  },
  reminder: {
    label: 'Reminder (mine)',
    short: 'Reminder',
    icon: '🔔',
    dot: 'bg-amber-500',
    chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    tip: "Your own open reminders. Personal — not affected by the project filters, but toggle here to hide them.",
  },
}

/** How many chips a day cell shows before collapsing the rest into "＋N more". */
export const MAX_CHIPS_PER_DAY = 3

// ---------------------------------------------------------------------------
// Input shapes — structural, so a `SlimProject` (from useProjects) is assignable
// without this module importing the DB/query types.
// ---------------------------------------------------------------------------

export interface CalendarProject {
  id: string
  project_name: string
  client: string
  project_type: 'PS' | 'B2B' | 'Rerun' | 'Internal' | null
  phase: 'Scoping' | 'Active'
  status: 'Open' | 'Closed' | 'Hold'
  board_column: string | null
  priority: string | null
  longitudinal: boolean
  due_date: string | null
  deliver_date: string | null
  launch_date: string | null
  rerun_date: string | null
  captain: { id: string } | null
  co_captain_ids: string[] | null
}

export interface CalendarReminder {
  id: string
  text: string
  due_date: string
  project_id: string | null
}

export interface CalendarEvent {
  /** Stable unique key, e.g. `${projectId}:due` or `reminder:${id}`. */
  id: string
  type: CalendarEventType
  /** YYYY-MM-DD bucket key. */
  date: string
  /** Short chip label (client · project name for projects; text for reminders). */
  title: string
  projectId: string | null
  projectName: string | null
  client: string | null
  /** Urgency tint for due/deliver chips (null for other types / done work). */
  urgency: DueUrgency
}

export interface StatusScope {
  includeHold: boolean
  includeClosed: boolean
  includeScoping: boolean
}

export interface CalendarFilterState {
  /** Legend on/off per event type. */
  types: Record<CalendarEventType, boolean>
  captainId: string | null
  projectType: 'PS' | 'B2B' | 'Rerun' | null
  /** Restrict to the caller's own captained projects. */
  justMine: boolean
  /** Default = open only (Open + Active); each toggle widens the scope. */
  statusScope: StatusScope
  client: string | null
  /** High/urgent projects only. */
  priorityOnly: boolean
}

export const DEFAULT_FILTERS: CalendarFilterState = {
  types: { due: true, deliver: true, launch: true, rerun: true, reminder: true },
  captainId: null,
  projectType: null,
  justMine: false,
  statusScope: { includeHold: false, includeClosed: false, includeScoping: false },
  client: null,
  priorityOnly: false,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** YYYY-MM-DD from a date-only or ISO timestamp string (dates are UTC-anchored). */
function dayKey(value: string): string {
  return value.slice(0, 10)
}

/** Firm portion of a client string ("Acme - Q3 tracker" → "acme"), lowercased. */
function firmKey(client: string): string {
  return client.split(' - ')[0].trim().toLowerCase()
}

function isCaptainedBy(p: CalendarProject, memberId: string): boolean {
  return p.captain?.id === memberId || (p.co_captain_ids ?? []).includes(memberId)
}

/**
 * Default scope is Open + Active only. Each toggle *adds* a bucket:
 * On-Hold (status Hold), Closed (status Closed), Scoping (phase Scoping).
 */
function passesStatusScope(p: CalendarProject, scope: StatusScope): boolean {
  if (p.status === 'Open' && p.phase === 'Active') return true
  if (scope.includeHold && p.status === 'Hold') return true
  if (scope.includeClosed && p.status === 'Closed') return true
  if (scope.includeScoping && p.phase === 'Scoping') return true
  return false
}

function passesProjectFilters(
  p: CalendarProject,
  filters: CalendarFilterState,
  currentMemberId: string | null
): boolean {
  if (!passesStatusScope(p, filters.statusScope)) return false
  if (filters.projectType && p.project_type !== filters.projectType) return false
  if (filters.captainId && !isCaptainedBy(p, filters.captainId)) return false
  if (filters.justMine && (!currentMemberId || !isCaptainedBy(p, currentMemberId))) return false
  if (filters.client && firmKey(p.client) !== firmKey(filters.client)) return false
  if (filters.priorityOnly && !(p.priority === 'high' || p.priority === 'urgent')) return false
  return true
}

/** Short human label for a project chip: "Acme · Q3 tracker" (trimmed). */
function projectLabel(p: CalendarProject): string {
  const firm = p.client.split(' - ')[0].trim()
  return firm ? `${firm} · ${p.project_name}` : p.project_name
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Pure: turn in-scope projects + the caller's reminders into a flat, filtered
 * list of calendar events. Each project contributes up to four dated events
 * (due / deliver / launch / rerun); a Rerun event appears only when the project
 * is longitudinal AND has a rerun_date. Reminders are personal — they ignore
 * the project filters but obey their own legend toggle.
 */
export function deriveEvents(
  projects: CalendarProject[],
  reminders: CalendarReminder[],
  filters: CalendarFilterState,
  currentMemberId: string | null = null
): CalendarEvent[] {
  const events: CalendarEvent[] = []

  for (const p of projects) {
    // Internal projects are never survey deadlines (useProjects already drops
    // them; guard here so the pure fn is correct on any input).
    if (p.project_type === 'Internal') continue
    if (!passesProjectFilters(p, filters, currentMemberId)) continue

    const label = projectLabel(p)
    // Closed / Hold / Delivered projects drop the urgency tint (mirrors the
    // board card). A delivered project keeps status 'Open' with board_column
    // 'Delivery', so guard on the column too — otherwise its due/deliver chips
    // still read red/overdue even though the work is done.
    const tintable = !(p.status === 'Closed' || p.status === 'Hold' || p.board_column === 'Delivery')

    const add = (type: CalendarEventType, date: string | null) => {
      if (!date || !filters.types[type]) return
      events.push({
        id: `${p.id}:${type}`,
        type,
        date: dayKey(date),
        title: label,
        projectId: p.id,
        projectName: p.project_name,
        client: p.client,
        urgency: (type === 'due' || type === 'deliver') && tintable ? getDueUrgency(date) : null,
      })
    }

    add('due', p.due_date)
    add('deliver', p.deliver_date)
    add('launch', p.launch_date)
    // Rerun: longitudinal studies with a set next-wave date only.
    if (p.longitudinal && p.rerun_date) add('rerun', p.rerun_date)
  }

  if (filters.types.reminder) {
    for (const r of reminders) {
      if (!r.due_date) continue
      events.push({
        id: `reminder:${r.id}`,
        type: 'reminder',
        date: dayKey(r.due_date),
        title: r.text,
        projectId: r.project_id,
        projectName: null,
        client: null,
        urgency: null,
      })
    }
  }

  return events
}

/** Bucket events by YYYY-MM-DD, each day sorted by type order then title. */
export function bucketByDate(events: CalendarEvent[]): Record<string, CalendarEvent[]> {
  const byDate: Record<string, CalendarEvent[]> = {}
  for (const e of events) {
    ;(byDate[e.date] ??= []).push(e)
  }
  for (const key of Object.keys(byDate)) {
    byDate[key].sort(
      (a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.title.localeCompare(b.title)
    )
  }
  return byDate
}

/**
 * Split a day's events into the chips to show and how many are hidden. When
 * there's overflow we leave room for the "＋N more" affordance, so at most
 * `max` rows render (max-1 chips + the more button).
 */
export function splitDay(
  events: CalendarEvent[],
  max: number = MAX_CHIPS_PER_DAY
): { shown: CalendarEvent[]; overflow: number } {
  if (events.length <= max) return { shown: events, overflow: 0 }
  return { shown: events.slice(0, max - 1), overflow: events.length - (max - 1) }
}
