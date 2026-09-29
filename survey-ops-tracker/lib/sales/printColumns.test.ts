import { describe, it, expect } from 'vitest'
import {
  CHOICE_SOURCE_TEXT, choiceNotes, choiceSource, clearSavedChoice, columnOn, ledgerColumns, offeredColumns,
  parseStoredChoice, parseUrlChoice, PRINT_CHOICE_KEY, PRINT_COLUMNS, PRINT_SECTIONS, PRINTS_ALL, printsOf,
  readSavedChoice, resolveChoice, sameChoice, sectionOn, serializeUrlChoice, SYSTEM_DEFAULT, toggleColumn,
  toggleSection, withChoiceInSearch, writeSavedChoice,
  type ChoiceStore, type PrintChoice, type PrintColumnDef, type PrintColumnId, type PrintDoc, type Prints,
  type PrintSectionId,
} from './printColumns'

/** A Map-backed Storage, so a test controls exactly what is "in the browser". */
function memoryStore(init: Record<string, string> = {}): ChoiceStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init))
  return {
    data,
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v) },
    removeItem: k => { data.delete(k) },
  }
}

/** Storage that throws on every call — a private window, or blocked site data. */
const throwingStore: ChoiceStore = {
  getItem: () => { throw new Error('SecurityError') },
  setItem: () => { throw new Error('QuotaExceededError') },
  removeItem: k => { throw new Error(`SecurityError: ${k}`) },
}

const choice = (colsOff: PrintChoice['colsOff'] = [], sectionsOff: PrintChoice['sectionsOff'] = []): PrintChoice =>
  ({ colsOff, sectionsOff })

/**
 * A choice holding ids the type system no longer admits — 'collected' above
 * all. The cast is the point: it is how a value that reached this module from
 * OUTSIDE the type system arrives (a year-old link, a saved default written by
 * an older build, a hand-edited query string), and those are exactly the routes
 * "Collected cannot come back" has to hold on. A plain `choice([...])` would
 * only prove the compiler stops a fresh caller, which is the easy half.
 */
const fromOutside = (colsOff: string[], sectionsOff: string[] = []): PrintChoice =>
  ({ colsOff: colsOff as PrintChoice['colsOff'], sectionsOff: sectionsOff as PrintChoice['sectionsOff'] })

const ALL_COLS: PrintColumnId[] = PRINT_COLUMNS.map(c => c.id)
const ALL_SECTIONS: PrintSectionId[] = PRINT_SECTIONS.map(s => s.id)
const DOCS: PrintDoc[] = ['statement', 'list']

/**
 * Every set of flags this module can produce: both documents, both modes, and
 * every combination of ticks. 2 × 2 × 2^6 × 2^3 = 2,048 of them, which is small
 * enough to enumerate and the only honest way to say "no reachable state prints
 * Collected" rather than "the three states I thought of do not".
 */
function everyReachablePrints(): { doc: PrintDoc; internal: boolean; choice: PrintChoice; prints: Prints }[] {
  const out: { doc: PrintDoc; internal: boolean; choice: PrintChoice; prints: Prints }[] = []
  for (const doc of DOCS) {
    for (const internal of [false, true]) {
      for (let m = 0; m < (1 << ALL_COLS.length); m++) {
        for (let n = 0; n < (1 << ALL_SECTIONS.length); n++) {
          const c = choice(
            ALL_COLS.filter((_, i) => m & (1 << i)),
            ALL_SECTIONS.filter((_, i) => n & (1 << i)),
          )
          out.push({ doc, internal, choice: c, prints: printsOf(c, doc, { internal }) })
        }
      }
    }
  }
  return out
}

