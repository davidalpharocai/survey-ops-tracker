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

/**
 * Who may read a bullet.
 *
 * DEFAULT-DENY, and that is the whole design: an entry with no `audience` is
 * internal-only. Tagging is an act of disclosure, so forgetting to tag hides a
 * bullet rather than leaking one — the failure mode has to be the safe one,
 * because the person adding a line at the end of a Friday is not thinking about
 * the sales tier.
 *
 * Why this exists at all: the sales portal gets a What's-new page, and this file
 * already contained our spend figures ("understating what we actually spend by
 * about $4,500", "had in fact used 85% of its budget"), what the client pays and
 * the resulting margin, the names of who holds the finance role, a disclosed past
 * vulnerability, and — flatly — that an internal target exists distinct from the
 * client-facing one, which is the single fact David asked to keep from sales.
 * Shipping the page without this would have handed all of it over.
 *
 * 'all' means a salesperson may read it. Ask of every bullet: would I be relaxed
 * if this were forwarded to the client? Anything about money we spend, what we
 * charge, margin, internal targets, who can see what, or a past security gap is
 * NOT 'all'.
 */
export type ChangeAudience = 'all' | 'internal'

export interface ChangeItem {
  kind: ChangeKind
  text: string
  /** Omit for internal-only. Only `audience: 'all'` reaches the sales portal. */
  audience?: ChangeAudience
}

export interface ChangelogEntry {
  /** ISO date (YYYY-MM-DD) the change reached the live site. */
  date: string
  changes: ChangeItem[]
}

/**
 * The changelog as a given reader may see it.
 *
 * Filters the bullets, then drops any date whose bullets all filtered out — a
 * date heading with nothing under it reads as a bug, and a run of them tells a
 * salesperson exactly how much they are not being shown, which is its own kind
 * of disclosure.
 */
