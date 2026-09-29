/**
 * WHAT PRINTS on the two client documents — the Study Activity Statement and
 * the Study List — and where that choice comes from.
 *
 * David's decision of 2026-09-27, which replaced the fixed columns of the first
 * build (build notes 3G):
 *
 *   "one will be able to deselect attributes that are included, otherwise
 *    everything is default ... but one can save their preset as their new
 *    default and can always revert back to system default."
 *
 * So the model was DESELECTION: a choice recorded only what was turned OFF,
 * which is what makes a column added later print for someone whose saved
 * default is older than it — they never turned it off, so it is on.
 *
 * ── AND WHY IT IS NOW BOTH, 2026-09-29 ──────────────────────────────────────
 * That model's one soft spot was named here the day it shipped: a list of what
 * is OFF cannot record that somebody wants an off-by-default column ON. David
 * then asked for exactly that — "default should NOT include but have the
 * option to add" — so a choice now carries two lists. `colsOff` governs the
 * ordinary columns and means what it always did; `colsOn` governs the few
 * marked `defaultOff` and means the mirror of it. Every column belongs to
 * exactly one of them, neither list has to be exhaustive, and the property
 * that made the first model worth having survives in both directions: silence
 * about a column always means "leave it at its default", so a column added
 * after somebody saved their default lands where it was designed to land.
 *
 * ALWAYS PRINTED, never offered: the study name and audience. A row without it
 * matches nothing the client holds. (Ref. was here too until David turned it
 * into the first opt-in — ALWAYS_PRINTED says why the argument was only half
 * right.)
 *
 * ONE RULE FOR EVERY FIGURE: a figure prints only while ITS COLUMN prints, and
 * a section only decides whether its panel prints at all. Unticking Target has
 * to take the target out of the summary as well as the table, or the choice is
 * a lie — the summary prints in the largest type on the page. The one panel
 * that keeps a figure of its own is the contract summary: the credits drawn
 * against the allowance are the contract position, not a column total, and it
 * has its own tick (choiceNotes says so when Credits is off and it is on).
 *
 * WHERE A CHOICE COMES FROM, per part (columns and sections separately):
 *
 *   1. The link — `cols=` and `sections=` — so a link reproduces a choice.
 *   2. This person's saved default for THIS document, in this browser.
 *   3. The system default: every column except the ones marked `defaultOff`.
 *
 * The saved default is browser storage, not the database, like the accounts
 * table's saved views: it is a personal starting point, and nothing else reads
 * it. Storage can throw outright (private windows, blocked site data), so every
 * read and write is guarded, and a value that does not parse is ignored rather
 * than half-applied.
 *
 * NOTHING HERE IS A DOLLAR FIGURE. Every column on offer is one the sales tier
 * already sees; choosing columns can hide information, never add any.
 */
import type { DocKind } from './statement'

export type PrintDoc = DocKind

export type PrintColumnId = 'ref' | 'account' | 'requested' | 'status' | 'target' | 'final' | 'estimate' | 'credits'
export type PrintSectionId = 'contract' | 'activity' | 'notes'

export interface PrintColumnDef {
  id: PrintColumnId
  label: string
  /** The (i) text beside the checkbox. */
  help: string
  /** Which documents carry the column at all. */
  docs: PrintDoc[]
  /** Under the "Responses" spanner. */
  response?: boolean
  /** Only on a list that spans accounts (internal mode). */
  internalOnly?: boolean
  /**
   * OFF until somebody ticks it, rather than on until somebody unticks it.
   *
   * This is the axis the first build did not have (see the header): a choice
   * that records only what is OFF cannot record that you want an off-by-default
   * thing ON. `colsOn` is that record, and this flag is what decides which of
   * the two lists an id belongs in. Everything without it keeps the original
   * behaviour exactly — a column added later prints for a reader whose saved
   * default predates it, because they never turned it off.
   */
  defaultOff?: true
  /**
   * NOT A COLUMN: a tick that changes what an existing column prints in a
   * cell. `estimate` is the only one — it decides whether a study still in
   * quality review shows the projection or a dash, inside the Final column —
   * and ledgerColumns leaves it out so the table never tries to draw it.
   */
  cellOnly?: true
}

export interface PrintSectionDef {
  id: PrintSectionId
  label: string
  help: Record<PrintDoc, string>
  docs: PrintDoc[]
}