describe('the system default', () => {
  // ── CHANGED 2026-09-29 ──────────────────────────────────────────────────────
  // This read "prints everything except Collected" for one day. David,
  // 2026-09-28: "remove Collected and only keep the Final (ie Delivered) and
  // Target ... yes update the PDF too" — so the column went OFF, and this test
  // pinned SYSTEM_DEFAULT.colsOff at ['collected']. On 2026-09-29 he closed the
  // gap: "lets actually remove 'collected' from all views from now ... a client
  // doesnt need to know that and i dont want to risk a sales person sending it."
  // The column is gone from PRINT_COLUMNS, so there is nothing left to default
  // off and the default is literally everything again.
  //
  // `toEqual` is doing real work here: it fails on an EXTRA key, so this is also
  // the assertion that catches a `collected` flag creeping back into Prints.
  it('prints everything on offer', () => {
    expect(printsOf(SYSTEM_DEFAULT, 'statement')).toEqual({ ...PRINTS_ALL, account: false })
    expect(printsOf(SYSTEM_DEFAULT, 'list', { internal: true })).toEqual({ ...PRINTS_ALL, contract: false })
    expect(ledgerColumns(printsOf(SYSTEM_DEFAULT, 'list', { internal: true })))
      .toEqual(['account', 'requested', 'status', 'target', 'final', 'credits'])
    expect(SYSTEM_DEFAULT).toEqual({ colsOff: [], sectionsOff: [] })
  })

  // ── INVERTED 2026-09-29 ─────────────────────────────────────────────────────
  // Was "still offers Collected, so a client who wants field progress can have
  // it" — it ticked the column on and back off again to prove the escape hatch
  // worked. The escape hatch is the thing David removed: "i dont want to risk a
  // sales person sending it". So the same test now protects the opposite
  // invariant — the tick is not on the panel to be found, in either document,
  // in either mode — and the toggle it used to exercise is proved inert below,
  // in "Collected cannot come back".
  it('does not offer Collected at all, in either document or either mode', () => {
    expect(ALL_COLS).not.toContain('collected')
    for (const doc of DOCS) {
      for (const internal of [false, true]) {
        expect(offeredColumns(doc, { internal }).map(c => c.id)).not.toContain('collected')
      }
    }
    expect(Object.keys(PRINTS_ALL)).not.toContain('collected')
    expect(Object.keys(printsOf(SYSTEM_DEFAULT, 'statement'))).not.toContain('collected')
  })

  it('never offers the reference or the study name, and offers Account only on a list that spans accounts', () => {
    const ids = PRINT_COLUMNS.map(c => c.id) as string[]
    expect(ids).not.toContain('ref')
    expect(ids).not.toContain('study')
    expect(offeredColumns('statement').map(c => c.id)).not.toContain('account')
    expect(offeredColumns('list').map(c => c.id)).not.toContain('account')
    expect(offeredColumns('list', { internal: true }).map(c => c.id)).toContain('account')
  })

  it('has no contract summary on a list', () => {
    expect(printsOf(choice(), 'list').contract).toBe(false)
    // A stray "contract" in a list's choice is not a list section.
    expect(parseUrlChoice('list', null, '-contract').sectionsOff).toEqual([])
  })
})

describe('toggling', () => {
  it('turns one column off and back on, keeping print order', () => {
    // From everything-on, not from SYSTEM_DEFAULT: this is about the toggle,
    // and starting at a default that already has a column off would test both
    // at once and pin neither. (Since 2026-09-29 the two happen to coincide —
    // the default is everything-on again — but the reasoning is what keeps this
    // test honest the next time a column is defaulted off.)
    let c = toggleColumn(choice(), 'final', 'statement')
    c = toggleColumn(c, 'requested', 'statement')
    expect(c.colsOff).toEqual(['requested', 'final'])
    expect(columnOn(c, 'final')).toBe(false)
    c = toggleColumn(c, 'final', 'statement')
    expect(c.colsOff).toEqual(['requested'])
    c = toggleSection(c, 'notes', 'statement')
    expect(sectionOn(c, 'notes')).toBe(false)
  })
})

