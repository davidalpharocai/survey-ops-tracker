/**
 * WHAT PRINTS on the two client documents — the Survey Activity Statement and
 * the Survey List — and where that choice comes from.
 *
 * David's decision of 2026-09-27, which replaced the fixed columns of the first
 * build (build notes 3G):
 *
 *   "one will be able to deselect attributes that are included, otherwise
 *    everything is default ... but one can save their preset as their new
 *    default and can always revert back to system default."
 *
 * So the model is DESELECTION. The system default is everything: every ledger
 * column and every section. A choice records only what was turned OFF, which
 * is what makes a column added later print for someone whose saved default is
 * older than it — they never turned it off, so it is on.
 *
 * ALWAYS PRINTED, never offered: the survey reference and the survey name. A
 * row without them matches nothing the client holds.
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
 *   3. The system default: everything.
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

export type PrintColumnId = 'account' | 'requested' | 'status' | 'target' | 'final' | 'collected' | 'credits'
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
    id: 'account', label: 'Account', docs: ['list'], internalOnly: true,
    help: 'Which account each survey belongs to. Offered only on a list that covers more than one account, which prints marked Internal.',
  },
  {
    id: 'requested', label: 'Requested by', docs: ['statement', 'list'],
    help: 'The person at the client who asked for each survey.',
  },
  {
    id: 'status', label: 'Status', docs: ['statement', 'list'],
    help: 'Where each survey is (Received, In field, Delivered and so on), its status mark, and the day it was delivered or is due. Untick it and the key to the marks, and the stages counted out in the table’s group headings and the summary, are left off too.',
  },
  {
    id: 'target', label: 'Target', docs: ['statement', 'list'], response: true,
    help: 'The number of responses the client bought, or the range that was sold. Untick it and the summary stops stating the target and the percentage of it too, so the client cannot check the final count against what they bought.',
  },
  {
    id: 'final', label: 'Final', docs: ['statement', 'list'], response: true,
    help: 'Responses delivered after quality review. Only a delivered survey has one; a survey still in quality review can show an estimate. Untick it and the summary’s final-responses figure goes with it.',
  },
  {
    id: 'collected', label: 'Collected', docs: ['statement', 'list'], response: true,
    help: 'Responses gathered in field, before quality review. Usually above the final count, because review removes responses that fail its checks.',
  },
  {
    id: 'credits', label: 'Credits', docs: ['statement', 'list'],
    help: 'The credits each survey draws, “Not yet priced”, or “committed” for a survey priced but not yet in field. The total row adds up the credits drawn, and the summary’s credit figure follows this tick. On a statement the contract summary keeps its own credits-drawn figure until that is unticked too.',
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
      list: 'The strip across the top: how many surveys are listed, the final responses against target, and the credits drawn. Each figure follows its own column, so unticking Target, Final or Credits takes it out of the strip too.',
    },
  },
  {
    id: 'notes', label: 'Notes', docs: ['statement', 'list'],
    help: {
      statement: 'The numbered notes that explain “Not yet priced”, final against collected, when credits are drawn, and the dates. Untick it and the small note numbers that point to them are left off too. The sign-off still prints.',
      list: 'The numbered notes that explain “Not yet priced”, final against collected, what the list is, and the dates. Untick it and the small note numbers that point to them are left off too. The sign-off still prints.',
    },
  },
]

/** Printed on every row, whatever is ticked. */
export const ALWAYS_PRINTED = ['Ref.', 'Survey and audience'] as const

/** What is turned OFF. Everything not listed prints. */
export interface PrintChoice {
  colsOff: PrintColumnId[]
  sectionsOff: PrintSectionId[]
}

/** Everything prints. */
export const SYSTEM_DEFAULT: PrintChoice = Object.freeze({ colsOff: [], sectionsOff: [] }) as PrintChoice

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
  return { colsOff: canonicalCols(c.colsOff, doc), sectionsOff: canonicalSections(c.sectionsOff, doc) }
}

export function sameChoice(a: PrintChoice, b: PrintChoice, doc: PrintDoc): boolean {
  const x = canonicalChoice(a, doc), y = canonicalChoice(b, doc)
  return x.colsOff.join() === y.colsOff.join() && x.sectionsOff.join() === y.sectionsOff.join()
}

