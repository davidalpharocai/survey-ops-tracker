// Pure formatting for the per-owner rerun nudge email. Kept DB/network-free so
// it's cheaply unit-testable; the cron (app/api/cron/rerun-nudges) wires these
// to the rerun_status query + sendAndLog. Overdue items lead, then due-soon.

const APP_URL = 'https://survey-ops-tracker.vercel.app'

export interface NudgeItem {
  title: string // e.g. "Holocene — Monthly PS"
  due: string | null // YYYY-MM-DD (effective_due)
  daysToDue: number | null // negative = overdue by N, positive = due in N
}

export interface RerunNudge {
  subject: string
  html: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fmtDue(d: string | null): string {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function whenLabel(it: NudgeItem, overdue: boolean): string {
  const n = it.daysToDue
  if (overdue) {
    if (n == null) return `overdue (was ${fmtDue(it.due)})`
    const days = Math.abs(n)
    return days <= 0 ? `due today (${fmtDue(it.due)})` : `${days}d overdue (was ${fmtDue(it.due)})`
  }
  if (n == null) return `due ${fmtDue(it.due)}`
  if (n <= 0) return `due today (${fmtDue(it.due)})`
  return n === 1 ? `due tomorrow (${fmtDue(it.due)})` : `due in ${n}d (${fmtDue(it.due)})`
}

function li(it: NudgeItem, overdue: boolean): string {
  return `<li>${escapeHtml(it.title)} — ${whenLabel(it, overdue)}</li>`
}

/**
 * Build the subject + HTML body for one owner's nudge. `overdue` items are the
 * chase list (past due), `prep` items are the heads-up list (due within lead).
 * Backup owner (if any) is named in the footer — the accountability contact.
 */
export function buildRerunNudge(
  owner: string,
  overdue: NudgeItem[],
  prep: NudgeItem[],
  backup?: string | null
): RerunNudge {
  const parts: string[] = []
  if (overdue.length) {
    parts.push(
      `<p><strong>${overdue.length} rerun${overdue.length === 1 ? '' : 's'} overdue</strong> — please collect or update status:</p>`,
      `<ul>${overdue.map((it) => li(it, true)).join('')}</ul>`
    )
  }
  if (prep.length) {
    parts.push(
      `<p><strong>${prep.length} rerun${prep.length === 1 ? '' : 's'} coming up</strong> — time to prep:</p>`,
      `<ul>${prep.map((it) => li(it, false)).join('')}</ul>`
    )
  }
  parts.push(`<p><a href="${APP_URL}/reruns">Open the Rerun Radar</a> to log a wave or adjust cadence.</p>`)
  if (backup) {
    parts.push(`<p style="color:#666;font-size:12px;">Backup owner: ${escapeHtml(backup)}.</p>`)
  }
  parts.push(
    `<p style="color:#666;font-size:12px;">You're the owner of these reruns in the Survey Ops Command Center.</p>`
  )

  // Subject leads with the more urgent count.
  const bits: string[] = []
  if (overdue.length) bits.push(`${overdue.length} overdue`)
  if (prep.length) bits.push(`${prep.length} due soon`)
  return {
    subject: `Rerun nudge — ${bits.join(', ')}`,
    html: parts.join('\n'),
  }
}