/** The ledger's optional columns, in the order they print. */
export const PRINT_COLUMNS: PrintColumnDef[] = [
  {
    id: 'ref', label: 'Ref. (PR number)', docs: ['statement', 'list'], defaultOff: true,
    help: 'Our project number for each study (PR00494 and the like). It is an internal code — the client has nothing to match it against unless we have quoted it to them — so it is off unless you tick it. The study name and audience always print.',
  },
  {
    id: 'account', label: 'Account', docs: ['list'], internalOnly: true,
    help: 'Which account each study belongs to. Offered only on a list that covers more than one account, which prints marked Internal.',
  },
  {
    id: 'requested', label: 'Requested by', docs: ['statement', 'list'],
    help: 'The person at the client who asked for each study.',
  },
  {
    id: 'status', label: 'Status', docs: ['statement', 'list'],
    help: 'Where each study is (Received, In field, Delivered and so on), its status mark, and the day it was delivered or is due. Untick it and the key to the marks, and the stages counted out in the table’s group headings and the summary, are left off too.',
  },
  {
    id: 'target', label: 'Target', docs: ['statement', 'list'], response: true,
    help: 'The number of responses the client bought, or the range that was sold. Untick it and the summary stops stating the target and the percentage of it too, so the client cannot check the final count against what they bought.',
  },
  {
    id: 'final', label: 'Final', docs: ['statement', 'list'], response: true,
    help: 'Responses delivered after quality review. Only a delivered study has one. Untick it and the summary’s final-responses figure goes with it.',
  },
  {
    id: 'estimate', label: 'Final estimate', docs: ['statement', 'list'], defaultOff: true, cellOnly: true,
    help: 'For a study still in quality review, print a projected final count (“≈ 480 est.”) in the Final column instead of a dash. It is a projection from how past studies of ours finished against target, not a measured figure, so it is off unless you tick it. Needs the Final column.',
  },
  // NO 'collected' COLUMN. It was off by default from 2026-09-28 and removed
  // outright on 2026-09-29 — David: "lets actually remove 'collected' from all
  // views from now … a client doesnt need to know that and i dont want to risk
  // a sales person sending it."
  //
  // DELETED RATHER THAN DEFAULTED OFF, and rather than made an Admin setting,
  // which was the other option he offered. A setting does not remove the risk
  // he named, it relocates the switch and leaves someone able to flip it; the
  // column is the risk, so the column goes. The pre-QA field count is still
  // recorded, still on every internal screen, and still drives the estimate a
  // survey in quality review prints — it simply has no way to reach a client
  // document any more.
  {
    id: 'credits', label: 'Credits', docs: ['statement', 'list'],
    help: 'The credits each study draws, “Not yet priced”, or “committed” for a study priced but not yet in field. The total row adds up the credits drawn, and the summary’s credit figure follows this tick. On a statement the contract summary keeps its own credits-drawn figure until that is unticked too.',
  },
]

export const PRINT_SECTIONS: PrintSectionDef[] = [
  {
    id: 'contract', label: 'Contract summary', docs: ['statement'],
    help: {
      statement: 'The panel with the credits drawn against the contract in force, the balance, and the meter that sets credits drawn against time elapsed.',
      list: '',
    },
  },
  {
    id: 'activity', label: 'Activity summary', docs: ['statement', 'list'],
    help: {
      statement: 'The panel that counts what was delivered and compares final responses with target. Each figure in it follows its own column, so unticking Target or Final takes that figure out of the panel too. It also holds the key to the status marks while the Status column prints.',
      list: 'The strip across the top: how many studies are listed, the final responses against target, and the credits drawn. Each figure follows its own column, so unticking Target, Final or Credits takes it out of the strip too.',
    },
  },
  {
    id: 'notes', label: 'Notes', docs: ['statement', 'list'],
    help: {
      statement: 'The numbered notes that explain “Not yet priced”, what the final count is and what the marks beside it mean, when credits are drawn, and the dates. Untick it and the small note numbers that point to them are left off too. The sign-off still prints.',
      list: 'The numbered notes that explain “Not yet priced”, what the final count is and what the marks beside it mean, what the list is, and the dates. Untick it and the small note numbers that point to them are left off too. The sign-off still prints.',
    },
  },
]

