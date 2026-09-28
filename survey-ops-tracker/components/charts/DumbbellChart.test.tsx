import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DumbbellChart } from './DumbbellChart'
import { FONT } from './primitives'
import { textWidth } from './scale'
import { num } from './geometry.testutil'

// Invented routes and costs — not the book's.
interface Route {
  route: string
  perComplete: number
  perQualified: number
  removed: string
  box: { low: number; median: number; high: number }
}
const routes: Route[] = [
  { route: 'Route A', perComplete: 12, perQualified: 18, removed: 'QA removed 30%', box: { low: 9, median: 16, high: 25 } },
  { route: 'Route B', perComplete: 0.8, perQualified: 1.2, removed: 'QA removed 30%', box: { low: 0.6, median: 1, high: 1.9 } },
]
const base = {
  ariaLabel: 'Cost per respondent',
  data: routes,
  label: (d: Route) => d.route,
  start: (d: Route) => d.perComplete,
  end: (d: Route) => d.perQualified,
}
const dots = (c: HTMLElement, which: 'start' | 'end') => Array.from(c.querySelectorAll(`[data-mark="${which}"]`)).map((el) => num(el, 'cx'))

describe('DumbbellChart', () => {
  it('draws two dots, a box and a connector label per row', () => {
    const { container } = render(<DumbbellChart {...base} connectorLabel={(d) => d.removed} box={(d) => d.box} independentScales />)
    expect(container.querySelectorAll('[data-mark="start"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-mark="end"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-mark="box"]')).toHaveLength(2)
    expect(screen.getAllByText('QA removed 30%')).toHaveLength(2)
    // Cents under $10.
    expect(screen.getByText('$1.20')).toBeInTheDocument()
  })

  it('gives each row its own axis when asked, with dots in proportion on it', () => {
    const { container } = render(<DumbbellChart {...base} width={600} independentScales />)
    const s = dots(container, 'start')
    const e = dots(container, 'end')
    // Both axes start at $0 (x = 8): end ÷ start is the value ratio on each row.
    expect((e[0] - 8) / (s[0] - 8)).toBeCloseTo(18 / 12, 5)
    expect((e[1] - 8) / (s[1] - 8)).toBeCloseTo(1.2 / 0.8, 5)
    // The cheap route is NOT squashed into a dot at zero.
    expect(e[1]).toBeGreaterThan(300)
  })

  it('shares one axis when told to, and picks separate axes by itself for a 10× spread', () => {
    const { container, rerender } = render(<DumbbellChart {...base} width={600} independentScales={false} />)
    expect(dots(container, 'end')[1]).toBeLessThan(100)
    rerender(<DumbbellChart {...base} width={600} />)
    expect(dots(container, 'end')[1]).toBeGreaterThan(300)
  })

  it('never prints the two value labels on top of each other', () => {
    const near = [
      { ...routes[0], perComplete: 50, perQualified: 66 },
      { ...routes[1], perComplete: 1, perQualified: 1.6 },
    ]
    const { container } = render(<DumbbellChart {...base} data={near} width={390} independentScales={false} />)
    const starts = Array.from(container.querySelectorAll('[data-label="start"]'))
    const ends = Array.from(container.querySelectorAll('[data-label="end"]'))
    starts.forEach((st, i) => {
      const en = ends[i]
      const span = (el: Element) => {
        const w = textWidth(el.textContent ?? '', FONT.tick)
        const x = num(el, 'x')
        return el.getAttribute('text-anchor') === 'end' ? [x - w, x] : [x, x + w]
      }
      const [a0, a1] = span(st)
      const [b0, b1] = span(en)
      expect(a1 <= b0 || b1 <= a0).toBe(true)
      // …and both stay on the chart.
      expect(Math.min(a0, b0)).toBeGreaterThanOrEqual(0)
      expect(Math.max(a1, b1)).toBeLessThanOrEqual(390)
    })
  })

  it('drills a route with Enter, and names its table column', () => {
    const onSelect = vi.fn()
    render(<DumbbellChart {...base} labelHeader="Route" onSelect={onSelect} />)
    fireEvent.keyDown(screen.getByRole('button', { name: /^Route A/ }), { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(routes[0])
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }))
    expect(screen.getByRole('columnheader', { name: 'Route' })).toBeInTheDocument()
  })

  // The row rail exists to say which NAME owns which mark when the names sit
  // in a column beside them. Here each name is printed on its own line
  // directly above its own pair of dots, so there is nothing to disambiguate
  // — and the rail's only home was x=0, a label column away from anything.
  it('draws no row rail, because each name sits on its own line above its dots', () => {
    const { container } = render(<DumbbellChart {...base} />)
    expect(container.querySelectorAll('[data-tick="row"]')).toHaveLength(0)
    const names = Array.from(container.querySelectorAll('text')).filter((t) => t.textContent?.startsWith('Route '))
    expect(names).toHaveLength(2)
    expect(Number(names[1].getAttribute('y'))).toBeGreaterThan(Number(names[0].getAttribute('y')))
  })

  it('draws a short route name but keeps the full one on hover and in the table', () => {
    const { container } = render(
      <DumbbellChart {...base} labelShort={(d) => d.route.replace('Route ', '')} labelHeader="Route" sublabel={() => '44 surveys'} onSelect={() => {}} />,
    )
    const drawn = Array.from(container.querySelectorAll('text')).find((t) => t.textContent?.includes('Route A'))!
    expect(Array.from(drawn.childNodes).filter((n) => n.nodeName !== 'title').map((n) => n.textContent).join('')).toBe('A')
    expect(drawn.querySelector('title')!.textContent).toBe('Route A')
    fireEvent.mouseEnter(screen.getByRole('button', { name: /^Route A/ }))
    const card = container.querySelector('[aria-hidden].z-20') as HTMLElement
    expect(within(card).getByText('Route A')).toBeInTheDocument()
    // Hover carries the line under the name too, not just the two values.
    expect(within(card).getByText(/44 surveys/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }))
    expect(within(screen.getByRole('table')).getByRole('rowheader', { name: 'Route A' })).toBeInTheDocument()
  })

  it('shows the empty state when no row has a value', () => {
    render(<DumbbellChart {...base} data={[]} />)
    expect(screen.getByText('No data in this view')).toBeInTheDocument()
  })
})
