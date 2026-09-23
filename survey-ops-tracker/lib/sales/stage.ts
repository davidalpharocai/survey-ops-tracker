/**
 * The one answer to "where is this survey?", for any list that shows it.
 *
 * ── THE BUG THIS REPLACES ───────────────────────────────────────────────────
 * Four surfaces each carried their own copy, and three of them opened with the
 * same line:
 *
 *   const stage = p.status !== 'Open' ? p.status : …
 *
 * Every delivered survey is ALSO `status='Closed'` — measured, 334 of 334 — so
 * the status test fired first and every one of them rendered as **"Closed"**.
 * Not some: all. The three were `components/sales/AccountDetail.tsx`,
 * `components/sales/SurveyListPrint.tsx` — which is the print artefact that goes
 * to a client — and the survey detail page's own header badge.
 *
 * The fourth, `SalesPipeline`, used `stageLabel(board_column)` and ignored
 * status entirely, so a cancelled survey read as "Fielding". Two wrong answers
 * in opposite directions, on screens sitting next to each other.
 *
 * ── WHY IT DELEGATES TO bucketOf ────────────────────────────────────────────
 * The precedence question — does Delivered beat Closed? does Hold beat Scoping?
 * — was already answered once, in `bucketOf`, and measured against production
 * there. Answering it a second time here is how the two drift apart: the tile
 * would say Delivered and the row would say Closed, which is the defect above
 * wearing different clothes. So the lifecycle half of this function IS
 * `bucketOf`, and the tiles and the rows cannot disagree by construction.
 *
 * What this adds is the other half: for a survey that is simply RUNNING, the
 * bucket is just 'active', and what the reader wants is its pipeline position —
 * Fielding, Data QA — not the word "Active".
 */
import { bucketOf, BUCKETS, type BucketInput } from './buckets'
import { stageLabel } from '@/lib/utils/stage'

export interface StageInput extends BucketInput {
  /** Only read for a survey in Scoping, where it is the pre-sale sub-stage. */
  scoping_stage?: string | null
}

/**
 * Lifecycle first, pipeline position second.
 *
 * A survey that ended — delivered, cancelled, held, archived — is described by
 * HOW it ended, because that is the thing a salesperson is asking. One that is
 * still running is described by WHERE it is, because that is the thing they are
 * asking about those.
 *
 * `scoping_stage` is used only inside the Scoping bucket. It is unreliable
 * elsewhere: 330 of 374 non-null rows still read "New Inquiry" and 271 of those
 * have already been delivered, so reading it outside Scoping would relabel most
 * of the delivered book as a pre-sale inquiry.
 */
export function stageOf(p: StageInput): string {
  switch (bucketOf(p)) {
    case 'delivered': return 'Delivered'
    case 'hold':      return 'On hold'
    case 'cancelled': return 'Cancelled'
    case 'archived':  return 'Archived'
    case 'scoping':   return p.scoping_stage ?? 'Scoping'
    case 'active':    return p.board_column ? stageLabel(p.board_column) : '—'
  }
}

/**
 * Per-pipeline-stage colour, for a survey that is still running. Walking the
 * spectrum in stage order means the colour carries the same information as the
 * position, so a column of these reads as progress rather than as decoration.
 */
const PIPELINE_TONE: Record<string, string> = {
  'Submitted': 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/25',
  'Doc Programming': 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/25',
  'Survey Programming': 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/25',
  'EdWin QA': 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/25',
  'Fielding': 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/25',
  'Data QA': 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/25',
}

/**
 * The badge colour for that stage.
 *
 * An ENDED survey takes the bucket's own `tone`, so the tiles, the rows, the
 * print and the survey header cannot drift apart — the same reason `stageOf`
 * delegates to `bucketOf` rather than re-deciding. A RUNNING one takes its
 * pipeline colour, which is the finer distinction and the only one that is
 * still changing.
 *
 * Defined here rather than in a component so the survey header, the list, the
 * account table and the printed report cannot end up with three palettes.
 */
export function stageTone(p: StageInput): string {
  const b = bucketOf(p)
  if (b === 'active') {
    return PIPELINE_TONE[p.board_column ?? ''] ?? 'bg-muted text-muted-foreground border-border'
  }
  return BUCKETS.find(x => x.id === b)!.tone
}