/**
 * Printed on every row, whatever is ticked.
 *
 * Ref. WAS ONE OF THESE UNTIL 2026-09-29. The argument for it — "a row without
 * them matches nothing the client holds" — was half right: the client matches
 * a row by the study's NAME, which they commissioned and which still always
 * prints. PR00494 is our number, and David asked for it off by default with a
 * tick to put it back (it is the first thing `defaultOff` was built for).
 */
export const ALWAYS_PRINTED = ['Study and audience'] as const

/**
 * What was turned OFF, and what was turned ON.
 *
 * `colsOff` is the original model and still carries every ordinary column:
 * absence means it prints. `colsOn` is its mirror for the handful of columns
 * marked `defaultOff`, where absence means it does NOT print — so between them
 * the two lists say the same thing about every column, and neither has to be
 * exhaustive. A column that moves from one default to the other moves between
 * these lists, and old saved choices stay readable because an id in the list
 * that no longer governs it is simply not consulted.
 */
export interface PrintChoice {
  colsOff: PrintColumnId[]
  colsOn: PrintColumnId[]
  sectionsOff: PrintSectionId[]
}

/**
 * What prints when nobody has chosen anything: every column's own default.
 *
 * ── WHY THIS IS EMPTY AGAIN ─────────────────────────────────────────────────
 * It held ['collected'] for one day. David, 2026-09-28: “for surveys in sales
 * view … remove “Collected” and only keep the Final (ie Delivered) and Target”,
 * then “yes update the PDF too” — so the column went off by default. On
 * 2026-09-29 he closed the gap: “lets actually remove ‘collected’ from all
 * views from now … i dont want to risk a sales person sending it.” A column
 * that is off by default is still a column a hurried person can tick, so it is
 * gone from PRINT_COLUMNS entirely and there is nothing left to default off.
 *
 * ── AND WHY BOTH LISTS ARE EMPTY, 2026-09-29 ───────────────────────────────
 * Empty no longer means "everything prints". It means "nothing differs from
 * the defaults", and the defaults now live on the column definitions
 * themselves (`defaultOff`), which is the only place that can state them once
 * for the picker, the link, the saved value and the page at the same time.
 * Reading a default off a list of exceptions was what made the Collected
 * episode above cost a storage key.
 *
 * THIS IS THE ONE PLACE THE DEFAULT LIVES. resolveChoice falls back to these
 * lists, not to empty ones. That mattered when the default was non-empty and
 * it still matters: keeping the fallback pointed here is what stops a second,
 * invisible copy of “everything prints” growing back inside resolveChoice.
 */
export const SYSTEM_DEFAULT: PrintChoice = Object.freeze({
  colsOff: [],
  colsOn: [],
  sectionsOff: [],
}) as PrintChoice

/** The ids whose default is OFF — the ones `colsOn` governs instead of
 *  `colsOff`. Derived from the defs so the flag is stated in exactly one
 *  place, and taking the defs so a test can supply its own. */
const defaultOffSet = (defs: PrintColumnDef[] = PRINT_COLUMNS) =>
  new Set(defs.filter(d => d.defaultOff).map(d => d.id))

export const columnsFor = (doc: PrintDoc, defs: PrintColumnDef[] = PRINT_COLUMNS) => defs.filter(c => c.docs.includes(doc))
export const sectionsFor = (doc: PrintDoc, defs: PrintSectionDef[] = PRINT_SECTIONS) => defs.filter(s => s.docs.includes(doc))

/** Known ids only, once each, in print order — so two choices that mean the
 *  same thing compare equal and serialise the same. */
function canonicalCols(ids: readonly string[], doc: PrintDoc, defs: PrintColumnDef[] = PRINT_COLUMNS): PrintColumnId[] {
  const want = new Set(ids)
  return columnsFor(doc, defs).map(c => c.id).filter(id => want.has(id))
}
function canonicalSections(ids: readonly string[], doc: PrintDoc, defs: PrintSectionDef[] = PRINT_SECTIONS): PrintSectionId[] {
  const want = new Set(ids)
  return sectionsFor(doc, defs).map(s => s.id).filter(id => want.has(id))
}

export function canonicalChoice(c: PrintChoice, doc: PrintDoc): PrintChoice {
  return {
    colsOff: canonicalCols(c.colsOff, doc),
    colsOn: canonicalCols(c.colsOn ?? [], doc),
    sectionsOff: canonicalSections(c.sectionsOff, doc),
  }
}

