import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ColumnChart } from './ColumnChart'
import { fmtMoney, fmtMoneyCompact, fmtPct } from './format'
import { FONT } from './primitives'
import { textWidth } from './scale'
import { num, pathBox } from './geometry.testutil'

// Synthetic months — no real client figures in tests.
interface Month {
  m: string
  price: number | null
  cost: number | null
  unpriced: number | null
  kept: number | null
  n: number
}
const months: Month[] = [
  { m: 'Jun', price: 2000, cost: 1000, unpriced: 3000, kept: 0.5, n: 4 },
  { m: 'Jul', price: 5000, cost: 2000, unpriced: 4000, kept: 0.6, n: 7 },
  { m: 'Aug', price: 6000, cost: 3800, unpriced: 4500, kept: 0.37, n: 14 },
  { m: 'Sep', price: 7000, cost: 4800, unpriced: 900, kept: 0.31, n: 22 },
]
const series = [
  { key: 'price', label: 'Client price', value: (d: Month) => d.price, color: 'var(--chart-price)' },
  { key: 'cost', label: 'Our cost', value: (d: Month) => d.cost, color: 'var(--chart-cost)' },
  { key: 'np', label: 'Spend with no price', value: (d: Month) => d.unpriced, hatch: true },
]

const marks = (c: HTMLElement, sel = '[data-mark="column"]') => c.querySelectorAll(sel)
const svgLabel = (c: HTMLElement) => c.querySelector('svg')!.getAttribute('aria-label')!

