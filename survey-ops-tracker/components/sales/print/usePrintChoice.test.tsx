import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePrintChoice } from './usePrintChoice'
import { parseUrlChoice, PRINT_CHOICE_KEY } from '@/lib/sales/printColumns'

/**
 * The live choice on the print page: the saved default applied after mount,
 * the link winning over it, the address bar following a change, and reset
 * forgetting the saved default.
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
    // Collected rides along because it is off in the system default this
    // choice started from — a link reproduces what is on the page, not just
    // what was clicked.
    expect(sp.get('cols')).toBe('-target,-collected')
    expect(sp.get('sections')).toBe('all')
    // What the address bar now says reproduces the choice.
    expect(parseUrlChoice('statement', sp.get('cols'), sp.get('sections')))
      .toEqual({ colsOff: ['target', 'collected'], sectionsOff: [] })
  })

  it('saves a default per document, and reset returns to the system default and forgets it', () => {
    const { result } = renderHook(() => usePrintChoice('statement', {}))
    act(() => result.current.controls.toggleSection('activity'))
    act(() => result.current.controls.save())
    expect(result.current.controls.source).toBe('saved')
    expect(result.current.controls.feedback).toBe('saved')
    // Collected is in the saved value because it is off on the page being
    // saved. That is what makes the stored shape unable to express "I want an
    // off-by-default column ON" — see PRINT_CHOICE_KEY, which was versioned to
    // v2 rather than have v1 values reinterpreted.
    expect(JSON.parse(localStorage.getItem(PRINT_CHOICE_KEY.statement) as string))
      .toEqual({ colsOff: ['collected'], sectionsOff: ['activity'] })
    expect(localStorage.getItem(PRINT_CHOICE_KEY.list)).toBeNull()

    act(() => result.current.controls.reset())
    expect(localStorage.getItem(PRINT_CHOICE_KEY.statement)).toBeNull()
    expect(result.current.prints.activity).toBe(true)
    // Reset goes to the SYSTEM default, which is not "everything".
    expect(result.current.prints.collected).toBe(false)
    expect(result.current.controls.source).toBe('system')
    expect(result.current.controls.hasSaved).toBe(false)
    expect(result.current.controls.feedback).toBe('reset')
  })

  it('offers Account only on a list that spans accounts', () => {
    const client = renderHook(() => usePrintChoice('list', {})).result.current.controls.columns.map(c => c.def.id)
    const internal = renderHook(() => usePrintChoice('list', {}, { internal: true })).result.current.controls.columns.map(c => c.def.id)
    expect(client).not.toContain('account')
    expect(internal[0]).toBe('account')
  })
})
