import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Heatmap, type HeatCell } from './Heatmap'
import { fmtMoney, fmtPct } from './format'
import { num } from './geometry.testutil'

// Invented coverage figures — not the book's.
const rows = [
  { key: 'cost', label: 'Any cost' },
  { key: 'price', label: 'Client price' },
]
const columns = [
  { key: 'jun', label: 'Jun' },
  { key: 'jul', label: 'Jul' },
  { key: 'und', label: 'Undated', shortLabel: 'Und.' },
]
const cells: HeatCell[] = [
  { row: 'cost', col: 'jun', value: 0.6 },
  { row: 'cost', col: 'jul', value: 0.9 },
  { row: 'cost', col: 'und', value: 0.2 },
  { row: 'price', col: 'jun', value: 0.3 },
  { row: 'price', col: 'jul', value: null },
  // price × undated deliberately absent
]
const svgOf = (c: HTMLElement) => c.querySelector('svg')!

describe('Heatmap', () => {
  it('draws every row × column cell, with missing ones as "no data"', () => {
    const { container } = render(
      <Heatmap ariaLabel="Coverage" rows={rows} columns={columns} cells={cells} valueFormat={(v) => fmtPct(v)} />,
    )
    expect(container.querySelectorAll('[data-mark="cell"]')).toHaveLength(6)
    expect(container.querySelectorAll('[data-empty="true"]')).toHaveLength(2)
    expect(screen.getByText('60%')).toBeInTheDocument()
  })

  it('labels vertical rules, and names them in the summary', () => {
    const { container } = render(
      <Heatmap ariaLabel="Coverage" rows={rows} columns={columns} cells={cells} rules={[{ at: 'jul', label: 'costs reliable from here' }]} />,
    )
    expect(screen.getByText('costs reliable from here')).toBeInTheDocument()
    expect(svgOf(container).getAttribute('aria-label')).toContain('costs reliable from here (from Jul)')
  })

  it('is one tab stop; arrows move between cells; Enter drills the cell', () => {
    const onSelect = vi.fn()
    render(<Heatmap ariaLabel="Coverage" rows={rows} columns={columns} cells={cells} onSelect={onSelect} valueFormat={(v) => fmtPct(v)} />)
    const buttons = screen.getAllByRole('button').filter((b) => b.closest('svg'))
    // Five cells exist in `cells` (one of them null-valued), so five drill.
    expect(buttons).toHaveLength(5)
    expect(buttons.filter((b) => b.getAttribute('tabindex') === '0')).toHaveLength(1)
    const first = screen.getByRole('button', { name: /^Any cost, Jun/ })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    const jul = screen.getByRole('button', { name: /^Any cost, Jul/ })
    expect(document.activeElement).toBe(jul)
    fireEvent.keyDown(jul, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(cells[1])
  })

  it('does not drill a cell whose href is null, and keeps the grid in the tab order', () => {
    const two: HeatCell[] = [
      { row: 'cost', col: 'jun', value: 1 },
      { row: 'cost', col: 'jul', value: 0.4 },
    ]
    // A 100% cell has no missing surveys to list, so it gets no URL.
    const href = (c: HeatCell) => (c.value === 1 ? null : `/finance?gap=cost&m=${c.col}`)
    const { container } = render(
      <Heatmap ariaLabel="Coverage" rows={rows.slice(0, 1)} columns={columns.slice(0, 2)} cells={two} href={href} valueFormat={(v) => fmtPct(v)} />,
    )
    const links = container.querySelectorAll('svg a[href]')
    expect(links).toHaveLength(1)
    // The one drillable cell holds the tab stop.
    expect(links[0].getAttribute('tabindex')).toBe('0')
    expect(svgOf(container).getAttribute('role')).toBe('group')
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }))
    const table = screen.getByRole('table')
    // The 100% cell is plain text; only the 40% cell is a link. No dead button.
    expect(within(table).queryAllByRole('button')).toHaveLength(0)
    expect(within(table).getAllByRole('link')).toHaveLength(1)
    expect(within(table).getByText('100%').closest('a')).toBeNull()
  })

  it('stays a plain image when no cell has a URL and nothing else drills', () => {
    const { container } = render(
      <Heatmap ariaLabel="Coverage" rows={rows} columns={columns} cells={cells} href={() => null} />,
    )
    expect(svgOf(container).getAttribute('role')).toBe('img')
    expect(container.querySelectorAll('svg [tabindex]')).toHaveLength(0)
  })

  it('draws the weight as a bar in proportion to it, never as paleness', () => {
    const weighted: HeatCell[] = [
      { row: 'cost', col: 'jun', value: 1.5, weight: 1000 },
      { row: 'cost', col: 'jul', value: 3, weight: 50 },
    ]
    const { container } = render(
      <Heatmap ariaLabel="Drift" width={600} rows={rows.slice(0, 1)} columns={columns.slice(0, 2)} cells={weighted} weightName="Completes" valueFormat={fmtMoney} />,
    )
    // The value keeps the whole lightness channel: no cell is faded.
    for (const c of container.querySelectorAll('[data-mark="cell"]')) expect(c.getAttribute('fill-opacity')).toBeNull()
    const bars = Array.from(container.querySelectorAll('[data-part="weight-bar"]')).map((b) => num(b, 'width'))
    expect(bars).toHaveLength(2)
    expect(bars[0] / bars[1]).toBeCloseTo(1000 / 50, 0)
    expect(screen.getByText(/Line under each cell: completes/)).toBeInTheDocument()
  })

  it('puts the weight and the note in the table and the weight range in the summary', () => {
    const weighted: HeatCell[] = [
      { row: 'cost', col: 'jun', value: 1.5, weight: 1000 },
      { row: 'cost', col: 'jul', value: 3, weight: 50 },
    ]
    const { container } = render(
      <Heatmap
        ariaLabel="Drift"
        rows={rows.slice(0, 1)}
        columns={columns.slice(0, 2)}
        cells={weighted}
        weightName="Completes"
        valueFormat={fmtMoney}
        note={(c) => (c.col === 'jul' ? 'One launch only' : null)}
      />,
    )
    expect(svgOf(container).getAttribute('aria-label')).toContain('Completes from 50 to 1,000')
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }))
    const table = screen.getByRole('table')
    expect(within(table).getByText(/1,000 completes/)).toBeInTheDocument()
    expect(within(table).getByText('One launch only')).toBeInTheDocument()
  })

  it('prints cell text in every cell or in none', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ key: `c${i}`, label: `M${i}` }))
    const long = [{ key: 'r', label: 'Panel rows on panel surveys' }]
    const grid: HeatCell[] = nine.map((c, i) => ({ row: 'r', col: c.key, value: i % 2 ? 0.45 : 1 }))
    const inSvg = (t: string) => screen.queryAllByText(t).filter((el) => el.closest('svg'))
    // Phone width: the row label gives up room so the widest ("100%") fits.
    const { unmount } = render(<Heatmap ariaLabel="Coverage" width={358} rows={long} columns={nine} cells={grid} valueFormat={(v) => fmtPct(v)} />)
    expect(inSvg('100%')).toHaveLength(5)
    expect(inSvg('45%')).toHaveLength(4)
    unmount()
    // Too narrow even after squeezing: no cell text at all, not just the strong ones.
    render(<Heatmap ariaLabel="Coverage" width={200} rows={long} columns={nine} cells={grid} valueFormat={(v) => fmtPct(v)} />)
    expect(inSvg('100%')).toHaveLength(0)
    expect(inSvg('45%')).toHaveLength(0)
  })

  it('never lets the grid run past the chart width', () => {
    const weeks = Array.from({ length: 40 }, (_, i) => ({ key: `w${i}`, label: `W${i + 1}` }))
    const grid: HeatCell[] = weeks.map((c, i) => ({ row: 'r', col: c.key, value: i / 40 }))
    const { container } = render(
      <Heatmap ariaLabel="Weekly" width={390} rows={[{ key: 'r', label: 'PS panel rows on PS surveys' }]} columns={weeks} cells={grid} />,
    )
    const rights = Array.from(container.querySelectorAll('[data-mark="cell"]')).map((c) => num(c, 'x') + num(c, 'width'))
    expect(Math.max(...rights)).toBeLessThanOrEqual(390)
  })

  it('names a no-data cell in the table and gives its control the focus ring', () => {
    render(<Heatmap ariaLabel="Coverage" rows={rows} columns={columns} cells={cells} onSelect={() => {}} valueFormat={(v) => fmtPct(v)} />)
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }))
    const table = screen.getByRole('table')
    const blank = within(table).getByRole('button', { name: 'Client price, Jul: No data' })
    expect(blank.className).toContain('focus-visible:outline-2')
  })

  it('draws a value that prints as zero on a diverging scale as the neutral midpoint', () => {
    const tiny: HeatCell[] = [
      { row: 'cost', col: 'jun', value: -1e-9 },
      { row: 'cost', col: 'jul', value: 0.5 },
    ]
    const { container } = render(
      <Heatmap ariaLabel="Change" scale="diverging" rows={rows.slice(0, 1)} columns={columns.slice(0, 2)} cells={tiny} valueFormat={(v) => fmtPct(v)} />,
    )
    const fills = Array.from(container.querySelectorAll('[data-mark="cell"]')).map((c) => (c as SVGElement).style.fill)
    expect(fills[0]).toBe('var(--chart-neutral)')
  })

  it('paints a grid of zeros pale, not at full strength', () => {
    const zeros: HeatCell[] = columns.map((c) => ({ row: 'cost', col: c.key, value: 0 }))
    const { container } = render(<Heatmap ariaLabel="Coverage" rows={rows.slice(0, 1)} columns={columns} cells={zeros} valueFormat={(v) => fmtPct(v)} />)
    // Zero is data (not the "no data" hatch), drawn at the pale end of the scale.
    expect(container.querySelectorAll('[data-empty="true"]')).toHaveLength(0)
    expect(screen.queryByText('No data in this view')).not.toBeInTheDocument()
    for (const t of screen.getAllByText('0%').filter((el) => el.closest('svg'))) {
      // Ink text, not the on-fill colour a strong cell would get.
      expect(t.getAttribute('class')).toContain('fill-foreground')
    }
  })

  // The coverage grid draws EVERY month with delivered work, whatever dates
  // the page is set to, so its header nearly always crosses a year and
  // carries one ("Jun 25"). A wider label used to cost the grid its newest
  // month: it thinned with `i % step` from the left, so at 14 to 21 columns
  // it named every other month and the last one only when the count was odd.
  describe('a month-by-month header', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => {
        const yr = 2025 + Math.floor(i / 12)
        const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i % 12]
        return { key: `${yr}-${i % 12}`, label: `${mon} ${yr}`, shortLabel: `${mon} ${String(yr).slice(2)}` }
      })
    const grid = (n: number, width: number) => {
      const cols = many(n)
      return render(
        <Heatmap
          ariaLabel="Coverage"
          width={width}
          rows={rows}
          columns={cols}
          cells={cols.flatMap((c) => rows.map((r) => ({ row: r.key, col: c.key, value: 0.5 })))}
          valueFormat={(v) => fmtPct(v)}
        />,
      )
    }
    const drawn = (c: HTMLElement) =>
      [...c.querySelectorAll('svg text')]
        .map((t) => [...t.childNodes].filter((n) => n.nodeName !== 'title').map((n) => n.textContent).join(''))
        .filter((t) => /^[A-Z][a-z]{2} \d{2}$/.test(t))

    it('names the newest month at every column count, not only the odd ones', () => {
      for (const n of [12, 14, 16, 18, 20, 24, 26]) {
        const { container } = grid(n, 728)
        expect(drawn(container)).toContain(many(n)[n - 1].shortLabel)
        expect(drawn(container)).toContain(many(n)[0].shortLabel)
      }
    })

    it('leaves a tick over every column, including the months it had to thin', () => {
      const { container } = grid(26, 728)
      expect(container.querySelectorAll('[data-part="category-ticks"] line')).toHaveLength(26)
      expect(container.querySelectorAll('[data-tick="plain"]').length).toBeGreaterThan(0)
    })

    it('hovers a shortened header back to its full month', () => {
      const { container } = grid(14, 728)
      const sep = [...container.querySelectorAll('svg text')].find((t) => t.textContent?.endsWith('Jan 25'))!
      expect(sep.querySelector('title')?.textContent).toBe('Jan 2025')
    })
  })

  it('has a table twin and an empty state', () => {
    const { rerender } = render(<Heatmap ariaLabel="Coverage" rows={rows} columns={columns} cells={cells} valueFormat={(v) => fmtPct(v)} />)
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }))
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(within(table).getByText('20%')).toBeInTheDocument()
    rerender(<Heatmap ariaLabel="Coverage" rows={rows} columns={columns} cells={[]} />)
    expect(screen.getByText('No data in this view')).toBeInTheDocument()
  })
})
