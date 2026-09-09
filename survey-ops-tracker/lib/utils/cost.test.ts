import { describe, it, expect } from 'vitest'
import { toCents, resolveCostMoney, projectSpendAfter, normalizeIdemKey } from './cost'

describe('normalizeIdemKey', () => {
  it('keeps a real key, trimmed', () => {
    expect(normalizeIdemKey('PR00402#zoominfo')).toBe('PR00402#zoominfo')
    expect(normalizeIdemKey('  PR00402#zoominfo  ')).toBe('PR00402#zoominfo')
  })

  it('treats empty and whitespace-only as NO key', () => {
    // The bug this exists for: "" was falsy at the existence probe but survived
    // `?? null` at the write, so it was stored as a real key that migration
    // 101's partial unique index enforces — and the next call with "" upserted
    // over the first line while reporting "created".
    expect(normalizeIdemKey('')).toBeNull()
    expect(normalizeIdemKey('   ')).toBeNull()
    expect(normalizeIdemKey('\t\n')).toBeNull()
  })

  it('treats absent and null as no key', () => {
    expect(normalizeIdemKey(undefined)).toBeNull()
    expect(normalizeIdemKey(null)).toBeNull()
  })

  it('is idempotent, so normalising twice is safe', () => {
    for (const k of ['x', ' x ', '', '  ', undefined]) {
      expect(normalizeIdemKey(normalizeIdemKey(k))).toBe(normalizeIdemKey(k))
    }
  })
})

describe('toCents', () => {
  it('kills the float dust that 0.07 x 22121 produces', () => {
    // The literal case from the handoff, and the reason this function exists:
    // 0.07 * 22121 === 1548.4700000000003 in IEEE 754.
    expect(0.07 * 22121).not.toBe(1548.47)
    expect(toCents(0.07 * 22121)).toBe(1548.47)
  })

  it('does not turn a sub-dollar rate into zero', () => {
    // A $0.02/send rate was once silently stored as 0 by an integer-rounding
    // helper. Nothing here may round toward the dollar.
    expect(toCents(0.02)).toBe(0.02)
    expect(toCents(0.07)).toBe(0.07)
    expect(toCents(0.005)).toBe(0.01)
  })

  it('rounds half-cents up rather than down into float dust', () => {
    expect(toCents(14.505)).toBe(14.51)
    expect(toCents(0.145)).toBe(0.15)
  })

  it('leaves whole and already-2dp figures alone', () => {
    expect(toCents(0)).toBe(0)
    expect(toCents(1876.7)).toBe(1876.7)
    expect(toCents(4486.81)).toBe(4486.81)
  })

  it('handles a negative figure symmetrically, for the projection path', () => {
    expect(toCents(-1548.4700000000003)).toBe(-1548.47)
  })
})

describe('resolveCostMoney', () => {
  it('takes a flat amount as invoiced', () => {
    const r = resolveCostMoney({ amount: 1876.7 })
    expect(r).toEqual({ ok: true, amount: 1876.7, quantity: null, fromUnitPair: false })
  })

  it('multiplies the unit pair, once, to the cent', () => {
    const r = resolveCostMoney({ unitCost: 0.07, quantity: 22121 })
    expect(r).toMatchObject({ ok: true, amount: 1548.47, quantity: 22121, fromUnitPair: true })
  })

  it('refuses a call that names no money at all', () => {
    const r = resolveCostMoney({})
    expect(r).toMatchObject({ ok: false, reason: 'no-money' })
  })

  it('refuses a call that gives only half of the unit pair and no amount', () => {
    expect(resolveCostMoney({ unitCost: 0.07 })).toMatchObject({ ok: false, reason: 'no-money' })
    expect(resolveCostMoney({ quantity: 22121 })).toMatchObject({ ok: false, reason: 'no-money' })
  })

  it('falls back to amount when only half the unit pair came along', () => {
    // quantity without a unit price is not a price — but it IS worth recording
    // as the number of units the flat amount covers.
    const r = resolveCostMoney({ amount: 1548.47, quantity: 22121 })
    expect(r).toMatchObject({ ok: true, amount: 1548.47, quantity: 22121, fromUnitPair: false })
  })

  it('accepts both forms when they agree', () => {
    const r = resolveCostMoney({ amount: 1548.47, unitCost: 0.07, quantity: 22121 })
    expect(r).toMatchObject({ ok: true, amount: 1548.47, fromUnitPair: true })
  })

  it('refuses both forms when they disagree, rather than picking one', () => {
    const r = resolveCostMoney({ amount: 1500, unitCost: 0.07, quantity: 22121 })
    expect(r).toMatchObject({ ok: false, reason: 'disagree' })
    if (!r.ok) {
      expect(r.message).toContain('1548.47')
      expect(r.message).toContain('1500.00')
    }
  })

  it('tolerates a half-cent of disagreement, since the caller rounded too', () => {
    const r = resolveCostMoney({ amount: 1548.47, unitCost: 0.07, quantity: 22121 })
    expect(r.ok).toBe(true)
  })

  it('treats a genuine zero as money, not as absent', () => {
    // 0 means "this genuinely cost nothing", which is a recordable fact and must
    // not fall through to the no-money branch the way null does.
    const r = resolveCostMoney({ amount: 0 })
    expect(r).toMatchObject({ ok: true, amount: 0 })
  })

  it('reads an explicit null as not-given, not as zero', () => {
    expect(resolveCostMoney({ amount: null })).toMatchObject({ ok: false, reason: 'no-money' })
    expect(resolveCostMoney({ amount: null, unitCost: null, quantity: null }))
      .toMatchObject({ ok: false, reason: 'no-money' })
  })

  it('prices a zero-quantity purchase at zero rather than refusing it', () => {
    const r = resolveCostMoney({ unitCost: 0.07, quantity: 0 })
    expect(r).toMatchObject({ ok: true, amount: 0, quantity: 0, fromUnitPair: true })
  })
})

describe('projectSpendAfter', () => {
  it('adds a new line to the running spend', () => {
    // PR00402: $2,938.34 of blasts, then the ZoomInfo line lands.
    expect(projectSpendAfter(2938.34, 0, 1548.47)).toBe(4486.81)
  })

  it('swaps a line rather than double-counting it on an update', () => {
    // The same line re-sent at a corrected figure must move spend by the
    // DIFFERENCE. Adding without subtracting the prior amount is the double
    // count that got reported as a real overspend twice.
    expect(projectSpendAfter(4486.81, 1548.47, 1600)).toBe(4538.34)
  })

  it('removes a line by projecting its amount as the new value of zero', () => {
    expect(projectSpendAfter(4486.81, 1548.47, 0)).toBe(2938.34)
  })

  it('reads an unrecorded actual_spend as zero, since a projection is a sum', () => {
    expect(projectSpendAfter(null, 0, 1548.47)).toBe(1548.47)
    expect(projectSpendAfter(undefined, null, 1548.47)).toBe(1548.47)
  })

  it('is exact across a chain of cent-level moves', () => {
    // Float drift accumulates; each step re-rounds so it cannot.
    let s = 0
    for (let i = 0; i < 100; i++) s = projectSpendAfter(s, 0, 0.07)
    expect(s).toBe(7)
  })
})
