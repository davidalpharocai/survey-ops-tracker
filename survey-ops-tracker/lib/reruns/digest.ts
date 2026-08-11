// Pure builder for the weekly "Rerun digest" email (migration 073's
// rerun_series_status view + the legacy rerun_status view, unioned during the
// transition — see docs/superpowers/specs/2026-08-10-rerun-update-design.md
// §12/§18). Kept free of any DB/network calls so the bucketing + HTML are
// cheaply unit-testable; the cron (app/api/cron/rerun-digest) is the only
// caller that touches Supabase, and it maps both views into `RerunCalendarRow`
// before calling in here.
//
// Two-step shape, deliberately: `bucketRerunCalendar` classifies raw rows into
// the week's four cuts, `buildRerunDigest` turns the already-bucketed arrays
// into the subject + HTML. Splitting them keeps each step trivial to test in
// isolation (bucketing logic vs. rendering).

import { addDays, parseISO, format } from 'date-fns'

// ---------------------------------------------------------------------------
// Shared item shape (bucket output + HTML input)
// ---------------------------------------------------------------------------

export interface RerunDigestItem {
  client: string
  surveyName: string
  waveNo: number | null
  cadenceLabel: string | null
  /** YYYY-MM-DD the item is bucketed on (or '' if genuinely undated, e.g. a
   * needs-definition series with no cadence to compute a date from). */
  dateISO: string
  href?: string
}

export interface RerunDigestBuckets {
  overdue: RerunDigestItem[]
  fielding: RerunDigestItem[]
  delivering: RerunDigestItem[]
  upcoming: RerunDigestItem[]
}

// ---------------------------------------------------------------------------
// bucketRerunCalendar
// ---------------------------------------------------------------------------

/** Raw calendar signal for one series or legacy rerun row. The cron route
 * maps both `rerun_series_status` (series-level: isOverdue/needsDefinition/
 * effectiveDueISO) and per-wave `survey_projects` rows (launchDateISO/
 * deliverDateISO) into this common shape before bucketing. */
export interface RerunCalendarRow {
  client: string
  surveyName: string
  waveNo: number | null
  cadenceLabel: string | null
  href?: string
  /** Series (or legacy rerun) is past its effective due date. */
  isOverdue: boolean
  /** Series (or legacy rerun) has no cadence/owner defined — also an
   * "action needed" item, folded into the same overdue bucket. */
  needsDefinition: boolean
  /** The series' next-due date (drives overdue display + next-week preview). */
  effectiveDueISO: string | null
  /** A concrete wave's field go-live date. */
  launchDateISO: string | null
  /** A concrete wave's client delivery date. */
  deliverDateISO: string | null
}

function addDaysISO(dateISO: string, days: number): string {
  return format(addDays(parseISO(dateISO), days), 'yyyy-MM-dd')
}

function inRange(dateISO: string, startISO: string, endISO: string): boolean {
  return dateISO >= startISO && dateISO <= endISO
}

function byDateThenClient(a: RerunDigestItem, b: RerunDigestItem): number {
  return a.dateISO.localeCompare(b.dateISO) || a.client.localeCompare(b.client)
}

/**
 * Classify rows into the week's four cuts (spec §12):
 * - overdue / needs action: `isOverdue` or `needsDefinition` (mutually
 *   exclusive with the rest — an item flagged here is never double-counted).
 * - fielding this week: `launchDateISO` falls within [weekStart, weekStart+6].
 * - delivering this week: `deliverDateISO` falls within the same window.
 *   (A row can land in both fielding AND delivering the same week.)
 * - next week preview: `effectiveDueISO` falls within the following week,
 *   only checked when the row didn't already match fielding/delivering.
 */
export function bucketRerunCalendar(rows: RerunCalendarRow[], weekStartISO: string): RerunDigestBuckets {
  const weekEndISO = addDaysISO(weekStartISO, 6)
  const nextWeekStartISO = addDaysISO(weekStartISO, 7)
  const nextWeekEndISO = addDaysISO(weekStartISO, 13)

  const overdue: RerunDigestItem[] = []
  const fielding: RerunDigestItem[] = []
  const delivering: RerunDigestItem[] = []
  const upcoming: RerunDigestItem[] = []

  for (const r of rows) {
    const base = { client: r.client, surveyName: r.surveyName, waveNo: r.waveNo, cadenceLabel: r.cadenceLabel, href: r.href }

    if (r.isOverdue || r.needsDefinition) {
      overdue.push({ ...base, dateISO: r.effectiveDueISO ?? '' })
      continue
    }

    let matchedThisWeek = false
    if (r.launchDateISO && inRange(r.launchDateISO, weekStartISO, weekEndISO)) {
      fielding.push({ ...base, dateISO: r.launchDateISO })
      matchedThisWeek = true
    }
    if (r.deliverDateISO && inRange(r.deliverDateISO, weekStartISO, weekEndISO)) {
      delivering.push({ ...base, dateISO: r.deliverDateISO })
      matchedThisWeek = true
    }
    if (!matchedThisWeek && r.effectiveDueISO && inRange(r.effectiveDueISO, nextWeekStartISO, nextWeekEndISO)) {
      upcoming.push({ ...base, dateISO: r.effectiveDueISO })
    }
  }

  overdue.sort(byDateThenClient)
  fielding.sort(byDateThenClient)
  delivering.sort(byDateThenClient)
  upcoming.sort(byDateThenClient)

  return { overdue, fielding, delivering, upcoming }
}

