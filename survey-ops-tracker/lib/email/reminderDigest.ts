// Pure grouping/formatting helpers for the reminders-due cron. Kept free of
// any DB/network calls so they're cheaply unit-testable; the route wires
// these to the actual reminders query + sendAndLog.

export type ReminderRow = {
  id: string
  user_email: string
  text: string
  due_date: string // YYYY-MM-DD
  survey_projects: { project_code: string | null; project_name: string } | null
}

export type UserDigest = {
  userEmail: string
  ids: string[]
  subject: string
  html: string
}

function fmtDue(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Group reminders by user_email, each user's list ordered overdue-first (due_date ascending). */
export function groupByUser(rows: ReminderRow[]): Map<string, ReminderRow[]> {
  const groups = new Map<string, ReminderRow[]>()
  for (const row of rows) {
    const list = groups.get(row.user_email)
    if (list) list.push(row)
    else groups.set(row.user_email, [row])
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.due_date.localeCompare(b.due_date))
  }
  return groups
}

/** Build the subject + HTML body for one user's digest email. */
export function buildDigest(userEmail: string, rows: ReminderRow[]): UserDigest {
  const lines = rows.map(r => {
    // Project fields are HTML-escaped like the reminder text; project_code can be
    // null for projects that haven't been assigned a PR-code yet.
    const project = r.survey_projects
      ? ` — <a href="https://survey-ops-tracker.vercel.app">${r.survey_projects.project_code ? escapeHtml(r.survey_projects.project_code) + ' ' : ''}${escapeHtml(r.survey_projects.project_name)}</a>`
      : ''
    return `<li>${escapeHtml(r.text)} — due ${fmtDue(r.due_date)}${project}</li>`
  })
  const html = [
    `<p>You have ${rows.length} reminder${rows.length === 1 ? '' : 's'} due:</p>`,
    `<ul>${lines.join('')}</ul>`,
    `<p style="color:#666;font-size:12px;">Reminders are managed via your connected Claude (Survey Ops connector).</p>`,
  ].join('\n')
  return {
    userEmail,
    ids: rows.map(r => r.id),
    subject: `Survey Ops reminders — ${rows.length} due`,
    html,
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
