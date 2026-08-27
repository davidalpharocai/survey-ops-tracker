// The canonical salesperson list, and the name → account mapping that lets a
// signed-in salesperson be matched to their own projects.
//
// WHY THIS IS A NAME AND NOT A FOREIGN KEY
//
// survey_projects.salesperson is free text, and the obvious "fix" is a foreign
// key to profiles. It does not work: the two people who carry 87% of the rows —
// Alex (160 projects) and Jenna (54) — have never signed in, so they have no
// profile to point at, and a FK would backfill almost nothing. Nor to
// team_members: that roster is who can be a project CAPTAIN, and none of the
// three salespeople are on it.
//
// The text was also never the mess it looked like. The dropdown has always been
// driven by this list, and only 5 rows out of 245 had drifted off it (a bare
// "Jenna", "Vineet", and two "Shanu"). Those were normalised on 2026-08-27, so
// every live project now holds exactly one of the values below.
//
// So the identity is the NAME, and the mapping to an account is a lookup here
// rather than a column. That keeps one source of truth — the lesson from
// series_id / rerun_series_id, where a second column for the same idea drifted
// from the first and cost a day. When Alex and Jenna do sign in, scoping works
// immediately: their profile email resolves through EMAIL_BY_SALESPERSON to the
// name already on 214 projects, with nothing to backfill.

/** Everyone who can be set as the sales lead on a new project.
 *  "Internal" marks a project with no external sales lead. */
export const SALESPEOPLE = [
  'Alex Pinsky',
  'Jenna Shrove',
  'Vineet Kapur',
  'Shanu Aggarwal',
  'Internal',
] as const

/** No longer with AlphaROC. Kept so their historical projects still render and
 *  still resolve for scoping, but NOT offered when setting a new project's sales
 *  lead — the same "(former employee)" idea the team roster uses, expressed as a
 *  separate list because these names are stored as plain text. */
export const FORMER_SALESPEOPLE = ['Steven Stubbs'] as const

/** Every name that is a legitimate value in survey_projects.salesperson. */
export const ALL_SALESPERSON_VALUES: readonly string[] = [
  ...SALESPEOPLE,
  ...FORMER_SALESPEOPLE,
]

/** Canonical name → the AlphaROC account that person signs in with.
 *
 *  This is what a scoped view keys off: given the signed-in profile's email,
 *  salespersonForEmail() gives the name to filter `salesperson` by. "Internal"
 *  is deliberately absent — it is a category, not a person, and nobody signs in
 *  as it. Alex and Jenna are pre-registered in profile_provisioning at the
 *  `sales` tier but have no account yet; the mapping is correct in advance so
 *  nothing needs changing on the day they first sign in. */
export const EMAIL_BY_SALESPERSON: Readonly<Record<string, string>> = {
  'Alex Pinsky': 'alex@alpharoc.ai',
  'Jenna Shrove': 'jenna@alpharoc.ai',
  'Vineet Kapur': 'vineet@alpharoc.ai',
  'Shanu Aggarwal': 'shanu@alpharoc.ai',
  'Steven Stubbs': 'steven@alpharoc.ai',
}

const SALESPERSON_BY_EMAIL: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(EMAIL_BY_SALESPERSON).map(([name, email]) => [email.toLowerCase(), name])
)

/** The canonical salesperson name for a signed-in account, or null if that
 *  person is not a salesperson. Null is the important case: it means "do not
 *  scope by salesperson", not "show nothing" — an analyst is not a salesperson
 *  and must keep seeing everything. */
export function salespersonForEmail(email: string | null | undefined): string | null {
  if (!email) return null
  return SALESPERSON_BY_EMAIL[email.trim().toLowerCase()] ?? null
}

/** True when the value is one this app recognises. Anything else is drift — the
 *  data-health check reports it rather than silently excluding those projects
 *  from a scoped view, which is how a salesperson would end up unable to see
 *  their own work with no error to explain it. */
export function isKnownSalesperson(value: string | null | undefined): boolean {
  return !!value && ALL_SALESPERSON_VALUES.includes(value)
}

/** Dropdown options: the current people, plus the existing value when it is a
 *  former salesperson or legacy text — so editing an old project never silently
 *  reassigns it just by opening the picker. */
export function salespersonOptions(current: string | null | undefined): string[] {
  const list: string[] = [...SALESPEOPLE]
  if (current && !list.includes(current)) list.unshift(current)
  return list
}
