/**
 * Which section of the board a survey renders in: the Scoping lane, the
 * Operations Pipeline, or Archived. ONE answer, used by the board's render AND
 * by its CSV export, so what is on screen and what is in the file cannot drift.
 *
 * WHY THIS EXISTS. The board used to build its three sections with three
 * independent filters (app/(app)/page.tsx):
 *   scoping  = phase Scoping + status Open
 *   pipeline = phase Active  + status Open or Hold
 *   archived = phase Active  + status Closed, or status Cancelled
 * Nothing checked that together they covered every row, and they did not: a
 * deal put on hold while still in Scoping matched none of the three. The
 * finance audit (24 Sep) found nine such surveys in no section and missing from
 * the board CSV, four of them on hold since 18 June. Archiving a scoping deal
 * (More → Archive project sets status Closed and leaves phase alone) fell
 * through the same way. Dragging a held pipeline card back into Scoping made
 * it vanish on the spot.
 *
 * THE FIX IS A TABLE, not a chain of ifs. `SECTION_TABLE` is typed as a Record
 * over the database's own phase and status enums, so every combination has to
 * be written down with a reason, and a new enum value (after the types are
 * regenerated) fails `tsc` until somebody decides where it goes. A value the
 * types do not know about at run time (a row written before a regen) comes
 * back 'unsorted' with the reason, and the page lists it instead of dropping it.
 *
 * THE SCOPING LANE HAS A SECOND KEY. Inside the lane a card is drawn in the
 * column its `scoping_stage` names, and the database's scoping_stage enum has a
 * fifth value, 'Closed' (from the first schema, 002), that is not a column. The
 * AI quick edit offers it (app/api/parse-project/route.ts), so an open deal can
 * be given it. Such a row would pass the status × phase table, be counted and
 * exported, and be drawn in no column. So a Scoping-lane row whose stage is not
 * a column is 'unsorted' too, and `laneStageOf` is the one place that decides
 * the column, for the lane's render and Full View's drop math alike.
 *
 * HOW THIS RELATES TO lib/finance/lifecycle.ts `classify`. That classifier
 * answers "what does this survey's money mean" (delivered, hold, live …). This
 * one answers "which lane is the card worked in", which is what drag and drop
 * writes: the lane is decided by `phase`, the treatment inside it by `status`.
 * They agree where they overlap. The one place they deliberately differ is a
 * survey still marked Scoping that has started fielding (PR00443): finance
 * already counts it as live work; the board keeps it where its phase says and
 * flags it (`fieldActivityOf` below) so somebody moves it.
 */
import { fmtNum } from '@/lib/utils/number'
import { cardOrder, type BoardSortMode } from '@/lib/utils/ordering'
import type { Database, ProjectPhase, ProjectStatus } from '@/lib/supabase/types'

export type BoardSection = 'scoping' | 'pipeline' | 'archived'

export type ScopingStage = Database['public']['Enums']['scoping_stage']

const plural = (n: number, one: string, many: string) => `${fmtNum(n)} ${n === 1 ? one : many}`

/**
 * The Scoping lane's columns, left to right. The enum's fifth value, 'Closed',
 * is deliberately not one: a deal that is over is archived (status Closed or
 * Cancelled), not parked in a column. Lives here, not in ScopingBoard, so the
 * classifier can use it without importing a React component; ScopingBoard
 * re-exports it for the screens that have always imported it from there.
 */
export const SCOPING_STAGES: ScopingStage[] = [
  'New Inquiry',
  'Proposal Sent',
  'Pricing Discussion',
  'Awaiting Approval',
]

/**
 * The Scoping column a card is drawn in. No stage yet means New Inquiry (the
 * database default, and what the project page's stage track assumes). A stage
 * that is not a column ('Closed', or anything unknown) gives null: there is no
 * column to draw it in, so `boardSectionOf` lists the row as unsorted instead.
 */
export function laneStageOf(p: { scoping_stage?: string | null }): ScopingStage | null {
  const stage = p.scoping_stage ?? 'New Inquiry'
  return (SCOPING_STAGES as string[]).includes(stage) ? (stage as ScopingStage) : null
}

/** Plain-English section names, for the unsorted notice and the tests. */
export const SECTION_LABEL: Record<BoardSection, string> = {
  scoping: 'Scoping',
  pipeline: 'Operations Pipeline',
  archived: 'Archived',
}

interface Cell {
  section: BoardSection
  /** Why this combination lands here — kept next to the decision on purpose. */
  why: string
}

/**
 * Every status × phase the database allows, and where it goes. Status first
 * because status decides between "worked on" and "archived"; phase then picks
 * the lane.
 */