describe('the link', () => {
  // ── CHANGED 2026-09-29 ──────────────────────────────────────────────────────
  // The pair this round-tripped was ['target', 'collected']; it is ['target',
  // 'credits'] now, because 'collected' is no longer a column id and a
  // round-trip of a dropped id proves nothing about the round-trip. That the
  // dropped id survives NOTHING is proved in "Collected cannot come back".
  //
  // The three `all` assertions moved back too: between 2026-09-28 and
  // 2026-09-29 the system default was ['collected'], so it serialised to
  // '-collected' and this test said so. With the default empty again, the
  // system default and "nothing turned off" are the same choice and both write
  // `all`.
  it('round-trips a choice as what is OFF, and "all" when nothing is', () => {
    const c = choice(['target', 'credits'], ['notes'])
    const v = serializeUrlChoice(c, 'statement')
    expect(v).toEqual({ cols: '-target,-credits', sections: '-notes' })
    const back = parseUrlChoice('statement', v.cols, v.sections)
    expect(back).toEqual({ colsOff: ['target', 'credits'], sectionsOff: ['notes'] })
    expect(serializeUrlChoice(SYSTEM_DEFAULT, 'list')).toEqual({ cols: 'all', sections: 'all' })
    expect(parseUrlChoice('list', 'all', 'all')).toEqual({ colsOff: [], sectionsOff: [] })
    expect(serializeUrlChoice(choice(), 'list')).toEqual({ cols: 'all', sections: 'all' })
  })

  it('keeps every other parameter, and leaves commas readable', () => {
    const q = withChoiceInSearch('?basis=delivered&preset=qtd&c=abc&c=def', choice(['target', 'final']), 'list')
    const sp = new URLSearchParams(q)
    expect(sp.get('basis')).toBe('delivered')
    expect(sp.getAll('c')).toEqual(['abc', 'def'])
    expect(q).toContain('cols=-target,-final')
    expect(q).toContain('sections=all')
    // A second write replaces, never appends. (It wrote '-collected' for the
    // one day the system default held it; 2026-09-29 it is 'all' again.)
    expect(new URLSearchParams(withChoiceInSearch(q, SYSTEM_DEFAULT, 'list')).getAll('cols')).toEqual(['all'])
  })

  it('maps the retired cols values as build notes 3G set out', () => {
    // requested → Requested by, target → Target, credits → Credits,
    // submitted → nothing. Status always printed.
    //
    // `collected` → Final, and ONLY Final. The retired token is not the retired
    // column: it was the account screen's single column, which showed the final
    // count on a delivered survey, so Final is what a bookmark that names it
    // meant. It mapped to both until 2026-09-28. Keeping the mapping after the
    // column was deleted on 2026-09-29 is deliberate — it is what stops an old
    // link silently losing the Final column — and it is safe precisely because
    // the target of the mapping is `final`.
    const a = parseUrlChoice('statement', 'code,study,requested,stage,collected,credits,deliver', null)
    expect(a.legacy).toBe(true)
    expect(a.colsOff).toEqual(['target'])
    const p = printsOf(resolveChoice(a, null), 'statement')
    expect(p.requested && p.final && p.credits && p.status).toBe(true)
    expect(p.target).toBe(false)

    const b = parseUrlChoice('statement', 'target,submitted', null)
    expect(b.colsOff).toEqual(['requested', 'final', 'credits'])
    expect(printsOf(resolveChoice(b, null), 'statement').status).toBe(true)

    // The old screen wrote the list as one comma string or, from a form, as
    // repeats. Naming every switchable column turns every switchable column on
    // — and that is now four columns, not five: the fifth has no column to be.
    expect(parseUrlChoice('statement', ['requested,target,collected,credits'], null).colsOff).toEqual([])
  })

  it('ignores a value that is not a choice, rather than turning everything off', () => {
    expect(parseUrlChoice('statement', 'foo,bar', 'nonsense')).toEqual({})
    expect(parseUrlChoice('statement', '', '')).toEqual({})
    expect(parseUrlChoice('statement', undefined, undefined)).toEqual({})
    // Prototype names are not legacy tokens.
    expect(parseUrlChoice('statement', 'constructor,toString', null)).toEqual({})
    // Unknown ids inside a current value are dropped; the rest applies.
    expect(parseUrlChoice('statement', '-target,-nosuch,-account', null).colsOff).toEqual(['target'])
  })
})

