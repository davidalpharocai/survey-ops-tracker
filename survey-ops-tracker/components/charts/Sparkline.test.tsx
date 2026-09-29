import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Sparkline, describeTrend } from './Sparkline'
import { fmtCount } from './format'

describe('Sparkline', () => {
  it('draws a line with an accessible trend summary', () => {
    const { container } = render(
      <Sparkline ariaLabel="Surveys delivered" values={[12, 15, 21, 18]} labels={['Jun', 'Jul', 'Aug', 'Sep']} />,
    )
    expect(container.querySelectorAll('[data-mark="spark"]')).toHaveLength(1)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Surveys delivered. From 12 (Jun) to 18 (Sep), peak 21 (Aug).')
  })

  it('says so when there is no data, instead of drawing a flat line', () => {
    render(<Sparkline ariaLabel="Surveys delivered" values={[null, null]} />)
    expect(screen.getByText('No trend yet')).toBeInTheDocument()
  })

  it('describes a single value and a goal', () => {
    expect(describeTrend([7], ['Sep'], fmtCount, 10)).toBe('7 (Sep); goal 10.')
  })

  /* ── READING ONE POINT ────────────────────────────────────────────────────
   * The tile trend is the first graphic on /insights, so it is the one a
   * reader points at first. It used to answer nothing at all. */

  const months = ['Jun', 'Jul', 'Aug', 'Sep']
  const readable = (onActive: (i: number | null) => void, extra: Record<string, unknown> = {}) =>
    render(
      <Sparkline ariaLabel="Surveys delivered" values={[12, 15, 21, 18]} labels={months} width={120} onActive={onActive} {...extra} />,
    )

  it('reports the point under the pointer, and lets it go on the way out', () => {
    const onActive = vi.fn()
    const { container } = readable(onActive)
    fireEvent.mouseEnter(container.querySelector('[data-spark-hit="2"]')!)
    expect(onActive).toHaveBeenLastCalledWith(2)
    // The crosshair says WHICH point is being read, on the point itself.
    const cross = container.querySelector('[data-part="spark-active"] line')!
    const dot = container.querySelector('[data-part="spark-active"] circle')!
    expect(Number(cross.getAttribute('x1'))).toBeCloseTo(Number(dot.getAttribute('cx')), 5)

    fireEvent.mouseEnter(container.querySelector('[data-spark-hit="3"]')!)
    expect(onActive).toHaveBeenLastCalledWith(3)
    // Crossing between two bands does not clear it; leaving the strip does.
    fireEvent.mouseLeave(container.querySelector('[data-part="spark-hits"]')!)
    expect(onActive).toHaveBeenLastCalledWith(null)
    expect(container.querySelector('[data-part="spark-active"]')).toBeNull()
  })

  it('every pixel of the trend belongs to a month, so a hover anywhere answers', () => {
    const { container } = readable(() => {})
    const bands = [...container.querySelectorAll('[data-spark-hit]')].map(r => ({
      x: Number(r.getAttribute('x')),
      w: Number(r.getAttribute('width')),
    }))
    expect(bands).toHaveLength(4)
    expect(bands[0].x).toBe(0)
    expect(bands[3].x + bands[3].w).toBe(120)
    bands.forEach((b, i) => {
      if (i > 0) expect(b.x).toBeCloseTo(bands[i - 1].x + bands[i - 1].w, 5)
      expect(b.w).toBeGreaterThan(0)
    })
  })

  it('walks the months with the arrow keys once the trend has focus', () => {
    const onActive = vi.fn()
    const { container } = readable(onActive)
    const svg = container.querySelector('svg')!
    // Focus starts on the newest month — the one the tile's big number is about.
    fireEvent.focus(svg)
    expect(onActive).toHaveBeenLastCalledWith(3)
    fireEvent.keyDown(svg, { key: 'ArrowLeft' })
    expect(onActive).toHaveBeenLastCalledWith(2)
    fireEvent.keyDown(svg, { key: 'Home' })
    expect(onActive).toHaveBeenLastCalledWith(0)
    // Nothing before the first month.
    fireEvent.keyDown(svg, { key: 'ArrowLeft' })
    expect(onActive).toHaveBeenLastCalledWith(0)
    fireEvent.blur(svg)
    expect(onActive).toHaveBeenLastCalledWith(null)
  })

  it('marks where the chosen dates begin, and says so in its accessible name', () => {
    const { container } = readable(() => {}, { boundary: 2 })
    const rule = container.querySelector('[data-part="range-start"]')!
    const dots = [...container.querySelectorAll('circle')]
    // The rule stands on Aug, the third of four months.
    expect(Number(rule.getAttribute('x1'))).toBeCloseTo(4 + (2 / 3) * 112, 5)
    expect(dots.length).toBeGreaterThan(0)
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Your dates start at Aug.')
  })

  it('draws no boundary when the whole trend is inside the dates', () => {
    const { container } = readable(() => {}, { boundary: 0 })
    expect(container.querySelector('[data-part="range-start"]')).toBeNull()
    expect(screen.getByRole('img').getAttribute('aria-label')).not.toContain('Your dates start')
  })

  it('stays inert — no tab stop, no hit bands — when nobody wants the readout', () => {
    const { container } = render(<Sparkline ariaLabel="Surveys delivered" values={[1, 2, 3]} width={120} />)
    expect(container.querySelector('[data-spark-hit]')).toBeNull()
    expect(container.querySelector('svg')!.getAttribute('tabindex')).toBeNull()
  })
})