export const SECTION_TABLE: Record<ProjectStatus, Record<ProjectPhase, Cell>> = {
  Open: {
    Scoping: { section: 'scoping', why: 'An open deal still being scoped or priced.' },
    Active: { section: 'pipeline', why: 'Sold and being worked on.' },
  },
  Hold: {
    // The gap the audit found. A paused deal is still a deal: it stays in its
    // scoping column, greyed with an "On hold" badge and sorted to the bottom,
    // exactly as a held pipeline card does in its column.
    Scoping: { section: 'scoping', why: 'A paused deal. It keeps its scoping column, greyed out with an On hold badge.' },
    Active: { section: 'pipeline', why: 'Paused work. It keeps its pipeline column, greyed out with an On hold badge.' },
  },
  Closed: {
    // "Archive project" promises the Archived section from any phase, so a
    // deal archived while still in Scoping has to land there too.
    Scoping: { section: 'archived', why: 'A deal archived before it was ever sold.' },
    Active: { section: 'archived', why: 'Delivered, or archived by hand.' },
  },
  Cancelled: {
    // A client can cancel at any stage, including while still in Scoping.
    Scoping: { section: 'archived', why: 'Cancelled by the client before it was sold.' },
    Active: { section: 'archived', why: 'Cancelled by the client after it was sold.' },
  },
}

/** The fields the classifier reads. Structural, so any project shape fits. */
export interface SectionSubject {
  phase: string | null
  status: string | null
  /** Read only for rows the table puts in the Scoping lane (see laneStageOf).
   *  Pipeline rows keep a stale stage from their scoping days; it is ignored. */
  scoping_stage?: string | null
}

export type SectionVerdict =
  | { section: BoardSection; why: string }
  | { section: 'unsorted'; why: string }

const hasKey = <K extends string>(o: Record<K, unknown>, k: string | null): k is K =>
  k != null && Object.prototype.hasOwnProperty.call(o, k)

/** Where one survey renders. Never throws, never drops a row. */
export function boardSectionOf(p: SectionSubject): SectionVerdict {
  if (!hasKey(SECTION_TABLE, p.status)) {
    return { section: 'unsorted', why: p.status == null ? 'It has no status.' : `Its status "${p.status}" is not one the board knows.` }
  }
  const byPhase = SECTION_TABLE[p.status]
  if (!hasKey(byPhase, p.phase)) {
    return { section: 'unsorted', why: p.phase == null ? 'It has no phase.' : `Its phase "${p.phase}" is not one the board knows.` }
  }
  const cell = byPhase[p.phase]
  // The lane draws a card only in the column its stage names. A stage with no
  // column would be counted and exported but drawn nowhere, so list it instead.
  if (cell.section === 'scoping' && laneStageOf(p) === null) {
    return {
      section: 'unsorted',
      why: `It is in Scoping, but its stage "${p.scoping_stage}" is not a Scoping column. Pick a stage, or archive it if the deal is over.`,
    }
  }
  return cell
}

export interface BoardPartition<T> {
  scoping: T[]
  pipeline: T[]
  archived: T[]
  /** Rows no section claims. Empty in practice; listed on the page if not. */
  unsorted: { project: T; why: string }[]
}

/**
 * Split the board's rows into its sections. Every input row lands in exactly
 * one output list, in input order.
 */
export function partitionBoard<T extends SectionSubject>(projects: T[]): BoardPartition<T> {
  const out: BoardPartition<T> = { scoping: [], pipeline: [], archived: [], unsorted: [] }
  for (const p of projects) {
    const v = boardSectionOf(p)
    if (v.section === 'unsorted') out.unsorted.push({ project: p, why: v.why })
    else out[v.section].push(p)
  }
  return out
}

/**
 * The rows the board CSV writes: the sections the current view shows, in the
 * order they appear on the page. Operations view shows only the pipeline (and
 * Archived, which the export has never carried in that view). Unsorted rows go
 * into the file in BOTH views: they are the rows most in need of a look, and a
 * file that quietly omits them is the defect this module exists to end.
 */
export function boardExportRows<T>(parts: BoardPartition<T>, mode: 'full' | 'operations'): T[] {
  const unsorted = parts.unsorted.map(u => u.project)
  return mode === 'full'
    ? [...parts.scoping, ...parts.pipeline, ...parts.archived, ...unsorted]
    : [...parts.pipeline, ...unsorted]
}

/**
 * The Export button's tooltip: what the file holds, in words, with its count.
 * The file follows the view (Full View or Operations) and nothing else. The
 * pipeline's own filters (captain, search, type …) live inside <Board/> and
 * never reach the export, and neither does the Archived section's Delivered
 * window, so the tooltip says that plainly instead of promising "the projects
 * currently shown" (which is what it used to say, and was not true).
 */
export function boardExportHelp<T>(parts: BoardPartition<T>, mode: 'full' | 'operations'): string {
  const n = boardExportRows(parts, mode).length
  const what =
    mode === 'full'
      ? 'everything in Scoping, the Operations Pipeline and Archived'
      : 'everything in the Operations Pipeline (Archived is not in this view’s file)'
  const unsorted =
    parts.unsorted.length > 0
      ? ` It also holds the ${plural(parts.unsorted.length, 'study', 'studies')} listed above that fit no section.`
      : ''
  const ignores =
    mode === 'full'
      ? 'The pipeline filters (captain, search and the rest) and the Delivered window do not narrow it.'
      : 'The pipeline filters (captain, search and the rest) do not narrow it.'
  return `Downloads a CSV of ${plural(n, 'project', 'projects')}: ${what}.${unsorted} ${ignores}`
}

