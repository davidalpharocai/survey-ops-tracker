import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { LineChart } from './LineChart'
import { fmtPct } from './format'
import { num } from './geometry.testutil'

interface P {
  m: string
  onTime: number | null
  cycle: number | null
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pts: P[] = [
  { m: 'May', onTime: 0.71, cycle: 14 },
  { m: 'Jun', onTime: 0.78, cycle: 12 },
  { m: 'Jul', onTime: null, cycle: 11 },
  { m: 'Aug', onTime: 0.86, cycle: 9 },
  { m: 'Sep', onTime: 0.9, cycle: 8 },
]

describe('LineChart', () => {
  it('draws a marker per value and breaks the line at a missing value', () => {
    const { container } = render(
      <LineChart ariaLabel="On-time" data={pts} x={(d) => d.m} series={[{ key: 'ot', label: 'On time', value: (d) => d.onTime }]} valueFormat={(v) => fmtPct(v)} />,
    )
    expect(container.querySelectorAll('[data-mark="point"]')).toHaveLength(4)
    // May–Jun and Aug–Sep: two separate segments, not one line through July.
    expect(container.querySelectorAll('[data-mark="line"]')).toHaveLength(2)
  })

  it('draws one line per series with a legend', () => {
    const { container } = render(
      <LineChart
        ariaLabel="Trends"
        data={pts}
        x={(d) => d.m}
        series={[
          { key: 'a', label: 'Cycle days', value: (d) => d.cycle },
          { key: 'b', label: 'Other', value: (d) => (d.cycle == null ? null : d.cycle + 3) },
        ]}
      />,
    )
    expect(container.querySelectorAll('[data-mark="line"]')).toHaveLength(2)
    expect(screen.getByText('Cycle days')).toBeInTheDocument()
  })

  it('draws labelled vertical rules and a goal line', () => {
    render(
      <LineChart
        ariaLabel="On-time"
        data={pts}
        x={(d) => d.m}
        series={[{ key: 'ot', label: 'On time', value: (d) => d.onTime }]}
        referenceLines={[{ value: 0.85, label: 'Goal 85%' }]}
        rules={[{ at: 'Jun', label: 'New intake form' }]}
      />,
    )
    expect(screen.getByText('New intake form')).toBeInTheDocument()
    expect(screen.getAllByText('Goal 85%').length).toBeGreaterThan(0)
  })

  it('places points in proportion to their values', () => {
    const data = [
      { m: 'A', v: 0 },
      { m: 'B', v: 10 },
      { m: 'C', v: 20 },
    ]
    const { container } = render(<LineChart ariaLabel="V" data={data} x={(d) => d.m} series={[{ key: 'v', label: 'V', value: (d) => d.v }]} yDomain={[0, 40]} />)
    const [c0, c1, c2] = Array.from(container.querySelectorAll('[data-mark="point"]')).map((p) => num(p, 'cy'))
    // y grows downward in SVG: 20 sits twice as far above zero as 10.
    expect((c0 - c2) / (c0 - c1)).toBeCloseTo(2, 5)
  })

  it('does not repeat a goal value the label already prints', () => {
    const { container } = render(
      <LineChart
        ariaLabel="On-time"
        data={pts}
        x={(d) => d.m}
        series={[{ key: 'ot', label: 'On time', value: (d) => d.onTime }]}
        valueFormat={(v) => fmtPct(v)}
        referenceLines={[{ value: 0.85, label: 'Goal 85%' }]}
        rules={[{ at: 'Jun', label: 'New intake form' }]}
      />,
    )
    const label = container.querySelector('svg')!.getAttribute('aria-label')!
    expect(label).toContain('Goal 85%')
    expect(label).not.toContain('at 85%')
    expect(label).toContain('New intake form (from Jun)')
  })

  it('matches rules by period key and lists notes in the table', () => {
    const data = [
      { k: '2025-09', m: 'Sep', v: 3 },
      { k: '2025-10', m: 'Oct', v: 4 },
      { k: '2026-09', m: 'Sep', v: 5 },
    ]
    const { container } = render(
      <LineChart
        ariaLabel="V"
        width={600}
        data={data}
        x={(d) => d.m}
        xKey={(d) => d.k}
        series={[{ key: 'v', label: 'V', value: (d) => d.v }]}
        rules={[{ at: '2026-09', label: 'new form' }]}
        note={(d) => (d.k === '2025-10' ? 'Half month' : null)}
      />,
    )
    const rule = container.querySelector('line[stroke-dasharray="3 3"]')!
    expect(num(rule, 'x1')).toBeGreaterThan(num(within(container).getByText('Oct'), 'x'))
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }))
    expect(within(screen.getByRole('table')).getByText('Half month')).toBeInTheDocument()
  })

  it('drills per period with the keyboard', () => {
    const onSelect = vi.fn()
    render(
      <LineChart ariaLabel="On-time" data={pts} x={(d) => d.m} series={[{ key: 'ot', label: 'On time', value: (d) => d.onTime }]} onSelect={onSelect} />,
    )
    fireEvent.keyDown(screen.getByRole('button', { name: /^Aug/ }), { key: ' ' })
    expect(onSelect).toHaveBeenCalledWith(pts[3])
  })

  // The Last-12-months window: every label carries a year, so the axis MUST
  // thin them at the width /insights renders these at (two per row).
  const months = [
    '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
    '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
  ].map((k, i) => ({ k, long: `${MON[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`, short: `${MON[Number(k.slice(5)) - 1]} ${k.slice(2, 4)}`, v: 10 + i }))
  const twelve = {
    ariaLabel: 'Trend',
    data: months,
    width: 380,
    x: (d: (typeof months)[number]) => d.long,
    xKey: (d: (typeof months)[number]) => d.k,
    series: [{ key: 'v', label: 'Value', value: (d: (typeof months)[number]) => d.v }],
  }
  /** What the axis actually PRINTS: the <title> a shortened label carries is
   *  part of textContent, and would otherwise be counted as drawn words. */
  const axisTexts = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('text'))
      .map((t) => Array.from(t.childNodes).filter((n) => n.nodeName !== 'title').map((n) => n.textContent).join(''))
      .filter(Boolean)

  it('gives every period a tick, even the periods whose label had to be thinned', () => {
    const { container } = render(<LineChart {...twelve} />)
    const ticks = container.querySelectorAll('[data-part="category-ticks"] line')
    expect(ticks).toHaveLength(12)
    // This width cannot fit twelve "Oct 2025"s, so the thinning is real…
    const plain = container.querySelectorAll('[data-tick="plain"]')
    expect(plain.length).toBeGreaterThan(0)
    // …and every tick still stands under its own point.
    const xs = Array.from(ticks).map((t) => num(t, 'x1'))
    const pts = Array.from(container.querySelectorAll('[data-mark="point"]')).map((p) => num(p, 'cx'))
    expect(xs).toEqual(pts)
  })

  it('always names the first and last period, so a 12-month window is readable', () => {
    const { container } = render(<LineChart {...twelve} />)
    const texts = axisTexts(container)
    expect(texts).toContain('Oct 2025')
    expect(texts).toContain('Sep 2026')
  })

  it('shows a thinned period its full name and value on hover', () => {
    const { container } = render(<LineChart {...twelve} onSelect={() => {}} />)
    // Feb 2026 is thinned off the axis at this width…
    expect(axisTexts(container)).not.toContain('Feb 2026')
    // …but hovering its band still names it, with the value.
    fireEvent.mouseEnter(screen.getByRole('button', { name: /^Feb 2026/ }))
    const card = screen.getByText('Feb 2026').closest('[aria-hidden]') as HTMLElement
    expect(within(card).getByText('14')).toBeInTheDocument()
  })

  it('draws the short form on the axis and keeps the long one on it as a title', () => {
    const { container } = render(<LineChart {...twelve} xShort={(d) => d.short} xLabel="Month" />)
    const texts = axisTexts(container)
    expect(texts).toContain('Sep 26')
    expect(texts).not.toContain('Sep 2026')
    // The shortened label carries the full month, so hovering the axis text
    // itself recovers it.
    const sep = Array.from(container.querySelectorAll('text')).find((t) => t.textContent === 'Sep 2026Sep 26')!
    expect(sep.querySelector('title')!.textContent).toBe('Sep 2026')
  })

  // 534px is what /insights actually gives these two charts at EVERY desktop
  // width: main px-6 → mx-auto max-w-6xl 1152 → md:grid-cols-2 gap-4 → 568 →
  // the card's border and px-4 → 534. Above a ~1200px viewport the cap binds,
  // so a 1280, a 1440 and a 1920 screen all land here. The `width` prop
  // short-circuits useChartWidth, which jsdom (no ResizeObserver) would
  // otherwise leave at the 640 default — a width the page never renders at.
  const INSIGHTS_PANEL = 534

  it('names all twelve months at the width /insights renders it, both trend charts', () => {
    // On time: a percent axis and an "83%" end label.
    const onTime = render(
      <LineChart {...twelve} width={INSIGHTS_PANEL} xShort={(d) => d.short} yDomain={[0, 1]}
        series={[{ key: 'ot', label: 'On time', value: (d) => d.v / 30 }]} valueFormat={(v) => `${Math.round(v * 100)}%`} />,
    )
    // Median cycle time: a wider "12 days" end label, which eats more of the plot.
    const cycle = render(
      <LineChart {...twelve} width={INSIGHTS_PANEL} xShort={(d) => d.short}
        series={[{ key: 'cy', label: 'Median days', value: (d) => d.v }]} valueFormat={(v) => `${v} days`} axisFormat={(v) => `${v}`} />,
    )
    for (const c of [onTime.container, cycle.container]) {
      expect(c.querySelectorAll('[data-tick="labelled"]')).toHaveLength(12)
      expect(c.querySelectorAll('[data-tick="plain"]')).toHaveLength(0)
    }
    // And the same twelve, so a reader can read across the pair.
    const drawn = (c: HTMLElement) => axisTexts(c).filter((t) => /^[A-Z][a-z]{2} \d{2}$/.test(t))
    expect(drawn(onTime.container)).toEqual(drawn(cycle.container))
    expect(drawn(onTime.container)).toContain('Oct 25')
    expect(drawn(onTime.container)).toContain('Sep 26')
  })

  it('fits more periods on the axis once the labels are shortened', () => {
    const long = render(<LineChart {...twelve} width={INSIGHTS_PANEL} />)
    const short = render(<LineChart {...twelve} width={INSIGHTS_PANEL} xShort={(d) => d.short} />)
    const named = (c: HTMLElement) => c.querySelectorAll('[data-tick="labelled"]').length
    expect(named(short.container)).toBeGreaterThan(named(long.container))
    // Either way every period keeps a tick — nothing goes unmarked.
    expect(long.container.querySelectorAll('[data-part="category-ticks"] line')).toHaveLength(12)
    expect(short.container.querySelectorAll('[data-part="category-ticks"] line')).toHaveLength(12)
  })

  it('keeps the newest period inside the chart rather than cutting it off', () => {
    const { container } = render(<LineChart {...twelve} width={300} xShort={(d) => d.short} />)
    const svg = container.querySelector('svg')!
    const W = Number(svg.getAttribute('width'))
    const last = Array.from(container.querySelectorAll('text')).find((t) => t.textContent?.endsWith('Sep 26'))!
    // anchor=middle, so the glyphs run half a label each side of x.
    expect(Number(last.getAttribute('x'))).toBeLessThanOrEqual(W)
    expect(container.querySelectorAll('[data-tick="labelled"]').length).toBeGreaterThan(0)
  })

  it('carries the LONG label into the table, even when the axis is short', () => {
    render(<LineChart {...twelve} xShort={(d) => d.short} xLabel="Month" />)
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }))
    const table = screen.getByRole('table')
    expect(within(table).getByRole('rowheader', { name: 'Sep 2026' })).toBeInTheDocument()
    expect(within(table).getByRole('rowheader', { name: 'Feb 2026' })).toBeInTheDocument()
    expect(within(table).queryByRole('rowheader', { name: 'Sep 26' })).not.toBeInTheDocument()
  })

  it('names every period in the accessible summary, thinned or not', () => {
    const { container } = render(<LineChart {...twelve} xShort={(d) => d.short} />)
    const label = container.querySelector('svg')!.getAttribute('aria-label')!
    expect(label).toContain('12 periods, Oct 2025 to Sep 2026')
  })

  it('marks every point of a 12-month trend, area wash or not', () => {
    const { container } = render(<LineChart {...twelve} area />)
    // The 24-point default has to actually fire at 12 points…
    expect(container.querySelectorAll('[data-mark="point"]')).toHaveLength(12)
    // …and each marker is ringed in the surface colour so it reads against
    // its own area fill.
    const dot = container.querySelector('[data-mark="point"]') as SVGElement
    expect(dot.style.stroke).toBe('var(--chart-surface)')
    expect(num(dot, 'r')).toBeGreaterThanOrEqual(4)
  })

  it('renders a single point as a visible dot, and empty data as the empty state', () => {
    const { container, rerender } = render(
      <LineChart ariaLabel="One" data={[pts[0]]} x={(d) => d.m} series={[{ key: 'c', label: 'C', value: (d) => d.cycle }]} markers={false} />,
    )
    expect(container.querySelectorAll('[data-mark="point"]')).toHaveLength(1)
    rerender(<LineChart ariaLabel="None" data={[{ m: 'A', onTime: null, cycle: null }]} x={(d) => d.m} series={[{ key: 'c', label: 'C', value: (d) => d.cycle }]} />)
    expect(screen.getByText('No data in this view')).toBeInTheDocument()
  })
})