export function changelogFor(audience: ChangeAudience): ChangelogEntry[] {
  if (audience === 'internal') return CHANGELOG
  return CHANGELOG
    .map(e => ({ ...e, changes: e.changes.filter(c => c.audience === 'all') }))
    .filter(e => e.changes.length > 0)
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-09-24',
    changes: [
      {
        kind: 'FIXED',
        audience: 'all',
        text: 'Signing out on one device signed you out on every device, so signing out on a phone meant a fresh sign-in link on the laptop too. Sign out now ends only the session on the device you press it on.',
      },
      {
        kind: 'FIXED',
        audience: 'all',
        text: 'Opening the sign-in page while already signed in showed the "Email me a sign-in link" form, as if you had been signed out. It now takes you straight in, so a bookmark to the sign-in page no longer costs you a new link each visit.',
      },
      {
        kind: 'NEW',
        text: "A salesperson can be set up to work another salesperson's book: their own login, exactly that person's accounts and surveys, with the header saying whose book it is. John Farrall is set up this way on Alex Pinsky's book, ready for Monday.",
      },
    ],
  },
  {
    date: '2026-09-23',
    changes: [
      {
        kind: 'FIXED',
        audience: 'all',
        text: 'A survey whose response count has never been entered showed 0 and an amber 0% in the survey list and its export, which reads as a result. It now says not recorded, and a real zero still shows as zero.',
      },
      {
        kind: 'FIXED',
        audience: 'all',
        text: 'The survey list\'s Collected column showed the raw count against target, so a study that gathered 404 against a 250 target read 162% in green while the home page and the survey page said about 101%. All three now use the same estimate of what will be delivered, marked with ~ and \'est.\' when it is one; a survey still in field shows what it has so far, unmarked.',
      },
      {
        kind: 'FIXED',
        audience: 'all',
        text: 'Exporting the survey list with an account selected produced an empty PDF headed with a database key where the account\'s name belonged, and selecting the Delivered stage chip silently dropped those rows from the export. The export now applies exactly the filters the screen does and prints the account\'s name.',
      },
      {
        kind: 'FIXED',
        audience: 'all',
        text: 'An account\'s credit balance changed when you changed the date range: the surveys counted moved with the range but the allowance did not, so an account 35 credits over its contract read as 46 remaining once you looked at this quarter. The balance now always describes the current contract, and a range gets its own line saying how many credits the listed surveys drew. The account PDF had the same fault and the same fix.',
      },
      {
        kind: 'FIXED',
        text: 'Insights, the client and contact pages and the morning Slack digest counted work due today as overdue; the survey list and the board did not, so the Insights tile said 5 and the list it opened said 3. Everything now agrees: overdue means the due date has passed.',
      },
      {
        kind: 'NEW',
        audience: 'all',
        text: 'Search everything at once. Type in the search box and press Enter without picking anything from the list, and you land on a results page grouped by what was found — surveys, accounts, contacts, contracts, files — each with its own count, so you can narrow to the kind of thing you meant.',
      },
      {
        kind: 'IMPROVED',
        audience: 'all',
        text: 'The search list that drops down as you type shows about twice as many results, and now says how many more it is holding back. A short list used to read as the whole answer.',
      },
      {
        kind: 'FIXED',
        audience: 'all',
        text: 'Pressing Enter in the search box used to open whichever result happened to sort first, even though you had not chosen it. It now searches everything; use the arrow keys to pick a result instead.',
      },
      {
        kind: 'FIXED',
        audience: 'all',
        text: 'Searching for a contact and clicking the result took you to their account rather than to them.',
      },
      {
        kind: 'NEW',
        audience: 'all',
        text: 'The Accounts page can be searched, its header stays put as you scroll, and every number on it is a link through to the surveys behind it. Credits are broken out as used this term, remaining, and used all time, and you can add, remove and reorder the columns and save the layout you like.',
      },
      {
        kind: 'NEW',
        audience: 'all',
        text: 'Contacts can be searched by name, email, title or account and filtered to one account, and clicking anywhere in a row opens that person — who now has a page of their own listing what they have asked for.',
      },
      {
        kind: 'NEW',
        audience: 'all',
        text: 'The sales home page can search every survey on your book, not only the ones showing on the cards.',
      },
      {
        kind: 'NEW',
        audience: 'all',
        text: 'A survey now names the captain who ran it, and once it has been delivered it lists the files attached to it.',
      },
      {
        kind: 'IMPROVED',
        audience: 'all',
        text: 'Survey pages use the same words as the rest of the tracker — N Target, N Collected and N Actual — and N Collected now says when it was last updated.',
      },
      {
        kind: 'IMPROVED',
        audience: 'all',
        text: 'The navigation bar stays frozen at the top of the sales pages as you scroll, so the tabs and the search box stay reachable on long lists.',
      },
      {
        kind: 'FIXED',
        audience: 'all',
        text: 'A survey still in field could show an anticipated delivered N BELOW the number it had already collected — one survey read 7 collected with 6 anticipated directly underneath. The estimate that produced it was measured on surveys that FINISHED short of target, and it was being applied to surveys that had not finished at all. A survey still collecting now shows what it has collected so far and says no figure is projected yet. 29 surveys were affected; the largest had gathered 1,588 of an 1,800 target and was being shown as 1,426.',
      },
      {
        kind: 'IMPROVED',
        audience: 'all',
        text: 'Sales pages now bring themselves up to date when you come back to the tab, and once a minute while you are looking at them. The bar at the top says what time the page last read the database, so a screen left open can no longer look current when it is not.',
      },
      {
        kind: 'FIXED',
        audience: 'all',
        text: 'Delivered surveys were labelled Closed or Archived nearly everywhere they appeared, because a delivered survey is also closed. They say Delivered now.',
      },
      {
        kind: 'FIXED',
        audience: 'all',
        text: 'The Delivered count on the Accounts page showed a dash on most accounts instead of the real number.',
      },
      {
        kind: 'FIXED',
        // Credits are public to sales; the dollar value of one is not, and is
        // not mentioned here.
        audience: 'all',
        text: 'Credits used counted every survey that had been priced, including work not yet in field, so an account could look as though it had drawn down far more than it had. It now counts only what has actually been drawn, and shows work that is committed but not yet drawn separately.',
      },
      {
        kind: 'FIXED',
        audience: 'all',
        text: 'A credits column could read as a bare zero on an account where nothing had been priced yet. Nothing recorded and none used are different things, and it now shows a dash for the first.',
      },
      {
        kind: 'NEW',
        text: 'You can attach a file to a survey, not only paste a link to one. Use the paperclip beside the box in Linked Documents. Attached files are stored inside the tracker and stay internal to the team — they are not filed to the client and do not appear in the sales view.',
      },
      {
        kind: 'FIXED',
        text: 'Adding a contract on a client page had never once worked. The database refused every write, and the form cleared itself as though it had saved, so it looked like nothing happened. Adding, editing and removing all work now, and a save that fails keeps what you typed on screen instead of throwing it away.',
      },
      {
        kind: 'IMPROVED',
        text: 'N Collected on a project now carries the date and time it was last changed, under the number. The sales view has shown this for a while; the side where the figure is actually edited did not.',
      },
      {
        kind: 'FIXED',
        text: 'Delete forever in the admin trash never deleted anything and reported success anyway. It has been removed: a deleted project stays in the trash and stays restorable, which is what was really happening all along.',
      },
    ],
  },
  {
    date: '2026-09-22',
    changes: [
      {
        kind: 'NEW',
        // Not 'all': it is what we spend on incentives.
        text: 'Recovered incentives can be recorded. When a reward we sent goes unclaimed and the money comes back to us, it now shows on the survey as a credit against what the blasts cost — so the spend reflects what we actually paid out rather than what we issued. 41 surveys have had $27,242.70 of 2026 recoveries booked this way.',
      },
      {
        kind: 'IMPROVED',
        text: 'Ask Claude to add a cost line and it can now record a credit as well as a charge. Say what it was for in the description — a bare minus sign is unreadable a month later.',
      },
    ],
  },
  {
    date: '2026-09-18',
    changes: [
      {
        kind: 'NEW',
        // Not 'all': cost per respondent, and what a route costs us.
        text: 'A survey fielded both by blast and by PureSpectrum can now say how many of its delivered respondents came from each. Ask Claude to record it, and the finance page starts pricing the two routes separately instead of leaving the survey out. The Amex study is the case in point: 236 of its 252 respondents came from PureSpectrum and 16 from the blasts, which works out at $8.84 a delivered respondent on one side and $714.25 on the other — a blended figure of $53.62 describes neither.',
      },
      {
        kind: 'NEW',
        text: 'A flat cost line can say which route it bought for. It matters on a survey that used both: the Amex study’s $8,697.85 contact list was bought purely to blast — the 124,255 contacts are exactly the 124,255 messages sent — so charging any of it to the panel side would understate what a blast respondent costs by four times.',
      },
      {
        kind: 'FIXED',
        text: 'Surveys fielded both ways were missing from cost per respondent and cost per complete altogether — seven of them, carrying $32,879 of spend and 2,554 delivered respondents, about an eighth of all recorded delivered spend. They now appear as one entry per route. Where a survey still can’t be split, the page says so and says what is missing, rather than quietly leaving it out.',
      },
      {
        kind: 'IMPROVED',
        text: 'Asking Claude to reconcile a survey now checks the route split adds up to the delivered N, and flags a cost line on a both-ways survey that doesn’t say which route it bought.',
      },
    ],
  },
  {
    date: '2026-09-17',
    changes: [
      {
        kind: 'NEW',
        // Not 'all': it is about spend we failed to record.
        text: 'A survey’s N is now checked against the blasts and PureSpectrum launches that produced it. People only reach us those two ways, so if a survey says it collected 1,000 and its launches and blasts only account for 400, something was never logged — and whatever it cost is missing from the survey’s spend. Ask Claude to “reconcile PR00123”, or “what’s our data health” for the whole book.',
      },
      {
        kind: 'NEW',
        text: 'Related: asking for data health across all surveys (not just active ones) now gives you the backfill list — every survey carrying an N with nothing on record to say how it was fielded. There are 150 of them, all reporting no fielding spend at all.',
      },
    ],
  },
  {
    date: '2026-09-15',
    changes: [
      {
        kind: 'FIXED',
        // Not 'all': it is about what we spend.
        text: 'Ask Claude to log an email blast and it can now say so. Before this it had no way to record that a blast went out by email, so the blast was charged for its sends like an SMS — on a 12,000-person email that is $240 of spend that never happened. You can also correct a blast that was logged that way.',
      },
      {
        kind: 'NEW',
        text: 'Claude can put a note on an N segment when it creates one — the quota it came from, the sub-audience, whatever would otherwise end up buried in the project comments — and edit that note later.',
      },
    ],
  },
  {
    date: '2026-09-09',
    changes: [
      {
        kind: 'NEW',
        audience: 'all',
        text: 'Your own workspace. Surveys, Accounts, Contacts and What’s new across the top, with search on every list, sortable columns and a column picker you can set to whatever you actually use.',
      },
      {
        kind: 'NEW',
        audience: 'all',
        text: 'Account pages. Every account you own has a page with its contacts, its surveys and its credit position, and you can export it as a PDF to send on.',
      },
      {
        kind: 'IMPROVED',
        audience: 'all',
        text: 'Clicking a survey opens it. Previously it bounced you back to the list.',
      },
    ],
  },
  {
    date: '2026-09-01',
    changes: [
      {
        kind: 'NEW',
        text: 'A blast now records what it cost to SEND, not just what we paid respondents. Every blast has a $/send rate (currently 2 cents, editable per blast) and the cost of the sends is added to the project’s spend alongside the rewards. Each blast shows the two halves separately, and the blast list shows the totals.',
      },
      {
        kind: 'FIXED',
        text: 'Blast spend was understating what we actually spend by about $4,500 across all projects, because the cost of sending was never recorded anywhere. Some projects will now show a much higher spend than yesterday — that is the real number arriving, not a new charge. The clearest case is a study that read $0 spent and had in fact used 85% of its budget, entirely on sends.',
      },
      {
        kind: 'IMPROVED',
        text: 'Money figures the app works out for you now carry a small “=” next to them, and hovering it shows the formula. Anything without one is a field you type in.',
      },
    ],
  },
  {
    date: '2026-08-31',
    changes: [
      {
        kind: 'NEW',
        text: '"Audience Size" is now two numbers: Total Available Audience Size (the contacts the team handed us) and Audience Size Used (how many we have actually sent to). Underneath them the project shows how many contacts are still available — the number that decides whether to send again or ask the team for more.',
      },
      {
        kind: 'FIXED',
        text: 'The old "Audience Size" tooltip described the wrong thing — the size of the whole market rather than the list we were given — so the box had been collecting both meanings. A handful of projects hold a number that is smaller than the responses they collected, which is impossible for a contact list; those now show up in the data-health check instead of sitting there unnoticed.',
      },
      {
        kind: 'IMPROVED',
        text: 'Claude can now set a segment’s audience and audience size. Until now it could give a segment a target but had no way to say who that target was for.',
      },
    ],
  },
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
        audience: 'all',
        // Reworded when this was tagged for sales: the original listed the
        // board, the calendar and the analyst client pages, none of which the
        // sales tier can open. The improvement itself is real for them.
        text: 'Survey names, accounts and contacts are real links everywhere. Right-click to open in a new tab, middle-click, or Cmd/Ctrl-click all work now.',
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
        audience: 'all',
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
        audience: 'all',
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
