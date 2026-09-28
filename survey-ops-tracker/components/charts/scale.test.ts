import { describe, it, expect } from 'vitest'
import { fitText, labelStep, linear, niceDomain, niceStep, roundedBar } from './scale'

describe('niceDomain', () => {
  it('rounds out to human ticks and includes zero', () => {
    const d = niceDomain(12, 97)
    expect(d.min).toBe(0)
    expect(d.max).toBe(100)
    expect(d.ticks).toEqual([0, 20, 40, 60, 80, 100])
  })

  it('gives all-zero data a 0..1 axis so the baseline still draws', () => {
    const d = niceDomain(0, 0)
    expect(d.min).toBe(0)
    expect(d.max).toBeGreaterThan(0)
  })

  it('handles a single positive value and negative-only data', () => {
    expect(niceDomain(7, 7).min).toBe(0)
    expect(niceDomain(7, 7).max).toBeGreaterThanOrEqual(7)
    const neg = niceDomain(-1234, -56)
    expect(neg.max).toBe(0)
    expect(neg.min).toBeLessThanOrEqual(-1234)
  })

  it('spans a diverging range across zero', () => {
    const d = niceDomain(-450, 1200)
    expect(d.min).toBeLessThan(0)
    expect(d.ticks).toContain(0)
    expect(d.max).toBeGreaterThanOrEqual(1200)
  })

  it('never emits floating-point noise or -0 in ticks', () => {
    const d = niceDomain(0, 0.3)
    for (const t of d.ticks) expect(String(t)).not.toMatch(/0000|-0$/)
    expect(Object.is(niceDomain(-1, 1).ticks.find((t) => t === 0), -0)).toBe(false)
  })

  it('can leave zero out for a narrow band', () => {
    const d = niceDomain(0.9, 0.98, { includeZero: false })
    expect(d.min).toBeGreaterThan(0.5)
  })
})

describe('niceStep / linear', () => {
  it('picks 1, 2, 2.5 or 5 times a power of ten', () => {
    expect(niceStep(100, 5)).toBe(20)
    expect(niceStep(1, 4)).toBe(0.25)
    expect(niceStep(0, 5)).toBe(1)
  })

  it('maps a domain onto pixels and survives a zero span', () => {
    const x = linear([0, 10], [0, 100])
    expect(x(5)).toBe(50)
    expect(linear([3, 3], [0, 100])(3)).toBe(50)
  })
})

describe('label fitting', () => {
  it('leaves a short label alone and cuts a long one with an ellipsis', () => {
    expect(fitText('Aug', 100, 11)).toEqual({ text: 'Aug', truncated: false })
    const cut = fitText('Prime Insights API Marketplace', 60, 11)
    expect(cut.truncated).toBe(true)
    expect(cut.text.endsWith('…')).toBe(true)
  })

  it('thins labels that would collide', () => {
    expect(labelStep(['Jan', 'Feb', 'Mar'], 80, 11)).toBe(1)
    expect(labelStep(['January 2026', 'February 2026'], 20, 11)).toBeGreaterThan(1)
  })
})

describe('roundedBar', () => {
  it('draws a closed path, and a plain rectangle when there is no length', () => {
    expect(roundedBar(0, 0, 20, 50, 'top')).toMatch(/^M.*Z$/)
    expect(roundedBar(0, 0, 0, 50, 'top')).toBe('M0,0h0v50h0Z')
  })
})