export function sameChoice(a: PrintChoice, b: PrintChoice, doc: PrintDoc): boolean {
  const x = canonicalChoice(a, doc), y = canonicalChoice(b, doc)
  return x.colsOff.join() === y.colsOff.join()
    && x.colsOn.join() === y.colsOn.join()
    && x.sectionsOff.join() === y.sectionsOff.join()
}

/** Which list governs this id decides which way the question is asked. */
export function columnOn(c: PrintChoice, id: PrintColumnId, defs: PrintColumnDef[] = PRINT_COLUMNS): boolean {
  return defaultOffSet(defs).has(id) ? (c.colsOn ?? []).includes(id) : !c.colsOff.includes(id)
}
export const sectionOn = (c: PrintChoice, id: PrintSectionId) => !c.sectionsOff.includes(id)

/** Flip one column or section. A `defaultOff` column moves in and out of
 *  `colsOn`; every other one moves in and out of `colsOff`. */
export function toggleColumn(c: PrintChoice, id: PrintColumnId, doc: PrintDoc): PrintChoice {
  const on = columnOn(c, id)
  if (defaultOffSet().has(id)) {
    const next = on ? (c.colsOn ?? []).filter(x => x !== id) : [...(c.colsOn ?? []), id]
    return { ...c, colsOn: canonicalCols(next, doc) }
  }
  const off = on ? [...c.colsOff, id] : c.colsOff.filter(x => x !== id)
  return { ...c, colsOff: canonicalCols(off, doc) }
}
export function toggleSection(c: PrintChoice, id: PrintSectionId, doc: PrintDoc): PrintChoice {
  const off = sectionOn(c, id) ? [...c.sectionsOff, id] : c.sectionsOff.filter(x => x !== id)
  return { ...c, sectionsOff: canonicalSections(off, doc) }
}

// ── The link ───────────────────────────────────────────────────────────────

/**
 * The part of a choice a link carries. A missing part falls through to the
 * saved default, then the system default.
 */
export interface UrlChoice {
  colsOff?: PrintColumnId[]
  colsOn?: PrintColumnId[]
  sectionsOff?: PrintSectionId[]
  /** The link used the retired `cols` values (build notes 3G). */
  legacy?: boolean
}

/**
 * The retired `cols` values: the account screen's column-picker ids, which the
 * first PDF export copied into its link. Mapped as build notes 3G set out, so a
 * bookmarked export still prints what it printed:
 *
 *   requested → Requested by      target  → Target
 *   collected → Final (the old single "Collected" column showed the final count
 *               once a survey was delivered, so Final is what it meant; it
 *               mapped to both until 2026-09-28, and honouring the literal
 *               word now would let a year-old bookmark put a column back on a
 *               client document that the system default keeps off)
 *   credits   → Credits           submitted, and the always-shown code, survey,
 *                                 stage and deliver → nothing to switch
 *
 * Status was always shown then, so it stays on; the Account column did not
 * exist on the statement, so it stays at its default. A value that holds none
 * of these words (a hand-typed "cols=foo") is not a choice and is ignored,
 * rather than turning every column off.
 */
const LEGACY = new Map<string, PrintColumnId[]>([
  ['requested', ['requested']],
  ['target', ['target']],
  ['collected', ['final']],
  ['credits', ['credits']],
  ['submitted', []], ['code', []], ['survey', []], ['stage', []], ['deliver', []], ['client', []],
])
/** The columns the retired links could switch. */
const LEGACY_SWITCHED: PrintColumnId[] = ['requested', 'target', 'final', 'credits']