describe('precedence: the link, then the saved default, then everything', () => {
  // Was ['requested', 'collected']. Any two real columns will do; the point of
  // this fixture is that it differs from the system default in BOTH parts.
  const saved = choice(['requested', 'credits'], ['activity'])

  it('uses the system default with neither', () => {
    expect(resolveChoice({}, null)).toEqual(SYSTEM_DEFAULT)
  })

  // ── REWRITTEN 2026-09-29, same job ──────────────────────────────────────────
  // The line this pins used to read `?? []`. An empty list means "nothing is
  // turned off", which is a CHOICE, and as a second copy of the system default
  // it stopped matching the real one the moment Collected went off on
  // 2026-09-28: every reader who had never opened the picker would have kept
  // printing it.
  //
  // With Collected deleted the system default is empty again, so `?? []` and
  // `?? [...SYSTEM_DEFAULT.colsOff]` now agree by coincidence and the old
  // assertion (colsOff === ['collected']) cannot be written. The invariant it
  // was protecting is not about Collected, though — it is "there is exactly one
  // copy of the default" — so it is pinned two ways that survive the
  // coincidence: the result must deep-equal SYSTEM_DEFAULT (so the two cannot
  // drift the next time the default changes), and it must be a fresh COPY of
  // those arrays, which only the spread gives and which a shared reference
  // would let a caller mutate the one default away.
  it('falls back to the system default itself, not to a second copy of it', () => {
    const r = resolveChoice({}, null)
    expect(r).toEqual(SYSTEM_DEFAULT)
    expect(r.colsOff).not.toBe(SYSTEM_DEFAULT.colsOff)
    expect(r.sectionsOff).not.toBe(SYSTEM_DEFAULT.sectionsOff)
    r.colsOff.push('target')
    r.sectionsOff.push('notes')
    expect(resolveChoice({}, null)).toEqual({ colsOff: [], sectionsOff: [] })
    expect(SYSTEM_DEFAULT).toEqual({ colsOff: [], sectionsOff: [] })

    // Per PART: a link that speaks only about sections leaves the columns to
    // whatever comes next, rather than clearing them. Checked against a SAVED
    // default as well as against nothing — with the system default empty, the
    // null case alone would look identical to a bug that cleared the columns.
    expect(resolveChoice(parseUrlChoice('statement', null, '-notes'), saved))
      .toEqual(choice(['requested', 'credits'], ['notes']))
    expect(resolveChoice(parseUrlChoice('statement', null, '-notes'), null))
      .toEqual(choice([], ['notes']))
  })

  it('uses the saved default when the link says nothing', () => {
    expect(resolveChoice({}, saved)).toEqual(saved)
  })

  it('lets the link win over the saved default, part by part', () => {
    const url = parseUrlChoice('statement', '-target', null)
    expect(resolveChoice(url, saved)).toEqual(choice(['target'], ['activity']))
    // `cols=all` is an explicit "print everything", so it beats the saved
    // default AND the system one.
    //
    // ── CHANGED 2026-09-29 ────────────────────────────────────────────────────
    // This used to end "— including Collected", and asserted exactly that:
    // `printsOf(...).collected === true`. It was the one honest hole in the
    // 2026-09-28 off-by-default arrangement, since a link written during the
    // single day before that change says `all` and `all` means all. Deleting
    // the column closed it — "everything" is now a set that does not contain
    // Collected — so the assertion is inverted: an `all` link, saved default or
    // not, prints the six real columns and nothing else.
    const both = parseUrlChoice('statement', 'all', 'all')
    expect(resolveChoice(both, saved)).toEqual(choice())
    expect(ledgerColumns(printsOf(resolveChoice(both, saved), 'statement')))
      .toEqual(['requested', 'status', 'target', 'final', 'credits'])
  })

  it('says which starting point is in effect', () => {
    const src = (c: PrintChoice, s: PrintChoice | null, touched = false, url = {}) =>
      choiceSource({ choice: c, saved: s, url, touched, doc: 'statement' })
    expect(src(SYSTEM_DEFAULT, null)).toBe('system')
    expect(src(saved, saved)).toBe('saved')
    expect(src(choice(['target']), saved, false, { colsOff: ['target'] })).toBe('link')
    expect(src(choice(['target']), saved, true, { colsOff: ['target'] })).toBe('custom')
    expect(src(choice(['final']), null, true)).toBe('custom')
    // Order does not matter to "the same choice".
    expect(sameChoice(choice(['final', 'requested']), choice(['requested', 'final']), 'statement')).toBe(true)
    // And the line the page shows for it. Added 2026-09-29: the system line
    // read "everything prints except Collected" while the column existed, and a
    // sentence on the pre-send panel naming a column the reader cannot find is
    // exactly the confusion the removal was meant to end.
    expect(CHOICE_SOURCE_TEXT.system).toBe('Using the system default: everything prints.')
  })
})

