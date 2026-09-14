import { describe, it, expect } from 'vitest'
import { moneySources } from './moneySources'

/**
 * Guards which money widgets a project shows.
 *
 * The case that matters is the one that was broken: a project holding rows the
 * page refused to render. Ten projects were in that state on 2026-09-14, between
 * them $20,197.73 of spend with no section that could explain it.
 */

const base = { projectType: null as string | null, hasBlasts: false, hasPS: false, alsoPS: false, alsoBlasts: false }

describe('moneySources: the label still works', () => {
  it('a PS project shows suppliers', () => {
    expect(moneySources({ ...base, projectType: 'PS' })).toEqual({ showSuppliers: true, showBlasts: false })
  })

  it('a B2B project shows blasts', () => {
    expect(moneySources({ ...base, projectType: 'B2B' })).toEqual({ showSuppliers: false, showBlasts: true })
  })

  it('legacy Rerun and untyped rows still show both', () => {
    // They predate the type/dimension split and never mapped cleanly; dropping
    // Money for them would be worse than showing one widget too many.
    expect(moneySources({ ...base, projectType: 'Rerun' })).toEqual({ showSuppliers: true, showBlasts: true })
    expect(moneySources({ ...base, projectType: null })).toEqual({ showSuppliers: true, showBlasts: true })
  })
})

describe('moneySources: existence beats the label', () => {
  it('shows suppliers on a B2B project that HAS supplier rows', () => {
    // PR00230 (BofA - Grace) and PR00197 (Holocene) were exactly this: typed
    // B2B, holding 15 and 20 supplier rows the page rendered nowhere.
    expect(moneySources({ ...base, projectType: 'B2B', hasPS: true }))
      .toEqual({ showSuppliers: true, showBlasts: true })
  })

  it('shows blasts on a PS project that HAS blasts', () => {
    // PR00292, PR00279, PR00293, PR00441 — typed PS, holding blasts that were
    // 100% of the spend figure the page displayed.
    expect(moneySources({ ...base, projectType: 'PS', hasBlasts: true }))
      .toEqual({ showSuppliers: true, showBlasts: true })
  })

  it('never hides a source that has rows, whatever the type says', () => {
    for (const projectType of ['PS', 'B2B', 'Rerun', null]) {
      const m = moneySources({ ...base, projectType, hasBlasts: true, hasPS: true })
      expect(m).toEqual({ showSuppliers: true, showBlasts: true })
    }
  })
})

describe('moneySources: starting a mixed project', () => {
  it('lets a B2B project opt into PureSpectrum before any row exists', () => {
    // The PR00425 case: 5 blasts covering 10 completes against n_collected of
    // 1,019. Until this, there was nowhere to put the other 1,009.
    expect(moneySources({ ...base, projectType: 'B2B', alsoPS: true }))
      .toEqual({ showSuppliers: true, showBlasts: true })
  })

  it('lets a PS project opt into blasts before any row exists', () => {
    expect(moneySources({ ...base, projectType: 'PS', alsoBlasts: true }))
      .toEqual({ showSuppliers: true, showBlasts: true })
  })

  it('opting in never takes the original source away', () => {
    const m = moneySources({ ...base, projectType: 'PS', hasPS: true, alsoBlasts: true })
    expect(m.showSuppliers).toBe(true)
  })
})