const first = (v: string | string[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null
const tokens = (v: string) => v.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)

/**
 * `cols=` and `sections=` as a link writes them:
 *
 *   all              the defaults, whatever they are
 *   -target,-final   the defaults, except these two switched off
 *   *ref             the defaults, plus this off-by-default one switched on
 *
 * Written as what DIFFERS from the defaults, like the saved default, so a
 * column added after the link was made still lands on its own default. A
 * prefix on every token is also what tells a current link from a retired one,
 * which listed bare ids meaning "on" — hence `all` rather than an empty value
 * for "I changed nothing", and hence the prefix for opt-ins is `*` and NOT the
 * obvious `+`: a bare `+` in a query string decodes to a SPACE, so `+ref`
 * would arrive here as `ref` and be read as one of those retired bare ids.
 * `*` is in the urlencoded safe set, so it survives a round trip untouched.
 */
export function parseUrlChoice(
  doc: PrintDoc,
  cols: string | string[] | null | undefined,
  sections: string | string[] | null | undefined,
): UrlChoice {
  const out: UrlChoice = {}
  const c = first(cols)
  if (c != null && c.trim() !== '') {
    const t = tokens(c)
    if (t.includes('all') || t.some(x => x.startsWith('-') || x.startsWith('*'))) {
      // A link in the current format states the WHOLE column choice, so both
      // lists are set: `cols=-target` means Target off and no opt-in ticked,
      // not "Target off, and ask my saved default about the opt-ins".
      out.colsOff = canonicalCols(t.filter(x => x.startsWith('-')).map(x => x.slice(1)), doc)
      out.colsOn = canonicalCols(t.filter(x => x.startsWith('*')).map(x => x.slice(1)), doc)
    } else if (t.some(x => LEGACY.has(x))) {
      // colsOn is deliberately left unset. A retired link predates every
      // off-by-default column, so it has nothing to say about them — the same
      // reason it leaves Account and Status at their defaults above.
      const on = new Set(t.flatMap(x => LEGACY.get(x) ?? []))
      out.colsOff = canonicalCols(LEGACY_SWITCHED.filter(id => !on.has(id)), doc)
      out.legacy = true
    }
  }
  const s = first(sections)
  if (s != null && s.trim() !== '') {
    const t = tokens(s)
    if (t.includes('all') || t.some(x => x.startsWith('-'))) {
      out.sectionsOff = canonicalSections(t.filter(x => x.startsWith('-')).map(x => x.slice(1)), doc)
    }
  }
  return out
}

/** The two values a link carries for a choice. */
export function serializeUrlChoice(c: PrintChoice, doc: PrintDoc): { cols: string; sections: string } {
  const k = canonicalChoice(c, doc)
  const cols = [...k.colsOff.map(id => `-${id}`), ...k.colsOn.map(id => `*${id}`)]
  return {
    // 'all' is "I changed nothing from the defaults", which is what an empty
    // list of differences means. It was literally every column once; it is not
    // any more, and the word is kept so links written before opt-ins existed
    // still parse as the choice they were.
    cols: cols.length ? cols.join(',') : 'all',
    sections: k.sectionsOff.length ? k.sectionsOff.map(id => `-${id}`).join(',') : 'all',
  }
}

/**
 * The query string with this choice in it, every other parameter kept as it
 * was (the date range, the list's filters). Commas are left as commas so the
 * link stays readable; they are legal in a query string.
 */
export function withChoiceInSearch(search: string, c: PrintChoice, doc: PrintDoc): string {
  const sp = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const v = serializeUrlChoice(c, doc)
  sp.set('cols', v.cols)
  sp.set('sections', v.sections)
  return '?' + sp.toString().replace(/%2C/gi, ',')
}

// ── Precedence ─────────────────────────────────────────────────────────────

/** The link, then the saved default, then the system default — per part. */
export function resolveChoice(url: UrlChoice, saved: PrintChoice | null): PrintChoice {
  return {
    // `?? [...SYSTEM_DEFAULT.colsOff]`, never `?? []`: an empty list means
    // “nothing is turned off”, which is a CHOICE, and using it as the fallback
    // puts a second copy of the system default here that stops matching the
    // real one the moment it changes. It did: Collected went off by default on
    // 2026-09-28 and this line would have kept printing it for every reader
    // who had never opened the picker.
    colsOff: url.colsOff ?? saved?.colsOff ?? [...SYSTEM_DEFAULT.colsOff],
    colsOn: url.colsOn ?? saved?.colsOn ?? [...SYSTEM_DEFAULT.colsOn],
    sectionsOff: url.sectionsOff ?? saved?.sectionsOff ?? [...SYSTEM_DEFAULT.sectionsOff],
  }
}

export type ChoiceSource = 'saved' | 'system' | 'link' | 'custom'

/**
 * Which starting point the page is on, for the line beside the checkboxes. By
 * what the choice IS, not how it got there: a link that happens to match your
 * saved default is your saved default.
 */
export function choiceSource({ choice, saved, url, touched, doc }: {
  choice: PrintChoice; saved: PrintChoice | null; url: UrlChoice; touched: boolean; doc: PrintDoc
}): ChoiceSource {
  if (saved && sameChoice(choice, saved, doc)) return 'saved'
  if (sameChoice(choice, SYSTEM_DEFAULT, doc)) return 'system'
  if (!touched && (url.colsOff || url.sectionsOff)) return 'link'
  return 'custom'
}

export const CHOICE_SOURCE_TEXT: Record<ChoiceSource, string> = {
  saved: 'Using your saved default.',
  // NOT "everything prints" any more. Ref. and the final estimate are off
  // until they are ticked, and a line claiming otherwise would send a reader
  // looking for a column that is not on the page.
  system: 'Using the system default.',
  link: 'Using the choice in this link.',
  custom: 'Changed for this print only.',
}

// ── The saved default ──────────────────────────────────────────────────────

/**
 * One saved default per document. Versioned: a change to the stored shape gets
 * a new key, and the old value is simply never read again.
 *
 * ── v2, 2026-09-28: WHY THE DEFAULT CHANGING FORCED A NEW KEY ───────────────
 * A stored value is a list of what is turned OFF, so it can say “I do not want
 * Collected” and cannot say “I do want it”. Every v1 value was written while
 * Collected printed by default, so a v1 list that does not name it means “I
 * never thought about Collected” — indistinguishable, under the new default,
 * from “I deliberately ticked it on”. Reading them would have quietly put
 * Collected back on a client document for the one reader most likely to have
 * saved a default.
 *
 * The cost is one day of saved preferences: the picker shipped 2026-09-27.
 * Everyone falls back to the system default and can save again.
 *
 * ── AND WHY REMOVING THE COLUMN NEEDED NO v3, 2026-09-29 ────────────────────
 * The ambiguity above ran in the direction that could put Collected BACK on a
 * client document. Deleting the column runs the other way and closes it: a
 * stored v2 list naming 'collected' is now an id nothing knows, and
 * canonicalCols drops unknown ids, so it is ignored. A stored list that does
 * NOT name it can no longer mean "I want it", because there is nothing to
 * want. Every v2 value therefore resolves to the same document it would have
 * resolved to under a fresh key, which is the only thing a version bump would
 * have bought — so the saved defaults people made this week keep working.
 */
export const PRINT_CHOICE_KEY: Record<PrintDoc, string> = {
  statement: 'socc-sales-print-statement-v2',
  list: 'socc-sales-print-list-v2',
}

/** The storage calls this module makes — a real Storage, or a fake in tests. */
export type ChoiceStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** `localStorage`, or null where even touching it throws (it can). */
function browserStore(): ChoiceStore | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/**
 * A stored value, or null when it is missing, not JSON, or not the shape this
 * version writes — an older or foreign value falls back to the system default
 * rather than being half-applied. Unknown ids (a column since removed) are
 * dropped; a column since ADDED is simply not in the "off" list, so it prints.
 */
export function parseStoredChoice(
  raw: string | null, doc: PrintDoc,
  defs: { cols?: PrintColumnDef[]; sections?: PrintSectionDef[] } = {},
): PrintChoice | null {
  if (!raw) return null
  let v: unknown
  try { v = JSON.parse(raw) } catch { return null }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as { colsOff?: unknown; colsOn?: unknown; sectionsOff?: unknown }
  const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(s => typeof s === 'string')
  if (!strings(o.colsOff) || !strings(o.sectionsOff)) return null
  // colsOn MAY BE MISSING, and that needs no new storage key. Every value
  // written before 2026-09-29 predates the off-by-default columns, so its
  // silence about them means "I never had the chance to want these", which is
  // exactly what an empty list says. That is the opposite of the v1→v2 bump,
  // where silence about Collected was ambiguous in the direction that would
  // have put a column BACK on a client document. Here it cannot.
  if (o.colsOn !== undefined && !strings(o.colsOn)) return null
  return {
    colsOff: canonicalCols(o.colsOff, doc, defs.cols),
    colsOn: canonicalCols(o.colsOn ?? [], doc, defs.cols),
    sectionsOff: canonicalSections(o.sectionsOff, doc, defs.sections),
  }
}

export function readSavedChoice(doc: PrintDoc, store: ChoiceStore | null = browserStore()): PrintChoice | null {
  if (!store) return null
  try { return parseStoredChoice(store.getItem(PRINT_CHOICE_KEY[doc]), doc) } catch { return null }
}

/** True when it was saved. False (private window, storage full or blocked):
 *  the page says so, and this print still uses the choice. */
export function writeSavedChoice(doc: PrintDoc, c: PrintChoice, store: ChoiceStore | null = browserStore()): boolean {
  if (!store) return false
  const k = canonicalChoice(c, doc)
  try {
    store.setItem(PRINT_CHOICE_KEY[doc], JSON.stringify({ colsOff: k.colsOff, colsOn: k.colsOn, sectionsOff: k.sectionsOff }))
    return true
  } catch { return false }
}

export function clearSavedChoice(doc: PrintDoc, store: ChoiceStore | null = browserStore()): boolean {
  if (!store) return false
  try { store.removeItem(PRINT_CHOICE_KEY[doc]); return true } catch { return false }
}

// ── What the page prints, as flags ─────────────────────────────────────────

/** One flag per column and section, for this document and mode. */
export interface Prints {
  ref: boolean
  account: boolean
  requested: boolean
  status: boolean
  target: boolean
  final: boolean
  /** Not a column: whether the Final column prints a projection or a dash for
   *  a study still in quality review. False whenever Final itself is off. */
  estimate: boolean
  credits: boolean
  contract: boolean
  activity: boolean
  notes: boolean
}

/** Literally every tick on, including the ones the system default leaves off.
 *  A starting point for tests and for the internal on-screen table, NOT the
 *  system default — printsOf(SYSTEM_DEFAULT) is that, and they differ. */
export const PRINTS_ALL: Prints = {
  ref: true, account: true, requested: true, status: true, target: true, final: true, estimate: true,
  credits: true, contract: true, activity: true, notes: true,
}

/** `internal`: the list spans accounts, so it has an Account column to offer. */
export function printsOf(c: PrintChoice, doc: PrintDoc, { internal = false }: { internal?: boolean } = {}): Prints {
  const col = (id: PrintColumnId) => columnsFor(doc).some(d => d.id === id) && columnOn(c, id)
  const sec = (id: PrintSectionId) => sectionsFor(doc).some(d => d.id === id) && sectionOn(c, id)
  const final = col('final')
  return {
    ref: col('ref'),
    account: internal && col('account'),
    requested: col('requested'),
    status: col('status'),
    target: col('target'),
    final,
    // ONE RULE FOR EVERY FIGURE (see the header): the estimate lives inside
    // the Final column, so it cannot outlive it. Ticking the estimate and
    // unticking Final has to leave nothing behind, or the choice is a lie.
    estimate: final && col('estimate'),
    credits: col('credits'),
    contract: sec('contract'),
    activity: sec('activity'),
    notes: sec('notes'),
  }
}

/**
 * The ids that are really columns of the table.
 *
 * The runtime twin of this is the `cellOnly` flag on the defs, and the two
 * have to name the same ids — a type cannot read a boolean off a const array.
 * ledgerColumns is the one place that bridges them, and a test asserts they
 * agree, so adding a second cell-only tick fails loudly here rather than
 * quietly asking the ledger to draw a column it has no header for.
 */
export type LedgerColumnId = Exclude<PrintColumnId, 'estimate'>

/** The optional columns the ledger prints, in order — `cellOnly` ticks are not
 *  columns and never appear here. */
export function ledgerColumns(p: Prints): LedgerColumnId[] {
  return PRINT_COLUMNS.filter(c => !c.cellOnly).map(c => c.id as LedgerColumnId).filter(id => p[id])
}

/** The columns and sections to offer as checkboxes: Account only where there
 *  is one (a list that spans accounts). */
export function offeredColumns(doc: PrintDoc, { internal = false }: { internal?: boolean } = {}): PrintColumnDef[] {
  return columnsFor(doc).filter(c => !c.internalOnly || internal)
}

// ── Notes for the pre-send panel ───────────────────────────────────────────

export interface ChoiceNote { id: string; text: string }

/** A mark on the page whose only explanation is a note. */
export type UnexplainedMark = 'floor' | 'estimate' | 'not-recorded'

/** What each one would leave unexplained, in the words the page prints. */
const UNEXPLAINED_TEXT: Record<UnexplainedMark, string> = {
  floor: 'why a figure says “at least” or “Not yet priced”',
  estimate: 'what an “≈ est.” figure is based on',
  'not-recorded': 'why a response says “not recorded”',
}

/** "A", "A and B", "A, B and C" — the panel's own copy, so this module needs
 *  nothing from statement.ts at run time. */
function joinPhrases(xs: string[]): string {
  if (xs.length <= 1) return xs.join('')
  return `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`
}

/**
 * Advice about the choice itself, shown in the pre-send panel beside the
 * checklist. NEVER a block: these do not stop the print dialog opening by
 * itself and are not counted among the items to check. The choice is the
 * salesperson's to make; this only says what the client will be unable to do.
 *
 * `unexplained`: the marks the page would print with the Notes off and nothing
 * left to say what they mean (print/Notes.tsx `unexplainedMarks`).
 */
export function choiceNotes(
  p: Prints,
  { unexplained = [], noResponseFigure = 0, estimated = 0 }: {
    unexplained?: UnexplainedMark[]
    /** Rows that print no response figure at all: Final is a dash, which
     *  responseCells gives to everything before quality review. */
    noResponseFigure?: number
    /** Rows that would print a projected final count if the tick were on
     *  (statement.estimatedCount) — counted whether it is on or off, because
     *  the note runs both ways. */
    estimated?: number
  } = {},
): ChoiceNote[] {
  const out: ChoiceNote[] = []
  // THE ONE TICK THAT ADDS SOMETHING TO A CLIENT DOCUMENT RATHER THAN REMOVING
  // IT, so it is the one that gets said out loud in both directions. A
  // projection is not a measurement, and a number in the Final column is read
  // as a number; a salesperson who ticks it should know how many rows it
  // touches, and one who leaves it off should know there was something to show.
  if (p.final && estimated > 0) {
    const one = estimated === 1
    out.push(p.estimate
      ? {
          id: 'estimate-on',
          text: `${one ? 'One study' : `${estimated} studies`} print${one ? 's' : ''} a PROJECTED final count (“≈ est.”), not a measured one: ${
            one ? 'it is' : 'they are'} still in quality review. The figure comes from how past studies finished against target. Untick Final estimate to print a dash instead.`,
        }
      : {
          id: 'estimate-off',
          text: `${one ? 'One study' : `${estimated} studies`} could show a projected final count and ${
            one ? 'shows' : 'show'} a dash instead. Tick Final estimate to print the projection, clearly marked as one.`,
        })
  }
  // A statement sent mid-engagement can show a client targets and dashes. That
  // is a reasonable document and a surprising one, so this panel — the last
  // screen before it goes out — says the number out loud.
  //
  // IT NO LONGER OFFERS A FIX, because there is not one to offer. Until
  // 2026-09-29 this note ended "Tick Collected to show what they have gathered
  // in field so far", and that column is gone (see PRINT_COLUMNS). A note that
  // names an impossible action is worse than one that just states the fact:
  // the reader hunts the panel for a tick that is not there.
  //
  // MINUS THE ONES THE NOTE ABOVE JUST NAMED. With the estimate off, a study
  // in quality review prints a dash and so is inside `noResponseFigure`, and
  // it is also inside `estimated` — counting it in both notes would report the
  // same rows twice, once as "no figure" and once as "could be projected". The
  // specific note is the more useful of the two, so it keeps them. With the
  // estimate on those rows print a projection and are not dashes at all, so
  // there is nothing to subtract.
  const otherDashes = Math.max(0, noResponseFigure - (p.estimate ? 0 : estimated))
  if (otherDashes > 0 && (p.final || p.target)) {
    const one = otherDashes === 1
    out.push({
      id: 'no-response-figure',
      text: `${one ? 'One study' : `${otherDashes} studies`} print${one ? 's' : ''} no response figure: ${
        one ? 'it has' : 'they have'} not reached quality review, so there is no final count yet. ${
        one ? 'It shows' : 'They show'} a dash.`,
    })
  }
  if (p.final && !p.target) {
    out.push({
      id: 'final-without-target',
      text: 'Final prints without Target, so the client cannot check the final count against what they bought. Tick Target to print both.',
    })
  }
  // The contract summary is the one panel that keeps a figure whose column is
  // off: it is the contract position, not a column total, and it has its own
  // tick. Said out loud, because a salesperson who unticks Credits means it.
  if (!p.credits && p.contract) {
    out.push({
      id: 'credits-in-contract',
      text: 'Credits are off in the table, but the contract summary still shows the credits drawn against the allowance. Untick Contract summary to leave credits off the page entirely.',
    })
  }
  if (!p.notes && unexplained.length) {
    out.push({
      id: 'notes-off',
      text: `The notes are off, so nothing on the page explains ${
        joinPhrases(unexplained.map(m => UNEXPLAINED_TEXT[m]))}. Tick Notes to print the explanation.`,
    })
  }
  return out
}
