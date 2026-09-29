import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePrintChoice } from './usePrintChoice'
import { CHOICE_SOURCE_TEXT, parseUrlChoice, PRINT_CHOICE_KEY } from '@/lib/sales/printColumns'

/**
 * The live choice on the print page: the saved default applied after mount,
 * the link winning over it, the address bar following a change, and reset
 * forgetting the saved default.
 *
 * ── 2026-09-29: COLLECTED IS GONE ───────────────────────────────────────────
 * Several of these tests used to describe a system default of "everything
 * except Collected" — a column that was off by default from 2026-09-28. David
 * closed that gap: "lets actually remove 'collected' from all views from now …
 * a client doesnt need to know that and i dont want to risk a sales person
 * sending it." The column is deleted from PRINT_COLUMNS, so the system default
 * is empty again and every assertion that used to watch Collected ride along
 * with a choice now watches that it CANNOT. The last describe block below is
 * the one that matters: it walks every route into this hook — a saved default,
 * a current link, a retired link, a tick — and proves none of them can put the
 * column back.
 */
beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/sales/accounts/cl-1/print?basis=delivered&preset=qtd')
})

describe('usePrintChoice', () => {
  it('starts from everything, and from the saved default once mounted', () => {
    localStorage.setItem(PRINT_CHOICE_KEY.statement, JSON.stringify({ colsOff: ['requested'], sectionsOff: ['notes'] }))
    const { result } = renderHook(() => usePrintChoice('statement', {}))
    expect(result.current.prints.requested).toBe(false)
    expect(result.current.prints.notes).toBe(false)
    expect(result.current.controls.source).toBe('saved')
    // Opening the page with a saved default does not rewrite the link.
    expect(window.location.search).toBe('?basis=delivered&preset=qtd')
  })

  it('lets the link win over the saved default', () => {
    localStorage.setItem(PRINT_CHOICE_KEY.statement, JSON.stringify({ colsOff: ['requested'], sectionsOff: ['notes'] }))
    const url = parseUrlChoice('statement', 'all', null)
    const { result } = renderHook(() => usePrintChoice('statement', url))
    expect(result.current.prints.requested).toBe(true)      // from the link
    expect(result.current.prints.notes).toBe(false)         // the link says nothing about sections
  })

  it('writes a change into the address bar, keeping the other parameters', () => {
    const { result } = renderHook(() => usePrintChoice('statement', {}))
    act(() => result.current.controls.toggleColumn('target'))
    expect(result.current.prints.target).toBe(false)
    expect(result.current.controls.source).toBe('custom')
    const sp = new URLSearchParams(window.location.search)
    expect(sp.get('preset')).toBe('qtd')
    // ONLY what was clicked is in the link now. This assertion read
    // '-target,-collected' until 2026-09-29, and the comment explained that
    // Collected rode along because the system default this choice started from
    // had it off — a link reproduces what is ON THE PAGE, not just what was
    // clicked. That rule has not changed; what changed is the page. With
    // Collected removed from PRINT_COLUMNS the system default turns nothing
    // off, so there is nothing to ride along, and a link that named the column
    // would be a link that could put it back.
    expect(sp.get('cols')).toBe('-target')
    expect(sp.get('sections')).toBe('all')
    expect(window.location.search).not.toMatch(/collected/i)
    // What the address bar now says reproduces the choice.
    expect(parseUrlChoice('statement', sp.get('cols'), sp.get('sections')))
      .toEqual({ colsOff: ['target'], sectionsOff: [] })
  })

  it('saves a default per document, and reset returns to the system default and forgets it', () => {
    const { result } = renderHook(() => usePrintChoice('statement', {}))
    act(() => result.current.controls.toggleSection('activity'))
    act(() => result.current.controls.save())
    expect(result.current.controls.source).toBe('saved')
    expect(result.current.controls.feedback).toBe('saved')
    // The saved value names ONLY the section that was unticked. It used to
    // carry 'collected' as well, because a stored choice is a list of what is
    // off on the page being saved and Collected was off there. That is what
    // made the stored shape unable to express "I want an off-by-default column
    // ON", and it is why PRINT_CHOICE_KEY was versioned to v2 rather than have
    // v1 values reinterpreted. As of 2026-09-29 no column is off by default,
    // so a saved value is once again only what this person deselected — and
    // the shape's one weakness is now a safety property: a list of what is OFF
    // has no way to ask for a column that no longer exists.
    expect(JSON.parse(localStorage.getItem(PRINT_CHOICE_KEY.statement) as string))
      .toEqual({ colsOff: [], sectionsOff: ['activity'] })
    expect(localStorage.getItem(PRINT_CHOICE_KEY.statement)).not.toMatch(/collected/i)
    expect(localStorage.getItem(PRINT_CHOICE_KEY.list)).toBeNull()

    act(() => result.current.controls.reset())
    expect(localStorage.getItem(PRINT_CHOICE_KEY.statement)).toBeNull()
    expect(result.current.prints.activity).toBe(true)
    // Reset goes to the SYSTEM default, and the system default IS "everything"
    // again — the line under the checkboxes says so in as many words, and that
    // sentence is only true while no column is quietly held back. Every tick on
    // offer comes back on, and the flags are spelled out in full so that a
    // column added to the document later has to be accounted for here (and so
    // that a `collected` flag creeping back would fail this equality, not
    // silently pass an `every(Boolean)`).
    expect(result.current.controls.columns.every(c => c.on)).toBe(true)
    expect(result.current.controls.sections.every(s => s.on)).toBe(true)
    expect(result.current.prints).toEqual({
      // `account` is not a statement column at all — a statement is one
      // account — so it is false whatever is ticked. Everything the document
      // HAS prints.
      account: false,
      requested: true, status: true, target: true, final: true, credits: true,
      contract: true, activity: true, notes: true,
    })
    expect(result.current.controls.source).toBe('system')
    expect(CHOICE_SOURCE_TEXT.system).toBe('Using the system default: everything prints.')
    expect(result.current.controls.hasSaved).toBe(false)
    expect(result.current.controls.feedback).toBe('reset')
  })

  it('offers Account only on a list that spans accounts', () => {
    const client = renderHook(() => usePrintChoice('list', {})).result.current.controls.columns.map(c => c.def.id)
    const internal = renderHook(() => usePrintChoice('list', {}, { internal: true })).result.current.controls.columns.map(c => c.def.id)
    expect(client).not.toContain('account')
    expect(internal[0]).toBe('account')
  })

  /**
   * ── THE COLUMN CANNOT COME BACK (2026-09-29) ──────────────────────────────
   *
   * Removing a column from PRINT_COLUMNS is only half of it. This hook takes a
   * choice from three places — a link, a saved default in this browser, and a
   * tick in the pre-send panel — and every one of them speaks in column ids
   * that arrived from OUTSIDE the deployed code: a bookmarked link a client or
   * a salesperson kept, a value written into localStorage by a build that still
   * had the column. The risk David named was a salesperson sending a document
   * with the pre-quality-review field count on it. "Off by default" does not
   * answer that; "there is no such column, whatever you say to it" does.
   *
   * So these are not "Collected is off" tests. Each one feeds the hook a value
   * that names the column and asserts the column is not merely unticked but
   * absent: absent from what the panel offers, absent from the flags a document
   * is rendered from, and absent from the link the page writes back.
   */
  describe('Collected cannot come back', () => {
    it('is not on offer, on either document, in either mode', () => {
      for (const c of [
        renderHook(() => usePrintChoice('statement', {})).result.current.controls,
        renderHook(() => usePrintChoice('list', {})).result.current.controls,
        renderHook(() => usePrintChoice('list', {}, { internal: true })).result.current.controls,
      ]) {
        expect(c.columns.map(x => x.def.id)).not.toContain('collected')
        // Not in the words either: a tick labelled or explained with the old
        // column sends a salesperson hunting the panel for something that is
        // not there, which is exactly what choiceNotes' response note stopped
        // doing on the same day.
        const copy = [
          ...c.columns.flatMap(x => [x.def.label, x.def.help]),
          ...c.sections.flatMap(x => [x.def.label, ...Object.values(x.def.help)]),
        ].join(' ')
        expect(copy).not.toMatch(/collected/i)
      }
      // The flags a document renders from carry no such field, at run time as
      // well as in the type: Ledger, Notes and the summaries all branch on
      // these, so a stray `prints.collected` would be undefined-falsey and
      // silent rather than a build error.
      const { prints } = renderHook(() => usePrintChoice('statement', {})).result.current
      expect(Object.keys(prints)).not.toContain('collected')
    })

    it('survives a saved default written when the column still existed', () => {
      // v2 storage from the one day the column was merely off by default, plus
      // a real deselection so this proves the unknown id is DROPPED rather than
      // the whole value being thrown away — an older value must still lose only
      // the part that no longer means anything.
      localStorage.setItem(PRINT_CHOICE_KEY.statement,
        JSON.stringify({ colsOff: ['collected', 'target'], sectionsOff: ['notes'] }))
      const { result } = renderHook(() => usePrintChoice('statement', {}))
      expect(result.current.controls.hasSaved).toBe(true)
      expect(result.current.prints.target).toBe(false)      // the real part survived
      expect(result.current.prints.notes).toBe(false)
      expect(result.current.prints.final).toBe(true)        // and nothing else was collateral
      expect(Object.keys(result.current.prints)).not.toContain('collected')
      // And saving again rewrites the value without it, so the stale id does
      // not sit in this browser waiting for a future column to reuse the name.
      act(() => result.current.controls.save())
      expect(localStorage.getItem(PRINT_CHOICE_KEY.statement)).not.toMatch(/collected/i)
    })

    it('ignores a current-style link that names it, and never writes one', () => {
      const url = parseUrlChoice('statement', '-collected,-target', null)
      // The token is dropped, not honoured and not fatal: the rest of the link
      // still means what it says. (No `sectionsOff` key — a link carries only
      // the parts it names, and this one names no sections.)
      expect(url).toEqual({ colsOff: ['target'] })
      const { result } = renderHook(() => usePrintChoice('statement', url))
      expect(result.current.prints.target).toBe(false)
      expect(result.current.prints.final).toBe(true)
      // Untick everything the panel offers. Even the most switched-off document
      // this hook can produce writes a link with no such token in it, so no
      // link copied off this page can carry the column to the next reader.
      const ids = result.current.controls.columns.map(c => c.def.id)
      for (const id of ids) {
        if (result.current.controls.columns.find(c => c.def.id === id)?.on) {
          act(() => result.current.controls.toggleColumn(id))
        }
      }
      expect(Object.values(result.current.prints).some(Boolean)).toBe(true) // sections still print
      expect(new URLSearchParams(window.location.search).get('cols'))
        .toBe('-requested,-status,-target,-final,-credits')
      expect(window.location.search).not.toMatch(/collected/i)
    })

    it('reads the retired link token "collected" as Final, which is what it always meant', () => {
      // The one place the word survives on purpose (printColumns' LEGACY map).
      // A retired link listed what was ON, and its single "Collected" column
      // showed the FINAL count once a survey was delivered — so the token maps
      // to `final`. It is a bookmark from the first PDF export, not the column:
      // honouring the literal word would be the bookmark putting the pre-QA
      // count back on a client document, which is the exact thing 2026-09-29
      // removed.
      const url = parseUrlChoice('statement', 'collected,credits', null)
      expect(url).toEqual({ colsOff: ['requested', 'target'], legacy: true })
      const { result } = renderHook(() => usePrintChoice('statement', url))
      expect(result.current.prints.final).toBe(true)
      expect(result.current.prints.credits).toBe(true)
      expect(result.current.prints.requested).toBe(false)
      expect(result.current.prints.target).toBe(false)
      expect(result.current.prints.status).toBe(true)       // always shown then, so it stays on
      expect(result.current.controls.source).toBe('link')
      // And the moment anything is ticked, the retired link is rewritten in the
      // current spelling, so the word does not propagate any further.
      act(() => result.current.controls.toggleColumn('status'))
      expect(new URLSearchParams(window.location.search).get('cols'))
        .toBe('-requested,-status,-target')
      expect(window.location.search).not.toMatch(/collected/i)
    })
  })
})
