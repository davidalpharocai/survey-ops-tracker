import { describe, it, expect } from 'vitest'
import {
  ALWAYS_PRINTED, CHOICE_SOURCE_TEXT, choiceNotes, choiceSource, clearSavedChoice, columnOn, ledgerColumns,
  offeredColumns,
  parseStoredChoice, parseUrlChoice, PRINT_CHOICE_KEY, PRINT_COLUMNS, PRINT_SECTIONS, PRINTS_ALL, printsOf,
  readSavedChoice, resolveChoice, sameChoice, sectionOn, serializeUrlChoice, SYSTEM_DEFAULT, toggleColumn,
  toggleSection, withChoiceInSearch, writeSavedChoice,
  type ChoiceStore, type LedgerColumnId, type PrintChoice, type PrintColumnDef, type PrintColumnId,
  type PrintDoc, type Prints,
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

const choice = (
  colsOff: PrintChoice['colsOff'] = [],
  sectionsOff: PrintChoice['sectionsOff'] = [],
  colsOn: PrintChoice['colsOn'] = [],
): PrintChoice => ({ colsOff, colsOn, sectionsOff })

/**
 * A choice holding ids the type system no longer admits — 'collected' above
 * all. The cast is the point: it is how a value that reached this module from
 * OUTSIDE the type system arrives (a year-old link, a saved default written by
 * an older build, a hand-edited query string), and those are exactly the routes
 * "Collected cannot come back" has to hold on. A plain `choice([...])` would
 * only prove the compiler stops a fresh caller, which is the easy half.
 */
const fromOutside = (colsOff: string[], sectionsOff: string[] = [], colsOn: string[] = []): PrintChoice => ({
  colsOff: colsOff as PrintChoice['colsOff'],
  colsOn: colsOn as PrintChoice['colsOn'],
  sectionsOff: sectionsOff as PrintChoice['sectionsOff'],
})

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
  //
  // ── AND CHANGED AGAIN 2026-09-29 ────────────────────────────────────────────
  // "Everything" is no longer the default. David: "default should NOT include
  // but have the option to add: Final estimation, the PR#'s ...", so Ref. and
  // the final estimate are `defaultOff` and print only once somebody ticks
  // them. SYSTEM_DEFAULT is still both lists EMPTY — that is the point of the
  // second list: the default lives on the column definitions, and empty means
  // "nothing differs from it" rather than "everything is on".
  it('prints every column that is not marked defaultOff, and neither of the two that are', () => {
    const OPT_IN = { ref: false, estimate: false }
    expect(printsOf(SYSTEM_DEFAULT, 'statement')).toEqual({ ...PRINTS_ALL, ...OPT_IN, account: false })
    expect(printsOf(SYSTEM_DEFAULT, 'list', { internal: true })).toEqual({ ...PRINTS_ALL, ...OPT_IN, contract: false })
    expect(ledgerColumns(printsOf(SYSTEM_DEFAULT, 'list', { internal: true })))
      .toEqual(['account', 'requested', 'status', 'target', 'final', 'credits'])
    expect(SYSTEM_DEFAULT).toEqual({ colsOff: [], colsOn: [], sectionsOff: [] })
    // The defaults are stated ONCE, on the defs — not here and not in
    // SYSTEM_DEFAULT. This is the assertion that keeps them from drifting.
    expect(PRINT_COLUMNS.filter(c => c.defaultOff).map(c => c.id)).toEqual(Object.keys(OPT_IN))
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

  // ── HALF INVERTED 2026-09-29 ────────────────────────────────────────────────
  // Was "never offers the reference or the study name". The reference is now
  // offered — David asked for the PR numbers off by default with a tick to add
  // them — and it is offered on BOTH documents, off in both until ticked. The
  // study name is the half that did not move: it is the only thing left in
  // ALWAYS_PRINTED, because a row without it matches nothing the client holds.
  it('offers the reference but never the study name, and offers Account only on a list that spans accounts', () => {
    const ids = PRINT_COLUMNS.map(c => c.id) as string[]
    expect(ids).not.toContain('study')
    expect(ALWAYS_PRINTED).toEqual(['Study and audience'])
    for (const doc of DOCS) {
      expect(offeredColumns(doc).map(c => c.id)).toContain('ref')
      expect(printsOf(SYSTEM_DEFAULT, doc).ref).toBe(false)
      expect(printsOf(choice([], [], ['ref']), doc).ref).toBe(true)
    }
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

  // ── ADDED 2026-09-29 ────────────────────────────────────────────────────────
  // The same toggle, for a column whose default runs the other way. It moves in
  // and out of `colsOn` instead, and nothing about the ordinary columns changes
  // — which is the property that let this land without a storage-key bump.
  it('turns an off-by-default column ON and back off, in the other list', () => {
    let c = toggleColumn(choice(), 'ref', 'statement')
    expect(columnOn(c, 'ref')).toBe(true)
    expect(c.colsOn).toEqual(['ref'])
    expect(c.colsOff).toEqual([])
    c = toggleColumn(c, 'estimate', 'statement')
    // Print order, same as colsOff keeps: Ref. before the final estimate.
    expect(c.colsOn).toEqual(['ref', 'estimate'])
    c = toggleColumn(c, 'ref', 'statement')
    expect(c.colsOn).toEqual(['estimate'])
    expect(columnOn(c, 'ref')).toBe(false)
    // Unticking an opt-in never writes it to colsOff — an id in the list that
    // does not govern it would be silently ignored, and a later default flip
    // would then resurrect a choice nobody made.
    expect(c.colsOff).toEqual([])
  })

  // The two ways of saying "not a column" have to name the same ids: a runtime
  // flag on the defs, and a type the ledger is written against. Nothing can
  // make a type read a boolean off a const array, so this is the seam, and
  // this is the test that guards it.
  it('keeps cellOnly and LedgerColumnId in step', () => {
    const cellOnly = PRINT_COLUMNS.filter(c => c.cellOnly).map(c => c.id)
    expect(cellOnly).toEqual(['estimate'])
    const drawn: LedgerColumnId[] = ledgerColumns(PRINTS_ALL)
    for (const id of cellOnly) expect(drawn as string[]).not.toContain(id)
    // Every other column, with every tick on, IS drawn.
    expect(drawn).toEqual(PRINT_COLUMNS.filter(c => !c.cellOnly).map(c => c.id))
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
  it('round-trips a choice as what DIFFERS from the defaults, and "all" when nothing does', () => {
    const c = choice(['target', 'credits'], ['notes'])
    const v = serializeUrlChoice(c, 'statement')
    expect(v).toEqual({ cols: '-target,-credits', sections: '-notes' })
    const back = parseUrlChoice('statement', v.cols, v.sections)
    expect(back).toEqual({ colsOff: ['target', 'credits'], colsOn: [], sectionsOff: ['notes'] })
    expect(serializeUrlChoice(SYSTEM_DEFAULT, 'list')).toEqual({ cols: 'all', sections: 'all' })
    expect(parseUrlChoice('list', 'all', 'all')).toEqual({ colsOff: [], colsOn: [], sectionsOff: [] })
    expect(serializeUrlChoice(choice(), 'list')).toEqual({ cols: 'all', sections: 'all' })
  })

  // ── ADDED 2026-09-29 ────────────────────────────────────────────────────────
  // The opt-in half of the link, and the reason its prefix is `*` and not `+`.
  it('carries an opt-in as "*id", both ways, and survives a real query string', () => {
    const c = choice(['target'], [], ['ref', 'estimate'])
    const v = serializeUrlChoice(c, 'statement')
    expect(v.cols).toBe('-target,*ref,*estimate')
    expect(parseUrlChoice('statement', v.cols, v.sections))
      .toEqual({ colsOff: ['target'], colsOn: ['ref', 'estimate'], sectionsOff: [] })
    expect(printsOf(resolveChoice(parseUrlChoice('statement', v.cols, null), null), 'statement').ref).toBe(true)

    // A link states the WHOLE column choice: "-target" alone means no opt-in
    // was ticked, not "ask my saved default about the opt-ins".
    expect(parseUrlChoice('statement', '-target', null).colsOn).toEqual([])

    // THE TRAP THIS PREFIX EXISTS TO AVOID. A bare "+" in a query string
    // decodes to a space, so "+ref" would arrive as "ref" — one of the RETIRED
    // bare-id tokens that mean "on" — and be parsed as a legacy link. "*" is in
    // the urlencoded safe set, so it makes the round trip through a real
    // URLSearchParams untouched.
    const q = withChoiceInSearch('?preset=qtd', c, 'statement')
    expect(q).toContain('cols=-target,*ref,*estimate')
    expect(new URLSearchParams(q).get('cols')).toBe('-target,*ref,*estimate')
    expect(new URLSearchParams('?cols=+ref').get('cols')).toBe(' ref')
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
    expect(resolveChoice({}, null)).toEqual({ colsOff: [], colsOn: [], sectionsOff: [] })
    expect(SYSTEM_DEFAULT).toEqual({ colsOff: [], colsOn: [], sectionsOff: [] })

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
    // It said "everything prints" until 2026-09-29, and then stopped being
    // true: Ref. and the final estimate are off until somebody ticks them, and
    // a line promising a column the reader cannot find is the same confusion in
    // a different direction.
    expect(CHOICE_SOURCE_TEXT.system).toBe('Using the system default.')
  })
})

describe('the saved default, in browser storage', () => {
  /**
   * ── WHY ADDING colsOn NEEDED NO v3 (2026-09-29) ────────────────────────────
   *
   * The v1→v2 bump happened because silence was AMBIGUOUS in the dangerous
   * direction: a v1 value that did not name Collected could mean "I never
   * thought about it" or "I ticked it on", and reading it the wrong way would
   * have put a column back on a client document.
   *
   * Silence about `colsOn` cannot be ambiguous. Every value written before
   * today predates every off-by-default column, so nobody could have asked for
   * one, and an empty list is exactly what they meant. The saved defaults
   * people made this week keep working, which is the whole reason to check.
   */
  it('reads a value written before colsOn existed, and defaults its opt-ins off', () => {
    const store = memoryStore()
    store.setItem(PRINT_CHOICE_KEY.statement, JSON.stringify({ colsOff: ['target'], sectionsOff: ['notes'] }))
    const read = readSavedChoice('statement', store)
    expect(read).toEqual({ colsOff: ['target'], colsOn: [], sectionsOff: ['notes'] })
    // The deselections it DID record still apply — it is honoured, not dropped.
    expect(printsOf(read as PrintChoice, 'statement').target).toBe(false)
    expect(printsOf(read as PrintChoice, 'statement').ref).toBe(false)
    // A colsOn of the wrong shape is a value this version did not write, and
    // falls back to the system default rather than being half-applied — the
    // same rule the other two lists have always had.
    store.setItem(PRINT_CHOICE_KEY.list, JSON.stringify({ colsOff: [], colsOn: 'ref', sectionsOff: [] }))
    expect(readSavedChoice('list', store)).toBeNull()
  })

  it('round-trips an opt-in, so a saved default can ask for one', () => {
    const store = memoryStore()
    expect(writeSavedChoice('statement', choice(['target'], [], ['ref']), store)).toBe(true)
    expect(JSON.parse(store.getItem(PRINT_CHOICE_KEY.statement) as string))
      .toEqual({ colsOff: ['target'], colsOn: ['ref'], sectionsOff: [] })
    expect(printsOf(readSavedChoice('statement', store) as PrintChoice, 'statement').ref).toBe(true)
  })

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
  // ── ADDED 2026-09-29 ────────────────────────────────────────────────────────
  // The final estimate is the ONE tick that adds something to a client document
  // rather than taking something away, so it is the one that gets disclosed in
  // both directions. A projection is not a measurement, and a number in the
  // Final column is read as a number.
  describe('the final estimate, which puts a projection on a client document', () => {
    const on = printsOf(choice([], [], ['estimate']), 'statement')
    const off = printsOf(SYSTEM_DEFAULT, 'statement')

    it('says how many rows carry a projection when the tick is on', () => {
      const n = choiceNotes(on, { estimated: 3, noResponseFigure: 0 })
      expect(n.map(x => x.id)).toEqual(['estimate-on'])
      expect(n[0].text).toContain('3 studies')
      expect(n[0].text).toContain('PROJECTED')
      expect(choiceNotes(on, { estimated: 1 })[0].text).toContain('One study prints a PROJECTED')
    })

    it('says there was something to show when it is off', () => {
      // 3 dashes, all of them the withheld projections.
      const n = choiceNotes(off, { estimated: 3, noResponseFigure: 3 })
      expect(n.map(x => x.id)).toEqual(['estimate-off'])
      expect(n[0].text).toContain('Tick Final estimate')
      // AND NOT ALSO "3 studies print no response figure". Those rows are
      // dashes because the reader declined the projection, which the note
      // above has just said in more useful words; counting them twice reports
      // the same three studies as two different problems.
      expect(n.map(x => x.id)).not.toContain('no-response-figure')
    })

    /**
     * ── FOUND BY AN ADVERSARIAL REVIEW OF THIS COMMIT, 2026-09-29 ────────────
     *
     * The subtraction was guarded on `p.estimate`, which looked right and was
     * not: printsOf FORCES estimate=false whenever Final is off, so unticking
     * Final (with Target still on) fired the subtraction while suppressing the
     * note it was subtracting on behalf of. The panel then reported a dash
     * count short by exactly the number of projectable rows, and named none of
     * the missing ones. The guard is now "did that note actually fire".
     */
    it('subtracts only what the estimate note actually claimed, so Final-off does not lose rows', () => {
      const noFinal = printsOf(choice(['final']), 'statement')
      expect(noFinal.final).toBe(false)
      expect(noFinal.estimate).toBe(false)
      const n = choiceNotes(noFinal, { estimated: 2, noResponseFigure: 5 })
      // No estimate note (there is no Final column for a projection to sit in),
      // so all five dashes belong to the generic note.
      expect(n.map(x => x.id)).toEqual(['no-response-figure'])
      expect(n[0].text).toContain('5 studies')
      expect(n[0].text).not.toContain('3 studies')
    })

    it('still reports the dashes that are nothing to do with the tick', () => {
      // 5 dashes, 2 of which could have been projected. The other 3 are studies
      // that have not reached quality review and could never carry a figure.
      const n = choiceNotes(off, { estimated: 2, noResponseFigure: 5 })
      expect(n.map(x => x.id)).toEqual(['estimate-off', 'no-response-figure'])
      expect(n[1].text).toContain('3 studies')
    })

    it('says nothing at all when there is nothing to project', () => {
      expect(choiceNotes(on, { estimated: 0 })).toEqual([])
      expect(choiceNotes(off, { estimated: 0 })).toEqual([])
      // Nor when Final is off: there is no column for a projection to sit in,
      // and printsOf has already forced the tick off with it.
      expect(printsOf(choice(['final'], [], ['estimate']), 'statement').estimate).toBe(false)
      expect(choiceNotes(printsOf(choice(['final'], [], ['estimate']), 'statement'), { estimated: 3 })
        .map(x => x.id)).not.toContain('estimate-on')
    })
  })

  /**
   * ── ALSO FROM THAT REVIEW: THE ▼ WAS LEFT STRANDED ────────────────────────
   *
   * Removing the met/short tally took away the only legend for the
   * below-target mark outside the notes. With Notes unticked a client was left
   * with "▼ 940" and nothing on the page defining the triangle — and
   * UnexplainedMark had no case for it, so the warning that exists for exactly
   * this could not fire.
   */
  it('warns that the ▼ has nothing left to explain it once the notes are off', () => {
    const p = printsOf(SYSTEM_DEFAULT, 'statement')
    expect(choiceNotes(p, { unexplained: ['below'] })).toEqual([])
    const off = printsOf(choice([], ['notes']), 'statement')
    const n = choiceNotes(off, { unexplained: ['below'] })
    expect(n.map(x => x.id)).toEqual(['notes-off'])
    expect(n[0].text).toContain('the ▼')
  })

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
      expect(parseUrlChoice(doc, '-collected', null)).toEqual({ colsOff: [], colsOn: [] })
      // Nor through the opt-in half of a link, which is the new way in.
      expect(parseUrlChoice(doc, '*collected', null)).toEqual({ colsOff: [], colsOn: [] })
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
