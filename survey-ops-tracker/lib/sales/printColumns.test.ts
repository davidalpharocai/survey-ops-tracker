import { describe, it, expect } from 'vitest'
import {
  choiceNotes, choiceSource, clearSavedChoice, columnOn, ledgerColumns, offeredColumns, parseStoredChoice,
  parseUrlChoice, PRINT_CHOICE_KEY, PRINT_COLUMNS, PRINTS_ALL, printsOf, readSavedChoice, resolveChoice, sameChoice,
  sectionOn, serializeUrlChoice, SYSTEM_DEFAULT, toggleColumn, toggleSection, withChoiceInSearch, writeSavedChoice,
  type ChoiceStore, type PrintChoice, type PrintColumnDef,
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
  removeItem: () => { throw new Error('SecurityError') },
}

const choice = (colsOff: PrintChoice['colsOff'] = [], sectionsOff: PrintChoice['sectionsOff'] = []): PrintChoice =>
  ({ colsOff, sectionsOff })

describe('the system default', () => {
  // David, 2026-09-28: "remove Collected and only keep the Final (ie Delivered)
  // and Target ... yes update the PDF too". Off, not deleted: it is still in
  // PRINT_COLUMNS and still one tick away.
  it('prints everything except Collected', () => {
    expect(printsOf(SYSTEM_DEFAULT, 'statement')).toEqual({ ...PRINTS_ALL, account: false, collected: false })
    expect(printsOf(SYSTEM_DEFAULT, 'list', { internal: true })).toEqual({ ...PRINTS_ALL, contract: false, collected: false })
    expect(ledgerColumns(printsOf(SYSTEM_DEFAULT, 'list', { internal: true })))
      .toEqual(['account', 'requested', 'status', 'target', 'final', 'credits'])
  })

  it('still offers Collected, so a client who wants field progress can have it', () => {
    expect(offeredColumns('statement').map(c => c.id)).toContain('collected')
    expect(offeredColumns('list').map(c => c.id)).toContain('collected')
    const on = toggleColumn(SYSTEM_DEFAULT, 'collected', 'statement')
    expect(printsOf(on, 'statement').collected).toBe(true)
    // And back off again, landing exactly on the system default.
    expect(sameChoice(toggleColumn(on, 'collected', 'statement'), SYSTEM_DEFAULT, 'statement')).toBe(true)
  })

  it('never offers the reference or the survey name, and offers Account only on a list that spans accounts', () => {
    const ids = PRINT_COLUMNS.map(c => c.id) as string[]
    expect(ids).not.toContain('ref')
    expect(ids).not.toContain('survey')
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
    // at once and pin neither.
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
  it('round-trips a choice as what is OFF, and "all" when nothing is', () => {
    const c = choice(['target', 'collected'], ['notes'])
    const v = serializeUrlChoice(c, 'statement')
    expect(v).toEqual({ cols: '-target,-collected', sections: '-notes' })
    const back = parseUrlChoice('statement', v.cols, v.sections)
    expect(back).toEqual({ colsOff: ['target', 'collected'], sectionsOff: ['notes'] })
    // The system default is no longer "nothing off", so it no longer
    // serialises to `all`. `all` still means every column, and a link that
    // says it was written by somebody who meant it.
    expect(serializeUrlChoice(SYSTEM_DEFAULT, 'list')).toEqual({ cols: '-collected', sections: 'all' })
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
    // A second write replaces, never appends.
    expect(new URLSearchParams(withChoiceInSearch(q, SYSTEM_DEFAULT, 'list')).getAll('cols')).toEqual(['-collected'])
  })

  it('maps the retired cols values as build notes 3G set out', () => {
    // requested → Requested by, target → Target, credits → Credits,
    // submitted → nothing. Status always printed.
    //
    // `collected` → Final ALONE since 2026-09-28. The retired id was the
    // account screen's single column, which showed the final count on a
    // delivered survey, so Final is what it meant — and honouring the literal
    // word would let a bookmark put Collected back on a client document that
    // the system default keeps off.
    const a = parseUrlChoice('statement', 'code,survey,requested,stage,collected,credits,deliver', null)
    expect(a.legacy).toBe(true)
    expect(a.colsOff).toEqual(['target', 'collected'])
    const p = printsOf(resolveChoice(a, null), 'statement')
    expect(p.requested && p.final && p.credits && p.status).toBe(true)
    expect(p.target).toBe(false)
    expect(p.collected).toBe(false)

    const b = parseUrlChoice('statement', 'target,submitted', null)
    expect(b.colsOff).toEqual(['requested', 'final', 'collected', 'credits'])
    expect(printsOf(resolveChoice(b, null), 'statement').status).toBe(true)

    // The old screen wrote the list as one comma string or, from a form, as repeats.
    // Every switchable column ON except Collected, which no retired token can
    // now turn on.
    expect(parseUrlChoice('statement', ['requested,target,collected,credits'], null).colsOff).toEqual(['collected'])
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
  const saved = choice(['requested', 'collected'], ['activity'])

  it('uses the system default with neither', () => {
    expect(resolveChoice({}, null)).toEqual(SYSTEM_DEFAULT)
  })

  it('falls back to the system default, not to an empty choice, with neither', () => {
    // The line this pins used to read `?? []`. An empty list means "nothing is
    // turned off", which is a choice, and as the second copy of the system
    // default it stopped matching the real one the moment Collected went off:
    // every reader who had never opened the picker would have kept printing it.
    expect(resolveChoice({}, null).colsOff).toEqual(['collected'])
    expect(printsOf(resolveChoice({}, null), 'statement').collected).toBe(false)
    // Per PART: a link that speaks only about sections leaves columns on the
    // system default rather than clearing them.
    expect(resolveChoice(parseUrlChoice('statement', null, '-notes'), null))
      .toEqual(choice(['collected'], ['notes']))
  })

  it('uses the saved default when the link says nothing', () => {
    expect(resolveChoice({}, saved)).toEqual(saved)
  })

  it('lets the link win over the saved default, part by part', () => {
    const url = parseUrlChoice('statement', '-target', null)
    expect(resolveChoice(url, saved)).toEqual(choice(['target'], ['activity']))
    // `cols=all` is an explicit "print everything", so it beats the saved
    // default AND the system one — including Collected. Links written since
    // 2026-09-28 carry `-collected` instead; the window in which `all` links
    // were generated is one day wide (the picker shipped 2026-09-27).
    const both = parseUrlChoice('statement', 'all', 'all')
    expect(resolveChoice(both, saved)).toEqual(choice())
    expect(printsOf(resolveChoice(both, saved), 'statement').collected).toBe(true)
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
    const raw = JSON.stringify({ colsOff: ['target', 'retired-column'], sectionsOff: ['notes', 'gone'] })
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

  // The cost of turning Collected off, said on the last screen before the
  // document goes out rather than left to be noticed on the page. Every survey
  // before quality review prints a dash in Final (statement.responseCells), so
  // a statement sent mid-engagement can carry nothing but targets.
  it('says how many surveys print no response figure at all, and offers the tick that fills them in', () => {
    const p = printsOf(SYSTEM_DEFAULT, 'statement')
    const one = choiceNotes(p, { noResponseFigure: 1 })
    expect(one.map(n => n.id)).toEqual(['no-response-figure'])
    expect(one[0].text).toBe(
      'One survey prints no response figure: it has not reached quality review, so there is no final count yet. ' +
      'Tick Collected to show what it has gathered in field so far.')
    expect(choiceNotes(p, { noResponseFigure: 4 })[0].text).toContain('4 surveys print no response figure')

    // Nothing to say once Collected is on — those rows now carry a figure.
    expect(choiceNotes(printsOf(choice(), 'statement'), { noResponseFigure: 4 })).toEqual([])
    // Or when there are no such rows.
    expect(choiceNotes(p, { noResponseFigure: 0 })).toEqual([])
    // Or when the document prints no response column at all: the reader turned
    // the whole Responses group off and is not missing a figure by accident.
    expect(choiceNotes(printsOf(choice(['target', 'final', 'collected']), 'statement'), { noResponseFigure: 4 }))
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
