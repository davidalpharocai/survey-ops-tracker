import { RESTRICTED_FIELDS } from '@/lib/utils/quickFields'

/**
 * The last gate before AI-generated values reach the database.
 *
 * WHY THIS IS NOT IN route.ts. A Next route file may export only the HTTP
 * handlers and a fixed list of config keys; any other export fails the
 * PRODUCTION build with "Property 'sanitizeFields' is incompatible with index
 * signature" — and nothing catches it earlier, because `next dev`, `tsc
 * --noEmit` and vitest are all happy with it. It was exported here for its
 * test, so the test now imports this module instead.
 */

// Belt-and-suspenders validation of the model output before it reaches the UI
// (the schema already constrains it, but never trust generated data near the DB).
export const ENUMS: Record<string, string[]> = {
  project_type: ['PS', 'B2B', 'Rerun'],
  status: ['Open', 'Archived', 'Closed', 'Hold'],
  board_column: ['Submitted', 'Doc Programming', 'Survey Programming', 'EdWin QA', 'Fielding', 'Data QA', 'Delivery'],
  scoping_stage: ['New Inquiry', 'Proposal Sent', 'Pricing Discussion', 'Awaiting Approval'],
}

/** The word the app shows, turned back into the value the column stores. One
 *  place, so 'Archived' can never reach the database as a status. */
const STORED_STATUS: Record<string, string> = { Archived: 'Closed' }

const NON_NEGATIVE = ['n_target', 'n_target_max', 'n_collected', 'n_actual', 'audience_size', 'budget', 'actual_spend']

export function sanitizeFields(
  fields: Record<string, unknown>,
  canSeeMoney: boolean
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) {
    if (v == null) continue
    // Second line of defence behind schemaFor(): the schema already omits these
    // for a non-holder, but a restricted field must never leave this route for
    // someone who may not set it, whatever the model returned.
    if (!canSeeMoney && RESTRICTED_FIELDS.has(k)) continue
    if (k in ENUMS && !ENUMS[k].includes(String(v))) continue // drop invalid enum values
    if (NON_NEGATIVE.includes(k) && typeof v === 'number' && v < 0) continue // drop negatives
    // 'Archived' is a label, not a stored value: it becomes 'Closed' here, the
    // last point before this leaves the route.
    out[k] = k === 'status' ? (STORED_STATUS[String(v)] ?? v) : v
  }
  // A project is either in the scoping funnel or on the pipeline — never both
  if (out.scoping_stage && out.board_column) delete out.board_column
  return out
}