describe('the saved default, in browser storage', () => {
  it('keeps one per document, under a versioned key', () => {
    const store = memoryStore()
    expect(writeSavedChoice('statement', choice(['target']), store)).toBe(true)
    expect(writeSavedChoice('list', choice([], ['notes']), store)).toBe(true)
    expect(PRINT_CHOICE_KEY.statement).toMatch(/-v\d+$/)
    expect(PRINT_CHOICE_KEY.statement).not.toBe(PRINT_CHOICE_KEY.list)
    expect(readSavedChoice('statement', store)).toEqual(choice(['target']))
    expect(readSavedChoice('list', store)).toEqual(choice([], ['notes']))
  })

  it('falls back to the system default on a stale or foreign value', () => {
    for (const raw of [
      '["target","collected"]',             // the account page's old ON list
      '{"cols":["target"]}',                // a different shape
      '{"colsOff":"target","sectionsOff":[]}',
      '{"colsOff":[1,2],"sectionsOff":[]}',
      'not json',
      'null',
      '',
    ]) {
      const store = memoryStore({ [PRINT_CHOICE_KEY.statement]: raw })
      expect(readSavedChoice('statement', store)).toBeNull()
      expect(resolveChoice({}, readSavedChoice('statement', store))).toEqual(SYSTEM_DEFAULT)
    }
  })

  it('drops ids it no longer knows, and applies the rest', () => {
    // 'collected' is now one of those ids, and it is named here on purpose: a
    // v2 value written on 2026-09-28 (the one day the column existed AND the v2
    // key was live) legitimately says colsOff: ['collected'], and it has to
    // survive as a value that still turns Target off rather than being thrown
    // away whole. See "Collected cannot come back" for the other half — that
    // nothing in a stored value can turn it ON.
    const raw = JSON.stringify({ colsOff: ['target', 'collected', 'retired-column'], sectionsOff: ['notes', 'gone'] })
    expect(parseStoredChoice(raw, 'statement')).toEqual(choice(['target'], ['notes']))
  })

  it('prints a column added later for someone whose saved default is older than it', () => {
    // Saved before "Delivered on" existed: it is not in the off list, so it is on.
    const later: PrintColumnDef[] = [
      ...PRINT_COLUMNS,
      { id: 'deliveredOn' as PrintColumnDef['id'], label: 'Delivered on', help: '', docs: ['statement', 'list'] },
    ]
    const raw = JSON.stringify({ colsOff: ['target'], sectionsOff: [] })
    const c = parseStoredChoice(raw, 'statement', { cols: later }) as PrintChoice
    expect(columnOn(c, 'deliveredOn' as PrintColumnDef['id'])).toBe(true)
    expect(columnOn(c, 'target')).toBe(false)
    // And the same for a link made before it.
    expect(columnOn(resolveChoice(parseUrlChoice('statement', '-target', null), null), 'deliveredOn' as PrintColumnDef['id'])).toBe(true)
  })

  it('reset clears the saved default', () => {
    const store = memoryStore()
    writeSavedChoice('statement', choice(['target', 'final']), store)
    writeSavedChoice('list', choice(['requested']), store)
    expect(clearSavedChoice('statement', store)).toBe(true)
    expect(readSavedChoice('statement', store)).toBeNull()
    expect(resolveChoice({}, readSavedChoice('statement', store))).toEqual(SYSTEM_DEFAULT)
    // Only that document's.
    expect(readSavedChoice('list', store)).toEqual(choice(['requested']))
  })

  it('survives storage that throws, and says the save did not happen', () => {
    expect(readSavedChoice('statement', throwingStore)).toBeNull()
    expect(writeSavedChoice('statement', choice(['target']), throwingStore)).toBe(false)
    expect(clearSavedChoice('statement', throwingStore)).toBe(false)
    expect(readSavedChoice('statement', null)).toBeNull()
    expect(writeSavedChoice('statement', choice(), null)).toBe(false)
  })
})