/**
 * A lane's open and on-hold deals, counted apart. A lane's head count is its
 * OPEN work: holds are their own bucket, kept out of live totals (David, 24
 * Sep), and the finance classifier counts them apart as well
 * (lib/finance/lifecycle.ts puts Hold ahead of Scoping), so the board's
 * "in Scoping" number agrees with Finance and Insights. Holds get their own
 * "⏸ N on hold" chip, so they stay visible.
 */
export function laneCounts(projects: { status: string | null }[]): { open: number; held: number } {
  let held = 0
  for (const p of projects) if (p.status === 'Hold') held++
  return { open: projects.length - held, held }
}

/** What a collapsed lane says it is hiding: "14 open · 8 on hold hidden — click to expand". */
export function collapsedLaneText({ open, held }: { open: number; held: number }): string {
  const parts: string[] = []
  if (open > 0) parts.push(`${fmtNum(open)} open`)
  if (held > 0) parts.push(`${fmtNum(held)} on hold`)
  return parts.length === 0 ? 'collapsed' : `${parts.join(' · ')} hidden — click to expand`
}

/**
 * Card order inside a scoping column: held deals sink to the bottom (as they do
 * in the pipeline, via columnSortRank), then the board's normal scoping order.
 * The scoping lane's render AND Full View's drop math both sort through this —
 * a render order that disagrees with the drop math lands a card somewhere the
 * user did not drop it (see lib/utils/ordering.ts).
 */
export function scopingLaneOrder<
  T extends {
    status?: string | null
    sort_order?: number | null
    created_at?: string
    deliver_date?: string | null
    due_date?: string | null
  },
>(mode: BoardSortMode): (a: T, b: T) => number {
  const base = cardOrder<T>('scoping', mode)
  const held = (p: T) => (p.status === 'Hold' ? 1 : 0)
  return (a, b) => held(a) - held(b) || base(a, b)
}

// ---------------------------------------------------------------------------
// "Has field activity" — a survey still marked Scoping that has started fielding
// ---------------------------------------------------------------------------

/**
 * Child-row counts for one survey. Existence only: the board never reads a
 * dollar figure (budget and spend stay off the board's select on purpose), so
 * "field spend" is detected by the rows that make spend, not by the amount.
 */
export interface FieldRows {
  /** project_blasts rows: B2B sends. */
  blasts: number
  /** project_suppliers rows: PureSpectrum panel suppliers. */
  panel: number
  /** project_costs rows of kind sms_email_blast: the platform fee for a send. */
  sendCosts: number
}

export const NO_FIELD_ROWS: FieldRows = { blasts: 0, panel: 0, sendCosts: 0 }

export interface FieldActivity {
  blasts: number
  panel: number
  sendCosts: number
  /** Responses collected so far (n_collected), or the final N when only that is set. */
  responses: number
  /** What was found, in words: "17 blasts logged and 23 responses collected". */
  summary: string
}

export interface FieldActivitySubject {
  phase: string | null
  n_collected?: number | null
  n_actual?: number | null
}

/**
 * The evidence that a survey still in phase Scoping is already being fielded,
 * or null when there is none (or it is not in Scoping). Mirrors the finance
 * classifier's rule that "a survey that has started buying respondents is being
 * fielded whatever its phase says" (blast and panel rows), and adds the two
 * other traces fielding leaves: a send fee on the cost lines, and responses.
 * Contact purchases and "other" cost lines are NOT counted: buying contacts to
 * size a deal is scoping work.
 */
export function fieldActivityOf(p: FieldActivitySubject, rows: FieldRows = NO_FIELD_ROWS): FieldActivity | null {
  if (p.phase !== 'Scoping') return null
  const collected = Math.max(0, Number(p.n_collected ?? 0) || 0)
  const finalN = Math.max(0, Number(p.n_actual ?? 0) || 0)
  const responses = collected > 0 ? collected : finalN
  const blasts = Math.max(0, rows.blasts)
  const panel = Math.max(0, rows.panel)
  const sendCosts = Math.max(0, rows.sendCosts)
  if (blasts + panel + sendCosts === 0 && responses === 0) return null
  const parts: string[] = []
  if (blasts > 0) parts.push(`${plural(blasts, 'blast', 'blasts')} logged`)
  if (panel > 0) parts.push(`${plural(panel, 'panel supplier', 'panel suppliers')} set up`)
  if (sendCosts > 0) parts.push(`${plural(sendCosts, 'send fee', 'send fees')} recorded`)
  if (collected > 0) parts.push(`${plural(collected, 'response', 'responses')} collected`)
  else if (finalN > 0) parts.push(`a final N of ${fmtNum(finalN)} recorded`)
  const summary = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return { blasts, panel, sendCosts, responses, summary }
}