export const columnOn = (c: PrintChoice, id: PrintColumnId) => !c.colsOff.includes(id)
export const sectionOn = (c: PrintChoice, id: PrintSectionId) => !c.sectionsOff.includes(id)

/** Flip one column or section. */
export function toggleColumn(c: PrintChoice, id: PrintColumnId, doc: PrintDoc): PrintChoice {
  const off = columnOn(c, id) ? [...c.colsOff, id] : c.colsOff.filter(x => x !== id)
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
 *   collected → Final and Collected (the old single "Collected" column showed
 *               the final count once a survey was delivered)
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
  ['collected', ['final', 'collected']],
  ['credits', ['credits']],
  ['submitted', []], ['code', []], ['survey', []], ['stage', []], ['deliver', []], ['client', []],
])
/** The columns the retired links could switch. */
const LEGACY_SWITCHED: PrintColumnId[] = ['requested', 'target', 'final', 'collected', 'credits']

const first = (v: string | string[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null
const tokens = (v: string) => v.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)

/**
 * `cols=` and `sections=` as a link writes them:
 *
 *   all              everything prints
 *   -target,-final   everything prints except these
 *
 * Written as what is OFF, like the saved default, so a column added after the
 * link was made prints (nobody turned it off). The leading "-" is also what
 * tells a current link from a retired one, which listed what was ON.
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
    if (t.includes('all') || t.some(x => x.startsWith('-'))) {
      out.colsOff = canonicalCols(t.filter(x => x.startsWith('-')).map(x => x.slice(1)), doc)
    } else if (t.some(x => LEGACY.has(x))) {
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
  return {
    cols: k.colsOff.length ? k.colsOff.map(id => `-${id}`).join(',') : 'all',
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

/** The link, then the saved default, then everything — per part. */
export function resolveChoice(url: UrlChoice, saved: PrintChoice | null): PrintChoice {
  return {
    colsOff: url.colsOff ?? saved?.colsOff ?? [],
    sectionsOff: url.sectionsOff ?? saved?.sectionsOff ?? [],
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
  system: 'Using the system default: everything prints.',
  link: 'Using the choice in this link.',
  custom: 'Changed for this print only.',
}

// ── The saved default ──────────────────────────────────────────────────────

/** One saved default per document. Versioned: a change to the stored shape
 *  gets a new key, and the old value is simply never read again. */
export const PRINT_CHOICE_KEY: Record<PrintDoc, string> = {
  statement: 'socc-sales-print-statement-v1',
  list: 'socc-sales-print-list-v1',
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
  const o = v as { colsOff?: unknown; sectionsOff?: unknown }
  const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(s => typeof s === 'string')
  if (!strings(o.colsOff) || !strings(o.sectionsOff)) return null
  return {
    colsOff: canonicalCols(o.colsOff, doc, defs.cols),
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
    store.setItem(PRINT_CHOICE_KEY[doc], JSON.stringify({ colsOff: k.colsOff, sectionsOff: k.sectionsOff }))
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
  account: boolean
  requested: boolean
  status: boolean
  target: boolean
  final: boolean
  collected: boolean
  credits: boolean
  contract: boolean
  activity: boolean
  notes: boolean
}

export const PRINTS_ALL: Prints = {
  account: true, requested: true, status: true, target: true, final: true, collected: true, credits: true,
  contract: true, activity: true, notes: true,
}

/** `internal`: the list spans accounts, so it has an Account column to offer. */
export function printsOf(c: PrintChoice, doc: PrintDoc, { internal = false }: { internal?: boolean } = {}): Prints {
  const col = (id: PrintColumnId) => columnsFor(doc).some(d => d.id === id) && columnOn(c, id)
  const sec = (id: PrintSectionId) => sectionsFor(doc).some(d => d.id === id) && sectionOn(c, id)
  return {
    account: internal && col('account'),
    requested: col('requested'),
    status: col('status'),
    target: col('target'),
    final: col('final'),
    collected: col('collected'),
    credits: col('credits'),
    contract: sec('contract'),
    activity: sec('activity'),
    notes: sec('notes'),
  }
}

/** The optional columns the ledger prints, in order. */
export function ledgerColumns(p: Prints): PrintColumnId[] {
  return PRINT_COLUMNS.map(c => c.id).filter(id => p[id])
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
  { unexplained = [] }: { unexplained?: UnexplainedMark[] } = {},
): ChoiceNote[] {
  const out: ChoiceNote[] = []
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