describe('notes about the choice', () => {
  it('warns, without blocking, when Final prints without Target', () => {
    const p = printsOf(choice(['target']), 'statement')
    const notes = choiceNotes(p)
    expect(notes.map(n => n.id)).toEqual(['final-without-target'])
    expect(notes[0].text).toContain('cannot check the final count against what they bought')
    // Target and Final together, or Final off: nothing to say.
    expect(choiceNotes(printsOf(SYSTEM_DEFAULT, 'statement'))).toEqual([])
    expect(choiceNotes(printsOf(choice(['target', 'final']), 'statement'))).toEqual([])
  })

  // ── INVERTED 2026-09-29 ─────────────────────────────────────────────────────
  // Was "says how many surveys print no response figure at all, and OFFERS THE
  // TICK THAT FILLS THEM IN". The note used to end "Tick Collected to show what
  // it has gathered in field so far", and the test's last three assertions all
  // turned on that offer: the note vanished once Collected was ticked, because
  // those rows then carried a figure.
  //
  // There is no tick now. A note that names an impossible action is worse than
  // one that just states the fact — the reader hunts the panel for a checkbox
  // that is not there — so the note ends "It shows a dash." and fires whenever
  // a response column prints and any row has no final count. Which means the
  // "Collected is on, so nothing to say" case inverts: everything-on is the
  // system default now, and the note is exactly what it must say there.
  //
  // What is still protected, unchanged: a statement sent mid-engagement can
  // show a client targets and dashes, and the last screen before it goes out
  // says the number out loud.
  it('says how many studies print no response figure at all, and no longer offers a tick that is gone', () => {
    const p = printsOf(SYSTEM_DEFAULT, 'statement')
    const one = choiceNotes(p, { noResponseFigure: 1 })
    expect(one.map(n => n.id)).toEqual(['no-response-figure'])
    expect(one[0].text).toBe(
      'One study prints no response figure: it has not reached quality review, so there is no final count yet. ' +
      'It shows a dash.')
    const four = choiceNotes(p, { noResponseFigure: 4 })[0]
    expect(four.text).toContain('4 studies print no response figure')
    expect(four.text).toContain('They show a dash.')
    // No note anywhere near this panel points at a column that no longer exists.
    for (const t of [one[0].text, four.text]) expect(t).not.toMatch(/collect/i)

    // Everything-on is the same case, not the escape from it: the note stands.
    expect(choiceNotes(printsOf(choice(), 'statement'), { noResponseFigure: 4 }).map(n => n.id))
      .toEqual(['no-response-figure'])
    // Silent when there are no such rows.
    expect(choiceNotes(p, { noResponseFigure: 0 })).toEqual([])
    // Or when the document prints no response column at all: the reader turned
    // the whole Responses group off and is not missing a figure by accident.
    expect(choiceNotes(printsOf(choice(['target', 'final']), 'statement'), { noResponseFigure: 4 }))
      .toEqual([])
  })

  it('says when the notes that explain "at least" are off', () => {
    const p = printsOf(choice([], ['notes']), 'statement')
    expect(choiceNotes(p, { unexplained: ['floor'] }).map(n => n.id)).toEqual(['notes-off'])
    expect(choiceNotes(p, { unexplained: [] })).toEqual([])
  })

  it('names every mark the notes would have explained, not just the credit figures', () => {
    const p = printsOf(choice([], ['notes']), 'statement')
    const one = choiceNotes(p, { unexplained: ['estimate'] })[0]
    expect(one.text).toBe('The notes are off, so nothing on the page explains what an “≈ est.” figure is based on. Tick Notes to print the explanation.')
    const three = choiceNotes(p, { unexplained: ['floor', 'estimate', 'not-recorded'] })[0]
    expect(three.text).toContain('explains why a figure says “at least” or “Not yet priced”, what an “≈ est.” figure is based on or why a response says “not recorded”.')
  })

  it('says the contract summary keeps its credits when the column is off', () => {
    // The one panel that holds a figure whose column is off, so it is the one
    // case the salesperson has to be told about.
    expect(choiceNotes(printsOf(choice(['credits']), 'statement')).map(n => n.id)).toEqual(['credits-in-contract'])
    // With the panel off too, nothing on the page carries a credit figure.
    expect(choiceNotes(printsOf(choice(['credits'], ['contract']), 'statement'))).toEqual([])
    // A list has no contract panel, so unticking Credits takes them off outright.
    expect(choiceNotes(printsOf(choice(['credits']), 'list'))).toEqual([])
  })
})