// ---------------------------------------------------------------------------
// buildRerunDigest — email-client-safe HTML (table layout, inline styles only)
// ---------------------------------------------------------------------------

export interface BuildRerunDigestInput extends RerunDigestBuckets {
  /** Monday of the digest week, YYYY-MM-DD. */
  weekStartISO: string
  /** Sunday of the digest week, YYYY-MM-DD. */
  weekEndISO: string
  /** App origin, no trailing slash (e.g. https://survey-ops-tracker.vercel.app). */
  baseUrl: string
}

export interface RerunDigest {
  subject: string
  html: string
}

const NAVY = '#010B40'
const TEAL = '#0076AF'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtDate(dateISO: string): string {
  if (!dateISO) return '—'
  return new Date(dateISO + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function sublineOf(item: RerunDigestItem): string {
  const parts: string[] = []
  if (item.waveNo != null) parts.push(`Wave ${item.waveNo}`)
  if (item.cadenceLabel) parts.push(item.cadenceLabel)
  return parts.join(' · ')
}

function itemRow(item: RerunDigestItem): string {
  const subline = sublineOf(item)
  const titleText = `${escapeHtml(item.client)} — ${escapeHtml(item.surveyName)}`
  const title = item.href
    ? `<a href="${escapeHtml(item.href)}" style="color:${NAVY};text-decoration:none;">${titleText}</a>`
    : titleText
  return `
        <tr>
          <td style="padding:10px 28px;border-bottom:1px solid #f3f4f6;font-family:Arial,Helvetica,sans-serif;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:14px;color:#111827;line-height:1.4;">
                <strong>${title}</strong>${subline ? `<br/><span style="font-size:12px;color:#6b7280;">${escapeHtml(subline)}</span>` : ''}
              </td>
              <td align="right" valign="top" style="font-size:13px;color:#374151;white-space:nowrap;padding-left:16px;">${fmtDate(item.dateISO)}</td>
            </tr></table>
          </td>
        </tr>`
}

function section(title: string, accent: string, chipBg: string, items: RerunDigestItem[]): string {
  if (items.length === 0) return ''
  const header = `
        <tr>
          <td style="padding:20px 28px 6px;font-family:Arial,Helvetica,sans-serif;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:12px;font-weight:bold;color:#111827;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(title)}</td>
              <td style="padding-left:8px;">
                <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                  <td style="background:${chipBg};color:${accent};font-size:11px;font-weight:bold;padding:2px 8px;border:1px solid ${accent};">${items.length}</td>
                </tr></table>
              </td>
            </tr></table>
          </td>
        </tr>`
  return header + items.map(itemRow).join('')
}

function shell(rangeLabel: string, baseUrl: string, bodyHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e5e7eb;">
        <tr>
          <td style="background:${NAVY};padding:20px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:16px;font-weight:bold;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">AlphaROC &middot; Survey Ops</td>
            </tr><tr>
              <td style="font-size:13px;color:#c7d2fe;font-family:Arial,Helvetica,sans-serif;padding-top:4px;">Reruns this week &middot; ${escapeHtml(rangeLabel)}</td>
            </tr></table>
          </td>
        </tr>
${bodyHtml}
        <tr>
          <td style="padding:18px 28px;border-top:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;">
            <a href="${escapeHtml(baseUrl)}/reruns" style="color:${TEAL};font-size:14px;font-weight:bold;text-decoration:none;">Open the Reruns page</a>
            <p style="margin:10px 0 0;font-size:11px;color:#9ca3af;line-height:1.5;">Sent Mondays; dates advance automatically by each series' cadence.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`
}

/** Build the subject + HTML for the weekly digest from already-bucketed
 * items. Subject front-loads the headline counts (overdue/fielding/
 * delivering — the next-week preview is informational and not counted in the
 * subject). An entirely empty week still returns a valid digest — the cron
 * sends it regardless — with a `(0)` subject suffix and a one-line body. */
export function buildRerunDigest(input: BuildRerunDigestInput): RerunDigest {
  const { weekStartISO, weekEndISO, baseUrl, overdue, fielding, delivering, upcoming } = input
  const weekLabel = fmtDate(weekStartISO)
  const rangeLabel = `${fmtDate(weekStartISO)} – ${fmtDate(weekEndISO)}`
  const total = overdue.length + fielding.length + delivering.length + upcoming.length

  if (total === 0) {
    const subject = `Rerun digest · week of ${weekLabel} (0)`
    const body = `
        <tr>
          <td style="padding:24px 28px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#374151;">Nothing on the rerun calendar this week.</td>
        </tr>`
    return { subject, html: shell(rangeLabel, baseUrl, body) }
  }

  const subject = `Rerun digest · week of ${weekLabel} — ${overdue.length} overdue, ${fielding.length} fielding, ${delivering.length} delivering`

  const body = [
    section('Overdue / needs action', '#b91c1c', '#fef2f2', overdue),
    section('Fielding this week', TEAL, '#eaf4fa', fielding),
    section('Delivering this week', '#047857', '#ecfdf5', delivering),
    section('Next week preview', '#6b7280', '#f3f4f6', upcoming),
  ].join('')

  return { subject, html: shell(rangeLabel, baseUrl, body) }
}
