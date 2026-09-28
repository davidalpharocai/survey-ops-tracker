import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { BarChart } from './BarChart'
import { fmtMoney, fmtPct } from './format'
import { pathBox } from './geometry.testutil'

// Invented accounts and amounts — no real client figures in tests.
interface Group {
  name: string
  kept: number
  pct: number
  n: number
}
const groups: Group[] = [
  { name: 'Account A', kept: 1200, pct: 0.4, n: 8 },
  { name: 'Account B', kept: 800, pct: 0.25, n: 15 },
  { name: 'Account C', kept: -450, pct: -0.6, n: 1 },
  { name: 'Account D', kept: -20, pct: -0.05, n: 4 },
]

const bars = (c: HTMLElement, sel = '[data-mark="bar"]') => c.querySelectorAll(sel)

describe('BarChart', () => {
  it('draws one bar per row and splits them by sign when diverging', () => {
    const { container } = render(
      <BarChart ariaLabel="Kept by account" data={groups} label={(d) => d.name} value={(d) => d.kept} diverging valueFormat={fmtMoney} />,
    )
    expect(bars(container)).toHaveLength(4)
    expect(bars(container, '[data-sign="neg"]')).toHaveLength(2)
    expect(bars(container, '[data-sign="pos"]')).toHaveLength(2)
  })

  it('sizes each bar in proportion to its value, on both sides of zero', () => {
    const { container } = render(
      <BarChart ariaLabel="Kept by account" width={640} data={groups} label={(d) => d.name} value={(d) => d.kept} diverging valueFormat={fmtMoney} />,
    )
    const [a, b, c] = Array.from(bars(container)).map((p) => pathBox(p.getAttribute('d')))
    expect(a.w / b.w).toBeCloseTo(1200 / 800, 1)
    expect(a.w / c.w).toBeCloseTo(1200 / 450, 1)
    // The loss grows LEFT from the same zero the gains grow right from.
    expect(c.x1).toBeCloseTo(a.x0, 5)
  })

  it('labels negative bars with the real minus sign', () => {
    render(<BarChart ariaLabel="Kept by account" data={groups} label={(d) => d.name} value={(d) => d.kept} diverging valueFormat={fmtMoney} />)
    expect(screen.getByText('−$450')).toBeInTheDocument()
    expect(screen.queryByText('$-450')).not.toBeInTheDocument()
  })

  it('draws a float leftover that prints as $0.00 as zero, not as a loss', () => {
    const tiny = [{ name: 'Account E', kept: 1234.56 - 1234.5600000001, pct: 0, n: 5 }, ...groups.slice(0, 1)]
    const { container } = render(
      <BarChart ariaLabel="Kept" data={tiny} label={(d) => d.name} value={(d) => d.kept} diverging valueFormat={fmtMoney} negativeLabel="Lost" />,
    )
    expect(bars(container, '[data-sign="neg"]')).toHaveLength(0)
    expect(screen.queryByText('Lost')).not.toBeInTheDocument()
  })

  it('prints a custom value label like "kept % · n"', () => {
    render(
      <BarChart
        ariaLabel="Kept by account"
        data={groups}
        label={(d) => d.name}
        value={(d) => d.kept}
        valueLabel={{ name: 'Kept % · surveys', text: (d) => `${fmtPct(d.pct)} · ${d.n}` }}
      />,
    )
    expect(screen.getByText('40% · 8')).toBeInTheDocument()
    expect(screen.getByText('−60% · 1')).toBeInTheDocument()
  })

  it('mutes and tags rows that are too few to judge', () => {
    const { container } = render(
      <BarChart ariaLabel="Kept by account" data={groups} label={(d) => d.name} value={(d) => d.kept} muted={(d) => d.n < 3} diverging />,
    )
    const faded = Array.from(bars(container)).filter((b) => b.getAttribute('opacity') === '0.35')
    expect(faded).toHaveLength(1)
    const tags = container.querySelectorAll('[data-part="tag"]')
    expect(tags).toHaveLength(1)
    expect(tags[0].textContent).toBe(' · too few to judge')
    expect(tags[0].closest('text')!.textContent).toBe('Account C · too few to judge')
  })

  it('cuts a long name, never the "too few to judge" tag after it', () => {
    const long = [{ name: 'Sample Holdings Partners International Europe', kept: 300, pct: 0.3, n: 1 }, ...groups.slice(0, 2)]
    const { container } = render(
      <BarChart ariaLabel="Kept" width={640} data={long} label={(d) => d.name} value={(d) => d.kept} muted={(d) => d.n < 3} />,
    )
    const tag = container.querySelector('[data-part="tag"]')!
    expect(tag.textContent).toBe(' · too few to judge')
    const text = tag.closest('text')!
    expect(text.textContent).toMatch(/…/)
    // The full name + tag stays recoverable on hover.
    expect(text.querySelector('title')!.textContent).toBe('Sample Holdings Partners International Europe · too few to judge')
  })

  it('lists muted tags and notes in the table', () => {
    render(
      <BarChart
        ariaLabel="Kept"
        data={groups}
        label={(d) => d.name}
        value={(d) => d.kept}
        muted={(d) => d.n < 3}
        note={(d) => (d.name === 'Account D' ? 'Refund pending' : null)}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }))
    const table = screen.getByRole('table')
    expect(within(table).getByText('too few to judge')).toBeInTheDocument()
    expect(within(table).getByText('Refund pending')).toBeInTheDocument()
  })

  it('handles negative-only data, and its legend lists only the side that is drawn', () => {
    const { container } = render(
      <BarChart
        ariaLabel="Losses"
        data={groups.filter((g) => g.kept < 0)}
        label={(d) => d.name}
        value={(d) => d.kept}
        diverging
        positiveLabel="Kept"
        negativeLabel="Lost"
      />,
    )
    expect(bars(container, '[data-sign="neg"]')).toHaveLength(2)
    expect(screen.getByText('Lost')).toBeInTheDocument()
    expect(screen.queryByText('Kept')).not.toBeInTheDocument()
  })

  it('moves labels above the bars at phone width', () => {
    const { container } = render(
      <BarChart ariaLabel="Kept by account" width={360} data={groups} label={(d) => d.name} value={(d) => d.kept} diverging />,
    )
    // Above-mode labels start at the left edge (x=2) instead of right-aligned.
    const label = within(container).getByText('Account A').closest('text')!
    expect(label.getAttribute('text-anchor')).toBe('start')
  })

  it('drills with Enter and click; the table rows drill too', () => {
    const onSelect = vi.fn()
    render(<BarChart ariaLabel="Kept by account" data={groups} label={(d) => d.name} value={(d) => d.kept} onSelect={onSelect} />)
    const row = screen.getByRole('button', { name: /^Account B/ })
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onSelect).toHaveBeenLastCalledWith(groups[1])
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }))
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Account D' }))
    expect(onSelect).toHaveBeenLastCalledWith(groups[3])
  })

  it('is a plain image when href gives no row a URL', () => {
    const { container } = render(<BarChart ariaLabel="Kept" data={groups} label={(d) => d.name} value={(d) => d.kept} href={() => null} />)
    expect(container.querySelector('svg')!.getAttribute('role')).toBe('img')
    expect(container.querySelectorAll('svg a, svg [tabindex]')).toHaveLength(0)
  })

  it('flips a reference label to the left of its line near the right edge', () => {
    render(
      <BarChart
        ariaLabel="Delivered by captain"
        width={400}
        data={groups.filter((g) => g.kept > 0)}
        label={(d) => d.name}
        value={(d) => d.kept}
        referenceLines={[{ value: 1200, label: 'Team goal' }]}
      />,
    )
    const label = screen.getAllByText('Team goal').find((el) => el.closest('svg'))!
    expect(label.getAttribute('text-anchor')).toBe('end')
  })

  it('shows the empty state', () => {
    render(<BarChart ariaLabel="Kept" data={[] as Group[]} label={(d) => d.name} value={(d) => d.kept} />)
    expect(screen.getByText('No data in this view')).toBeInTheDocument()
  })
})