/**
 * ── ADDED 2026-09-29 ────────────────────────────────────────────────────────
 * David: "lets actually remove 'collected' from all views from now ... a client
 * doesnt need to know that and i dont want to risk a sales person sending it."
 *
 * The ask is not "off by default", which is what shipped on 2026-09-28. It is
 * that no sequence of events puts the pre-QA field count on a document a client
 * receives. Off-by-default fails that: a hurried person can tick it, and so can
 * a link, and so can a saved default written on the wrong day.
 *
 * So this block walks every route into this module that could name the column
 * and shows each one dead-ends. The routes are: the picker (a toggle), a link
 * (current form, retired form, and the `all` escape), browser storage, and the
 * copy the panel prints. Anything that can reach a choice from outside the type
 * system goes through `fromOutside`, because the compiler is not the guard here
 * — old data is.
 */
describe('Collected cannot come back', () => {
  it('is not a column, a flag, or a tick anywhere in the module', () => {
    expect(PRINT_COLUMNS.find(c => c.id === ('collected' as PrintColumnId))).toBeUndefined()
    expect(PRINT_SECTIONS.map(s => s.id as string)).not.toContain('collected')
    expect(Object.keys(PRINTS_ALL)).not.toContain('collected')
    expect(SYSTEM_DEFAULT.colsOff as string[]).not.toContain('collected')
  })

  it('cannot be ticked on: the toggle drops an id that has no column', () => {
    // The old "still offers Collected" test did exactly this and expected true.
    // canonicalCols keeps only ids that columnsFor(doc) yields, so toggling a
    // ghost id off canonicalises away and toggling it "on" was never possible —
    // the deselection model has no way to say "I want this one".
    for (const doc of DOCS) {
      const t = toggleColumn(SYSTEM_DEFAULT, 'collected' as PrintColumnId, doc)
      expect(t.colsOff as string[]).not.toContain('collected')
      expect(sameChoice(t, SYSTEM_DEFAULT, doc)).toBe(true)
      expect(Object.keys(printsOf(t, doc, { internal: true }))).not.toContain('collected')
    }
  })

  it('cannot arrive in a link: current, retired, or "all"', () => {
    for (const doc of DOCS) {
      // A current link that names it, either way round. "-collected" is a
      // deselection of a column that is not there, and "collected" on its own
      // is not a current token at all.
      expect(parseUrlChoice(doc, '-collected', null)).toEqual({ colsOff: [] })
      expect(parseUrlChoice(doc, '-target,-collected', null).colsOff).toEqual(['target'])
      // The retired token, alone. It maps to `final` by design (build notes
      // 3G): the word on the old account screen meant the final count. So it
      // turns Final ON and leaves the rest off, and no column called Collected
      // is produced by the mapping.
      const retired = parseUrlChoice(doc, 'collected', null)
      expect(retired.legacy).toBe(true)
      expect(retired.colsOff).toEqual(['requested', 'target', 'credits'])
      expect(printsOf(resolveChoice(retired, null), doc).final).toBe(true)
      // The `all` escape, with a saved default that names it, under both modes.
      const saved = parseStoredChoice(JSON.stringify({ colsOff: ['collected'], sectionsOff: [] }), doc)
      for (const url of [parseUrlChoice(doc, 'all', 'all'), parseUrlChoice(doc, 'collected', null), {}]) {
        for (const internal of [false, true]) {
          const p = printsOf(resolveChoice(url, saved), doc, { internal })
          expect(Object.keys(p)).not.toContain('collected')
          expect(ledgerColumns(p) as string[]).not.toContain('collected')
        }
      }
    }
    // And a link can never be WRITTEN naming it, however the choice was built.
    for (const doc of DOCS) {
      expect(serializeUrlChoice(fromOutside(['collected']), doc).cols).toBe('all')
      expect(withChoiceInSearch('?basis=delivered', fromOutside(['collected']), doc)).not.toMatch(/collect/i)
    }
  })

  it('cannot arrive from browser storage, whatever an older build wrote there', () => {
    for (const doc of DOCS) {
      for (const raw of [
        JSON.stringify({ colsOff: ['collected'], sectionsOff: [] }),           // a v2 value from 2026-09-28
        JSON.stringify({ colsOff: [], sectionsOff: [] }),                      // "nothing off" — the dangerous one
        JSON.stringify({ colsOff: ['target'], sectionsOff: ['collected'] }),   // named as a section instead
      ]) {
        const store = memoryStore({ [PRINT_CHOICE_KEY[doc]]: raw })
        const c = resolveChoice({}, readSavedChoice(doc, store))
        expect(c.colsOff as string[]).not.toContain('collected')
        expect(c.sectionsOff as string[]).not.toContain('collected')
        expect(ledgerColumns(printsOf(c, doc, { internal: true })) as string[]).not.toContain('collected')
      }
      // Nor can this build write it back out, so a round-trip cannot smuggle it.
      const store = memoryStore()
      writeSavedChoice(doc, fromOutside(['collected', 'target']), store)
      expect(store.data.get(PRINT_CHOICE_KEY[doc])).not.toMatch(/collect/i)
      expect(readSavedChoice(doc, store)).toEqual(choice(['target']))
    }
  })

  it('prints in no reachable state: all 2,048 combinations of ticks, both documents, both modes', () => {
    const states = everyReachablePrints()
    expect(states).toHaveLength(2 * 2 * (1 << ALL_COLS.length) * (1 << ALL_SECTIONS.length))
    for (const { doc, internal, prints } of states) {
      expect(Object.keys(prints), `${doc}/${internal}`).not.toContain('collected')
      expect(ledgerColumns(prints) as string[], `${doc}/${internal}`).not.toContain('collected')
    }
    // Every column the ledger can ever print, across every one of those states.
    const everPrinted = new Set(states.flatMap(s => ledgerColumns(s.prints) as string[]))
    expect([...everPrinted].sort()).toEqual(['account', 'credits', 'final', 'requested', 'status', 'target'])
  })

  it('appears in no words the page shows — not a label, a help text, a source line or a note', () => {
    // This file renders no document, so the nearest equivalent of "assert the
    // string does not appear in the HTML" is every piece of user-visible copy
    // this module hands the page. Case-insensitive: "Collected" in a heading
    // and "collected" in a sentence are the same leak. Nothing here says
    // "collect" in any innocent sense, so the whole stem is safe to ban.
    const copy: string[] = [
      ...PRINT_COLUMNS.flatMap(c => [c.label, c.help]),
      ...PRINT_SECTIONS.flatMap(s => [s.label, ...Object.values(s.help)]),
      ...Object.values(CHOICE_SOURCE_TEXT),
    ]
    for (const { prints } of everyReachablePrints()) {
      for (const noResponseFigure of [0, 1, 4]) {
        for (const unexplained of [[], ['floor', 'estimate', 'not-recorded']] as const) {
          copy.push(...choiceNotes(prints, { noResponseFigure, unexplained: [...unexplained] }).map(n => n.text))
        }
      }
    }
    for (const s of copy) expect(s, s).not.toMatch(/collect/i)
    // A guard on the guard: if the copy were ever collected empty, the loop
    // above would pass vacuously and this block would protect nothing.
    expect(copy.length).toBeGreaterThan(100)
    expect(copy.some(s => /dash/.test(s))).toBe(true)
  })
})
