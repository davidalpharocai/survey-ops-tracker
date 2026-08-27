// What's new — the changelog the team actually reads.
//
// HOW TO ADD TO THIS FILE (the only rule that matters)
//
// Write for a colleague, not for an engineer. The commit is the SOURCE; the
// bullet is a rewrite. No file paths, no migration numbers, no table names, no
// jargon. If a bullet needs a glossary, it is not finished.
//
//   ✗ "fix(fields): project-type select saves on the first pick"
//   ✓ "Changing a project's type now saves on the first click instead of
//      needing a second one."
//
// One line per change, past tense, and say what it means for the reader rather
// than what moved in the code. Anything invisible to a user — a refactor, a type
// fix, a re-triggered deploy — does not belong here at all. An empty section is
// better than a padded one.
//
// Categories, borrowed from Claude Code's own release notes so the shape is
// familiar: NEW for something that did not exist, IMPROVED for something that
// got better or cheaper, FIXED for something that was broken.
//
// Data-as-code rather than a parsed markdown file, for one reason: this
// typechecks. A malformed entry is a build error, not a page that renders wrong
// in production. Newest date FIRST — the page does not sort, so the order here
// is the order on screen.

export type ChangeKind = 'NEW' | 'IMPROVED' | 'FIXED'

export interface ChangelogEntry {
  /** ISO date (YYYY-MM-DD) the change reached the live site. */
  date: string
  changes: { kind: ChangeKind; text: string }[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-08-27',
    changes: [
      {
        kind: 'NEW',
        text: 'Roles. Access is now granted by role — "finance" sees client pricing and margin, "admin" can grant roles to other people — and Admin has an Access panel showing who holds what. Every change is logged with who did it and when.',
      },
      {
        kind: 'NEW',
        text: 'Each N segment can carry its own note, so "why is the Sellers N only 500" lives on the segment it explains instead of in the project notes.',
      },
      {
        kind: 'IMPROVED',
        text: 'Client pricing and margin are now protected by the database itself, not just hidden by the screen. Before this, anyone signed in could have read them directly.',
      },
      {
        kind: 'IMPROVED',
        text: 'Project names, clients and contacts are real links everywhere. Right-click to open in a new tab, middle-click, or Cmd/Ctrl-click all work now — on the board, the list, the calendar, and the client and contact pages.',
      },
      {
        kind: 'IMPROVED',
        text: 'The Context tab writes short bullets instead of a paragraph, and is better at picking out which companies and topics a study is actually about.',
      },
    ],
  },
  {
    date: '2026-08-26',
    changes: [
      {
        kind: 'IMPROVED',
        text: 'The Context tab refreshes every three days instead of daily. Same information, about a third of the running cost.',
      },
    ],
  },
  {
    date: '2026-08-25',
    changes: [
      {
        kind: 'NEW',
        text: 'Context tab on every project — a one-minute summary of why a study exists and what has moved since, with links to the sources it came from.',
      },
      {
        kind: 'NEW',
        text: 'Client pricing: what the client pays per completed N, the resulting contract value, and margin against what we spend. Visible to David, Shanu and Vineet only.',
      },
      {
        kind: 'FIXED',
        text: 'The gen-pop response-count warning now judges the internal target rather than the client-facing one, so correctly set-up studies stop being flagged. It applies to all general-population studies, not just one person’s.',
      },
    ],
  },
  {
    date: '2026-08-24',
    changes: [
      {
        kind: 'NEW',
        text: 'N target can be a range — a minimum and a maximum — instead of a single number, per segment, rolling up to the project.',
      },
      {
        kind: 'NEW',
        text: 'Contacts have their own pages now. Click a contact anywhere to see every survey that contact requested, the same way client pages work.',
      },
      {
        kind: 'NEW',
        text: 'The board can sort by delivery date, soonest first.',
      },
      {
        kind: 'NEW',
        text: 'Two flat cost lines on projects: SMS/Email Blast, and Contacts Export (ZoomInfo, Apollo and the like).',
      },
      {
        kind: 'FIXED',
        text: 'Changing a project’s type saves on the first click. It used to need a second one.',
      },
      {
        kind: 'IMPROVED',
        text: 'Retired the Terminations and Voter Survey QA tags from the screen. Past values are kept in case they are ever needed again.',
      },
    ],
  },
  {
    date: '2026-08-17',
    changes: [
      {
        kind: 'NEW',
        text: 'Cut-off values — survey IDs especially — can be read in full on hover and copied with one click.',
      },
      {
        kind: 'NEW',
        text: 'Client pages show average spend against budget.',
      },
      {
        kind: 'NEW',
        text: 'PureSpectrum launches can carry a freeform note, matching blasts and rerun series.',
      },
    ],
  },
  {
    date: '2026-08-13',
    changes: [
      {
        kind: 'IMPROVED',
        text: 'The board’s Delivery column is gone, replaced by a "Delivered in the last X" filter — the column was only ever growing.',
      },
    ],
  },
  {
    date: '2026-08-12',
    changes: [
      { kind: 'NEW', text: 'Reruns can be filtered by client, salesperson and next-due date.' },
      { kind: 'IMPROVED', text: 'B2B blasts are editable, the same as launches.' },
    ],
  },
  {
    date: '2026-08-11',
    changes: [
      {
        kind: 'NEW',
        text: 'Rerun series are first-class records: a month view, a list, and a per-series view, with configurable and reorderable columns.',
      },
      {
        kind: 'NEW',
        text: 'Ribbon tabs can be dragged into whatever order you like, and your browser remembers it.',
      },
      { kind: 'IMPROVED', text: 'Reruns moved to the front of the ribbon.' },
    ],
  },
  {
    date: '2026-08-10',
    changes: [
      {
        kind: 'NEW',
        text: 'A Salesperson filter on the board and list, and captains show their full names.',
      },
    ],
  },
  {
    date: '2026-08-06',
    changes: [
      {
        kind: 'NEW',
        text: 'The in-app User Guide is illustrated — step-by-step screenshots for creating a project, the project page, Insights, the Actions menu and the Assistant.',
      },
    ],
  },
]

/** The most recent date in the log, as the "have I seen this" marker. Compared
 *  against a date the browser remembers per person, so a new entry can put a dot
 *  on the nav without anything being stored server-side. */
export const LATEST_CHANGE_DATE = CHANGELOG[0]?.date ?? ''
