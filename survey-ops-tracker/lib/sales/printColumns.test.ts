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
  it('prints everything', () => {
    expect(printsOf(SYSTEM_DEFAULT, 'statement')).toEqual({ ...PRINTS_ALL, account: false })
    expect(printsOf(SYSTEM_DEFAULT, 'list', { internal: true })).toEqual({ ...PRINTS_ALL, contract: false })
    expect(ledgerColumns(printsOf(SYSTEM_DEFAULT, 'list', { internal: true })))
      .toEqual(['account', 'requested', 'status', 'target', 'final', 'collected', 'credits'])
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
    let c = toggleColumn(SYSTEM_DEFAULT, 'final', 'statement')
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
    expect(serializeUrlChoice(SYSTEM_DEFAULT, 'list')).toEqual({ cols: 'all', sections: 'all' })
    expect(parseUrlChoice('list', 'all', 'all')).toEqual({ colsOff: [], sectionsOff: [] })
  })

  it('keeps every other parameter, and leaves commas readable', () => {
    const q = withChoiceInSearch('?basis=delivered&preset=qtd&c=abc&c=def', choice(['target', 'final']), 'list')
    const sp = new URLSearchParams(q)
    expect(sp.get('basis')).toBe('delivered')
    expect(sp.getAll('c')).toEqual(['abc', 'def'])
    expect(q).toContain('cols=-target,-final')
    expect(q).toContain('sections=all')
    // A second write replaces, never appends.
    expect(new URLSearchParams(withChoiceInSearch(q, SYSTEM_DEFAULT, 'list')).getAll('cols')).toEqual(['all'])
  })

  it('maps the retired cols values as build notes 3G set out', () => {
    // requested → Requested by, target → Target, collected → Final AND
    // Collected, credits → Credits, submitted → nothing. Status always printed.
    const a = parseUrlChoice('statement', 'code,survey,requested,stage,collected,credits,deliver', null)
    expect(a.legacy).toBe(true)
    expect(a.colsOff).toEqual(['target'])
    const p = printsOf(resolveChoice(a, null), 'statement')
    expect(p.requested && p.final && p.collected && p.credits && p.status).toBe(true)
    expect(p.target).toBe(false)

    const b = parseUrlChoice('statement', 'target,submitted', null)
    expect(b.colsOff).toEqual(['requested', 'final', 'collected', 'credits'])
    expect(printsOf(resolveChoice(b, null), 'statement').status).toBe(true)

    // The old screen wrote the list as one comma string or, from a form, as repeats.
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
  const saved = choice(['requested', 'collected'], ['activity'])

  it('uses the system default with neither', () => {
    expect(resolveChoice({}, null)).toEqual(SYSTEM_DEFAULT)
  })

  it('uses the saved default when the link says nothing', () => {
    expect(resolveChoice({}, saved)).toEqual(saved)
  })

  it('lets the link win over the saved default, part by part', () => {
    const url = parseUrlChoice('statement', '-target', null)
    expect(resolveChoice(url, saved)).toEqual(choice(['target'], ['activity']))
    const both = parseUrlChoice('statement', 'all', 'all')
    expect(resolveChoice(both, saved)).toEqual(SYSTEM_DEFAULT)
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