describe('ColumnChart', () => {
  it('draws one column per series per month in grouped mode', () => {
    const { container } = render(
      <ColumnChart ariaLabel="Price vs cost" data={months} x={(d) => d.m} series={series} valueFormat={fmtMoney} axisFormat={fmtMoneyCompact} />,
    )
    expect(marks(container)).toHaveLength(12)
    expect(marks(container, '[data-series="np"]')).toHaveLength(4)
  })

  it('makes column heights proportional to their values', () => {
    const { container } = render(<ColumnChart ariaLabel="Price vs cost" data={months} x={(d) => d.m} series={series.slice(0, 2)} />)
    const price = Array.from(marks(container, '[data-series="price"]')).map((p) => pathBox(p.getAttribute('d')))
    const cost = Array.from(marks(container, '[data-series="cost"]')).map((p) => pathBox(p.getAttribute('d')))
    expect(price[0].h / cost[0].h).toBeCloseTo(2000 / 1000, 5)
    expect(price[3].h / price[0].h).toBeCloseTo(7000 / 2000, 5)
    // Every column grows from the same baseline.
    expect(price[0].y1).toBeCloseTo(price[3].y1, 5)
  })

  it('skips a missing value instead of drawing it as zero', () => {
    const data = [...months.slice(0, 3), { ...months[3], price: null }]
    const { container } = render(<ColumnChart ariaLabel="Price vs cost" data={data} x={(d) => d.m} series={series} />)
    expect(marks(container, '[data-series="price"]')).toHaveLength(3)
  })

  it('stacks series into one column per category, and says the totals', () => {
    const { container } = render(
      <ColumnChart ariaLabel="Delivered by type" mode="stacked" data={months} x={(d) => d.m} series={series.slice(0, 2)} />,
    )
    expect(marks(container)).toHaveLength(8)
    expect(svgLabel(container)).toContain('Total: highest 11,800 (Sep), lowest 3,000 (Jun)')
  })

  it('draws negative columns below the zero line, in proportion', () => {
    const data = [
      { m: 'A', v: -600 },
      { m: 'B', v: 1200 },
    ]
    const { container } = render(
      <ColumnChart ariaLabel="Kept" data={data} x={(d) => d.m} series={[{ key: 'v', label: 'Kept', value: (d) => d.v }]} valueFormat={fmtMoney} />,
    )
    const [neg, pos] = Array.from(marks(container)).map((p) => pathBox(p.getAttribute('d')))
    // The loss hangs from the baseline the gain stands on.
    expect(neg.y0).toBeCloseTo(pos.y1, 5)
    expect(pos.h / neg.h).toBeCloseTo(2, 5)
    // The accessible summary uses the real minus sign.
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('−$600')
  })

  it('prints top labels (kept %) and sub-labels (survey count)', () => {
    render(
      <ColumnChart
        ariaLabel="Price vs cost"
        data={months}
        x={(d) => d.m}
        series={series}
        topLabel={{ name: 'Kept', text: (d) => (d.kept == null ? null : fmtPct(d.kept)) }}
        subLabel={{ name: 'Surveys', text: (d) => `${d.n}` }}
      />,
    )
    expect(screen.getByText('37%')).toBeInTheDocument()
    expect(screen.getByText('22')).toBeInTheDocument()
  })

  it('keeps a reference-line label off the column top labels', () => {
    const totals = [40, 30, 35, 42, 38, 44].map((v, i) => ({ m: `M${i + 1}`, a: v * 0.6, b: v * 0.4, total: v }))
    const { container } = render(
      <ColumnChart
        ariaLabel="Delivered"
        width={600}
        mode="stacked"
        data={totals}
        x={(d) => d.m}
        series={[
          { key: 'a', label: 'A', value: (d) => d.a },
          { key: 'b', label: 'B', value: (d) => d.b },
        ]}
        topLabel={{ name: 'Total', text: (d) => `${d.total}` }}
        referenceLines={[{ value: 40, label: 'Goal: 40 a month' }]}
      />,
    )
    const svg = container.querySelector('svg')!
    const goal = within(svg as unknown as HTMLElement).getByText('Goal: 40 a month')
    const gw = textWidth('Goal: 40 a month', FONT.small)
    const gx0 = goal.getAttribute('text-anchor') === 'end' ? num(goal, 'x') - gw : num(goal, 'x')
    const gy = num(goal, 'y')
    for (const t of totals) {
      // The top label, not the y-axis tick that may print the same number.
      const label = Array.from(svg.querySelectorAll('text')).find(
        (el) => el.textContent === `${t.total}` && el.getAttribute('class')?.includes('fill-foreground'),
      )!
      const w = textWidth(`${t.total}`, FONT.tick)
      const lx = num(label, 'x')
      const ly = num(label, 'y') // alphabetic baseline
      const xOverlap = gx0 < lx + w / 2 && lx - w / 2 < gx0 + gw
      const yOverlap = gy - FONT.small / 2 < ly + 2 && ly - FONT.tick < gy + FONT.small / 2
      expect(xOverlap && yOverlap).toBe(false)
    }
  })

  it('matches a rule by category key, so a repeated month label cannot misplace it', () => {
    const data = [
      { k: '2025-09', m: 'Sep', v: 3 },
      { k: '2025-10', m: 'Oct', v: 4 },
      { k: '2026-09', m: 'Sep', v: 5 },
    ]
    const { container } = render(
      <ColumnChart
        ariaLabel="Delivered"
        width={600}
        data={data}
        x={(d) => d.m}
        xKey={(d) => d.k}
        series={[{ key: 'v', label: 'V', value: (d) => d.v }]}
        rules={[{ at: '2026-09', label: 'new form' }]}
      />,
    )
    const rule = container.querySelector('line[stroke-dasharray="3 3"]')!
    const oct = within(container).getByText('Oct')
    expect(num(rule, 'x1')).toBeGreaterThan(num(oct, 'x'))
    expect(svgLabel(container)).toContain('new form (from Sep)')
  })

  it('names faded columns in the legend and the table, and never fades below 35%', () => {
    const { container } = render(
      <ColumnChart
        ariaLabel="Price vs cost"
        data={months}
        x={(d) => d.m}
        series={series.slice(0, 2)}
        opacity={(d) => (d.m === 'Jun' ? 0.1 : 1)}
        opacityNote="costs not reliably recorded"
      />,
    )
    const faded = Array.from(container.querySelectorAll('svg g[opacity]')).map((g) => Number(g.getAttribute('opacity')))
    expect(Math.min(...faded)).toBe(0.35)
    expect(screen.getByText('Faded: costs not reliably recorded')).toBeInTheDocument()
    expect(svgLabel(container)).toContain('Faded (costs not reliably recorded): Jun')
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }))
    const table = screen.getByRole('table')
    const jun = within(table).getByRole('rowheader', { name: 'Jun' }).closest('tr')!
    expect(jun.className).toContain('text-muted-foreground')
    expect(within(jun).getByText('Faded: costs not reliably recorded')).toBeInTheDocument()
  })

  it('puts the tooltip note in the table and the reference lines in the summary', () => {
    const { container } = render(
      <ColumnChart
        ariaLabel="Price vs cost"
        data={months}
        x={(d) => d.m}
        series={series.slice(0, 1)}
        note={(d) => (d.m === 'Aug' ? 'One survey refunded' : null)}
        referenceLines={[{ value: 4000, label: 'Monthly goal' }]}
        valueFormat={fmtMoney}
      />,
    )
    expect(svgLabel(container)).toContain('Monthly goal at $4,000')
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }))
    expect(within(screen.getByRole('table')).getByText('One survey refunded')).toBeInTheDocument()
  })

  it('calls onSelect with the row on click, Enter and Space', () => {
    const onSelect = vi.fn()
    render(<ColumnChart ariaLabel="Price vs cost" data={months} x={(d) => d.m} series={series} onSelect={onSelect} />)
    const aug = screen.getByRole('button', { name: /^Aug/ })
    fireEvent.click(aug)
    expect(onSelect).toHaveBeenLastCalledWith(months[2])
    fireEvent.keyDown(aug, { key: 'Enter' })
    fireEvent.keyDown(aug, { key: ' ' })
    expect(onSelect).toHaveBeenCalledTimes(3)
    expect(aug).toHaveAttribute('tabindex', '0')
  })

  it('keeps non-clickable marks out of the tab order', () => {
    const { container } = render(<ColumnChart ariaLabel="Price vs cost" data={months} x={(d) => d.m} series={series} />)
    expect(container.querySelectorAll('svg [tabindex]')).toHaveLength(0)
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('renders real links when href is given, and stays an image when href is null everywhere', () => {
    const { container, rerender } = render(
      <ColumnChart ariaLabel="Price vs cost" data={months} x={(d) => d.m} series={series} href={(d) => `/finance?month=${d.m}`} />,
    )
    const links = container.querySelectorAll('svg a[href]')
    expect(links).toHaveLength(4)
    expect(links[0].getAttribute('href')).toBe('/finance?month=Jun')
    rerender(<ColumnChart ariaLabel="Price vs cost" data={months} x={(d) => d.m} series={series} href={() => null} />)
    expect(container.querySelector('svg')!.getAttribute('role')).toBe('img')
  })

  it('names the chart once: no <title> or <desc> repeating the summary', () => {
    const { container } = render(<ColumnChart ariaLabel="Price vs cost" data={months} x={(d) => d.m} series={series} />)
    const svg = container.querySelector('svg')!
    expect(svg.querySelector(':scope > title, :scope > desc')).toBeNull()
    expect(svg.getAttribute('aria-describedby')).toBeNull()
    expect(svg.getAttribute('aria-label')).toMatch(/^Price vs cost\. 4 categories, Jun to Sep\./)
  })

  it('shows the same numbers as an accessible table on request', () => {
    render(<ColumnChart ariaLabel="Price vs cost" data={months} x={(d) => d.m} xLabel="Month" series={series} valueFormat={fmtMoney} />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }))
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Month' })).toBeInTheDocument()
    expect(within(table).getByText('$3,800')).toBeInTheDocument()
    expect(within(table).getAllByRole('row')).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: 'Hide table' }))
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  // The Last-12-months window on /insights: every label carries a year, so
  // the axis MUST thin them at the width the page renders at.
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const year = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].map(
    (k, i) => ({
      k,
      long: `${MON[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`,
      short: `${MON[Number(k.slice(5)) - 1]} ${k.slice(2, 4)}`,
      v: 3 + i,
    }),
  )
  const twelve = {
    ariaLabel: 'Delivered per month',
    data: year,
    width: 380,
    x: (d: (typeof year)[number]) => d.long,
    xKey: (d: (typeof year)[number]) => d.k,
    series: [{ key: 'v', label: 'Delivered', value: (d: (typeof year)[number]) => d.v }],
  }
  /** What the axis PRINTS: a shortened label's <title> is part of textContent. */
  const printed = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('text'))
      .map((t) => Array.from(t.childNodes).filter((n) => n.nodeName !== 'title').map((n) => n.textContent).join(''))
      .filter(Boolean)

  it('gives every category a tick, even the ones whose label was thinned away', () => {
    const { container } = render(<ColumnChart {...twelve} />)
    const ticks = container.querySelectorAll('[data-part="category-ticks"] line')
    expect(ticks).toHaveLength(12)
    // The thinning is real at this width…
    expect(container.querySelectorAll('[data-tick="plain"]').length).toBeGreaterThan(0)
    // …and each tick stands under the centre of its own column band.
    const xs = Array.from(ticks).map((t) => num(t, 'x1'))
    const gaps = xs.slice(1).map((v, i) => v - xs[i])
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 5)
  })

  it('always names the first and last month of the window', () => {
    const texts = printed(render(<ColumnChart {...twelve} />).container)
    expect(texts).toContain('Oct 2025')
    expect(texts).toContain('Sep 2026')
  })

  // Pinning the newest category is only worth anything if there is room to
  // draw it. The flat 6px right margin was less than half a "21 Sep" on the
  // finance Improve tab's 26-week logging strip (a third of the page, ~339px),
  // so the newest week — the week the card's red alert is about — ran past the
  // viewBox and lost its last glyphs, with no scaling to rescue it.
  it('keeps the newest category inside the chart instead of cutting it off', () => {
    const weeks = Array.from({ length: 26 }, (_, i) => ({
      k: `w${i}`,
      long: `${(i % 28) + 1} ${['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'][i % 7]} 2026`,
      short: `${(i % 28) + 1} ${['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'][i % 7]}`,
      v: 0.5 + (i % 5) / 10,
    }))
    for (const W of [339, 261]) {
      const { container } = render(
        <ColumnChart
          ariaLabel="Logged within a week"
          width={W}
          data={weeks}
          x={(d) => d.long}
          xShort={(d) => d.short}
          xKey={(d) => d.k}
          series={[{ key: 's', label: 'Share', value: (d) => d.v }]}
          valueFormat={(v) => `${Math.round(v * 100)}%`}
          yDomain={[0, 1]}
        />,
      )
      const last = weeks[25].short
      const drawn = Array.from(container.querySelectorAll('svg text')).find(
        (t) => Array.from(t.childNodes).filter((n) => n.nodeName !== 'title').map((n) => n.textContent).join('') === last,
      )
      expect(drawn, `newest week at ${W}px`).toBeTruthy()
      // anchor="middle", so it needs half its own width on the right.
      const font = Number((drawn!.getAttribute('style') ?? '').match(/font-size:\s*([\d.]+)/)?.[1] ?? FONT.tick)
      expect(num(drawn!, 'x') + textWidth(last, font) / 2, `right edge at ${W}px`).toBeLessThanOrEqual(W)
    }
  })

  it('shows a thinned month its full name, its value and its total on hover', () => {
    const { container } = render(
      <ColumnChart {...twelve} topLabel={{ name: 'Total', text: (d) => `${d.v}` }} onSelect={() => {}} />,
    )
    expect(printed(container)).not.toContain('Feb 2026')
    fireEvent.mouseEnter(screen.getByRole('button', { name: /^Feb 2026/ }))
    const card = screen.getByText('Feb 2026').closest('[aria-hidden]') as HTMLElement
    expect(within(card).getByText('Delivered')).toBeInTheDocument()
    // The top label is thinned like any other axis text, so hover carries it.
    expect(within(card).getByText('Total')).toBeInTheDocument()
  })

  it('draws the short form on the axis and the long form in the tooltip and the table', () => {
    const { container } = render(<ColumnChart {...twelve} xShort={(d) => d.short} xLabel="Month" onSelect={() => {}} />)
    const texts = printed(container)
    expect(texts).toContain('Sep 26')
    expect(texts).not.toContain('Sep 2026')
    // Hover: the full month, never the abbreviation.
    fireEvent.mouseEnter(screen.getByRole('button', { name: /^Sep 2026/ }))
    const card = container.querySelector('[aria-hidden].z-20') as HTMLElement
    expect(within(card).getByText('Sep 2026')).toBeInTheDocument()
    expect(within(card).queryByText('Sep 26')).not.toBeInTheDocument()
    // Table: the full month too.
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }))
    const table = screen.getByRole('table')
    expect(within(table).getByRole('rowheader', { name: 'Sep 2026' })).toBeInTheDocument()
    expect(within(table).getByRole('rowheader', { name: 'Feb 2026' })).toBeInTheDocument()
    expect(within(table).queryByRole('rowheader', { name: 'Sep 26' })).not.toBeInTheDocument()
    // …and the accessible summary names both ends in full.
    expect(svgLabel(container)).toContain('12 categories, Oct 2025 to Sep 2026')
  })

  it('shows the empty message for no rows or all-missing values', () => {
    const { rerender } = render(<ColumnChart ariaLabel="Price vs cost" data={[] as Month[]} x={(d) => d.m} series={series} />)
    expect(screen.getByText('No data in this view')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View as table' })).not.toBeInTheDocument()
    rerender(
      <ColumnChart
        ariaLabel="Price vs cost"
        data={[{ ...months[0], price: null, cost: null, unpriced: null }]}
        x={(d) => d.m}
        series={series}
        emptyMessage="Nothing priced yet"
      />,
    )
    expect(screen.getByText('Nothing priced yet')).toBeInTheDocument()
  })

  it('renders a single datum and all-zero data without breaking', () => {
    const { container, rerender } = render(
      <ColumnChart ariaLabel="One" data={[months[0]]} x={(d) => d.m} series={series.slice(0, 1)} />,
    )
    expect(marks(container)).toHaveLength(1)
    rerender(<ColumnChart ariaLabel="Zeros" data={[{ m: 'A', v: 0 }, { m: 'B', v: 0 }]} x={(d) => d.m} series={[{ key: 'v', label: 'V', value: (d) => d.v }]} />)
    expect(screen.getByRole('img')).toBeInTheDocument()
    expect(screen.queryByText('No data in this view')).not.toBeInTheDocument()
    // All zero is data, not a failed load — and it says so.
    expect(screen.getByText('Every value here is zero')).toBeInTheDocument()
    // A clean 0–1 axis, not fractional ticks of a count.
    expect(screen.queryByText('0.2')).not.toBeInTheDocument()
  })

  it('draws the overlay in its own strip with one dot per value', () => {
    const { container } = render(
      <ColumnChart
        ariaLabel="Price vs cost"
        data={months}
        x={(d) => d.m}
        series={series}
        overlay={{ label: 'Kept %', value: (d) => d.kept, format: (v) => fmtPct(v) }}
      />,
    )
    expect(container.querySelectorAll('[data-mark="overlay"]')).toHaveLength(4)
  })

  it('keeps the tooltip inside a phone-width chart', () => {
    render(
      <ColumnChart ariaLabel="Price vs cost" width={358} data={months} x={(d) => d.m} series={series} valueFormat={fmtMoney} onSelect={() => {}} />,
    )
    // Jul is left of centre, so the card opens rightward; it must be capped
    // at the room between the anchor and the chart's right edge.
    fireEvent.mouseEnter(screen.getByRole('button', { name: /^Jul/ }))
    const card = screen.getByText('$5,000').closest('[aria-hidden]') as HTMLElement
    const left = parseFloat(card.style.left)
    const maxWidth = parseFloat(card.style.maxWidth)
    expect(left + maxWidth).toBeLessThanOrEqual(358)
  })

  it('shows a tooltip on hover and on keyboard focus', () => {
    render(<ColumnChart ariaLabel="Price vs cost" data={months} x={(d) => d.m} series={series} valueFormat={fmtMoney} onSelect={() => {}} />)
    const jul = screen.getByRole('button', { name: /^Jul/ })
    fireEvent.focus(jul)
    expect(screen.getByText('$5,000')).toBeInTheDocument()
    fireEvent.blur(jul)
    expect(screen.queryByText('$5,000')).not.toBeInTheDocument()
    fireEvent.mouseEnter(jul)
    expect(screen.getByText('$5,000')).toBeInTheDocument()
  })
})
