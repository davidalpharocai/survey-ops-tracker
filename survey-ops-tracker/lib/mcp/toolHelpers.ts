import 'server-only'
import { baseUrl } from '@/lib/oauth/http'

/**
 * Shared helpers used by the tool registry (lib/mcp/registry.ts). Extracted from the
 * original inline MCP route so both the connector (app/api/mcp/route.ts) and the in-app
 * assistant can import one source of truth. Logic is byte-for-byte the same as what ran
 * inline before the extraction.
 */

/**
 * Preview-then-confirm gate for a mutating tool: `args.confirm !== true` runs `previewFn`
 * and wraps its result as `{ preview }` (no write); `confirm: true` runs `commitFn`.
 */
export async function confirmable<P, C>(
  args: { confirm?: boolean },
  previewFn: () => Promise<P>,
  commitFn: () => Promise<C>
): Promise<{ preview: P } | C> {
  if (args.confirm !== true) return { preview: await previewFn() }
  return commitFn()
}

/** "n_target" -> "N target" — a generic, good-enough label for a diff line. */
export function fieldLabel(field: string): string {
  const s = field.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function fmtChangeVal(v: unknown): string {
  return v === null || v === undefined || v === '' ? '—' : String(v)
}

/** {field:[old,new]} -> "N target 500 → 900; Due date 2026-07-01 → 2026-07-20". */
export function describeChanges(changed: Record<string, [unknown, unknown]>): string {
  const entries = Object.entries(changed)
  if (entries.length === 0) return 'No changes.'
  return entries
    .map(([field, [oldV, newV]]) => `${fieldLabel(field)} ${fmtChangeVal(oldV)} → ${fmtChangeVal(newV)}`)
    .join('; ')
}

/** Today's date (YYYY-MM-DD) in the team's local timezone — matches the reminders-due cron. */
export function todayEastern(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

/** Best-effort document title lookup via the app's own /api/doc-title (Drive API, else a public scrape). */
export async function fetchDocTitle(url: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl()}/api/doc-title?url=${encodeURIComponent(url)}`)
    if (!res.ok) return null
    const body = (await res.json()) as { title?: string | null }
    return body.title ?? null
  } catch {
    return null
  }
}

export const DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const CLIENT_WRITE_FIELDS = [
  'compliance_before_fielding', 'compliance_after_fielding', 'compliance_contact', 'compliance_notes', 'code',
] as const

export const CONTACT_WRITE_FIELDS = ['first_name', 'last_name', 'email', 'title', 'phone'] as const

/**
 * Server instructions (2nd `createMcpHandler` arg, `ServerOptions.instructions` from
 * `@modelcontextprotocol/sdk`) — surfaced to the model as system-level guidance for using
 * this connector well. See docs/superpowers/specs/2026-07-07-mcp-writes-phase2-design.md
 * ("Teaching Claude to use it well").
 */
export const MCP_INSTRUCTIONS = `Survey Ops Command Center — connector guidance.

What counts as "open"/"due" (read first): a project's status is Open, Archived, or Hold (Archived = finished/legacy, kept for history but off the active board; Hold = on hold/paused); its phase is Scoping (pre-sale) or Active (in operations); its board column runs Submitted → Doc Programming → Survey Programming → EdWin QA → Fielding → Data QA → Delivery (the last shows as "Delivered"). A project is open/active and can be "due" or "overdue" ONLY when status is Open AND phase is Active AND it is NOT in the Delivered column. NEVER describe an Archived, On-Hold, or Delivered project as due, overdue, due soon, open, or active — Archived and Delivered are finished; Hold is paused. A delivered project may still read status "Open" until someone archives it, so trust the board column. search_projects returns only active projects by default; pass active_only:false only to look up a specific or past/archived project. In pipeline_summary, only the overdue, due-soon, and fielding-behind LISTS are scoped to active work; its counts (by_status / by_phase / by_board_column) are a full breakdown that still includes On-Hold, Scoping, and Delivered — so never report counts.by_status.Open as the number of open/active projects. To count open/active work, use search_projects (active-scoped by default) and count the result.

Answer efficiently: answer in as FEW tool calls as possible — prefer one targeted call over several exploratory ones. For "how many/list <person>'s open/active projects" (e.g. "how many open surveys does Bryan have"), make ONE search_projects call with captain set to that person — active projects are returned by default, so don't pass a status — then count/list the result yourself. For archived or past projects, add active_only:false (plus status:'Archived' if you want only archived ones). Do NOT call get_me first (that's only for "me/my/mine"), and do NOT fetch each project's details just to count or list them. For pipeline/status/overview questions or "what's overdue," one pipeline_summary call is enough (add mine:true only for "my/me"). Only call get_project, get_client_history, or get_project_history when the user asks for specifics or history — never just to answer a simple count or list.

Before mutating: every create/update/status/stage tool follows preview-then-confirm — a call without confirm:true only returns a preview and never writes. Read the preview back to the user in plain language and get their explicit OK before calling again with confirm:true. Never set confirm:true unless the user has clearly approved the specific change shown in the preview.

Duplicates: create_project checks for likely duplicate projects and returns them instead of writing. Ask the user whether to proceed before retrying with proceed_despite_duplicate:true — don't assume they want to.

Creating a project — run an intake checklist. When asked to create/add a survey or project, make sure these are covered, asking for any the user hasn't given: client + project name (required); **captain (required)** — create_project refuses without a valid team member; project type (PS/B2B/Rerun); salesperson; requested-by (which client contact); due date; N target; audience size; budget; whether it's longitudinal (+ cadence); and **whether it's approved for the open pipeline or still in scoping**. For every item EXCEPT client/name/captain, always offer the user "Not sure / will fill it in later" — if they choose it, leave that field blank and move on; never nag or block on it.
- Captain not on the roster? Tell the user and OFFER to add them: with their approval, get the person's name + @alpharoc email and call add_team_member (preview → confirm), then create the project with that captain. Never invent a captain or leave one unassigned.
- Pipeline status: if the user hasn't said, ASK whether it's approved to move into the open pipeline (→ pass skip_scoping:true, starts Active/Submitted) or still in scoping / pre-sale (→ leave skip_scoping off; it defaults to Scoping / New Inquiry).
create_project takes the WHOLE intake in one call — client/project_name/project_type/captain/salesperson/due_date/n_target/skip_scoping PLUS n_internal_target, audience, audience_size, budget, launch_date, deliver_date, submitted_date, the Y/N flags (row_level_data/longitudinal/voter_survey_qa/citation_language_needed/terminations), latest_next_steps, AND requested_by (the client contact who requested it — pass their name/email and it tags the existing contact). Pass every field you were given to create_project directly; do NOT leave requested-by, audience, budget, or dates for a separate follow-up. If the client has compliance requirements (visible via get_client), mention them. Read the assembled details back to the user, then create. Use update_project / set_requested_by only to CHANGE fields on an already-created project.

History & "what did we do last time": for "what did we do last time for <client>" or when planning a new project for a client you've served before, call get_client_history first — it returns past projects, derived patterns (typical N, common project type, typical fielding duration, cadence, recurring contacts), and any explicitly stated preferences. Use those patterns to offer sensible defaults when creating a new project for that client. get_project_history returns a project's sibling waves when it's part of a longitudinal/rerun series.

Questionnaire content: the actual questions asked live in Google Docs/Sheets, not this database. get_project and get_client_history return linked document URLs — hand those to the user's Drive connector if they ask what was asked last time, rather than guessing at question content.

Resolving "me"/"my": call get_me to resolve the caller's own name/initials/role, then pass mine:true to search_projects/pipeline_summary (or the resolved initials as captain) to answer "what's overdue for me" or "my projects."

Recording interactions: to log that something happened outside the app (e.g. "we emailed the client about timeline"), use add_note (project-scoped) or add_client_note (client-scoped) — there is deliberately no tool to write a project_activity entry directly.

Corrections: logged blasts and bids can't be edited or deleted via the connector. If a user needs to correct one, tell them to do it in the app.

Money idempotency: log_blast affects spend, so a retried confirm must not double-count. Pass a stable idem_key for each blast you intend to log (e.g. derived from the conversation turn) and reuse that same idem_key if you retry the same confirm call — don't generate a new one on retry. Only use a different idem_key when the user genuinely means a new, separate blast.

Segmented N: if update_project refuses because a project's N is segmented, don't try to work around it — tell the user to edit the segment breakdown in the app.

Learning preferences: if a user explicitly overrides a suggestion "going forward" (e.g. "always use PS not B2B for this client"), offer to save it with set_client_preference so it's visible to the whole team, not just remembered for this conversation.`
