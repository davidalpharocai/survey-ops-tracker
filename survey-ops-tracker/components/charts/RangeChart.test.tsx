import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { RangeChart } from './RangeChart'
import { pathBox } from './geometry.testutil'

// Invented levers — no real finance figures in tests.
interface Lever {
  name: string
  low: number | null
  high: number | null
  conf: string
}
const levers: Lever[] = [
  { name: 'Lever one', low: 0, high: 4000, conf: 'Depends on others' },
  { name: 'Lever two', low: 1000, high: 2500, conf: 'Measured' },
  { name: 'Lever three', low: null, high: 1500, conf: 'Direction only' },
]
const base = {
  ariaLabel: 'Save cost',
  data: levers,
  label: (d: Lever) => d.name,
  low: (d: Lever) => d.low,
  high: (d: Lever) => d.high,
}

describe('RangeChart', () => {
  it('draws one floating range per lever with its confidence tag', () => {
    const { container } = render(<RangeChart {...base} confidence={(d) => d.conf} />)
    expect(container.querySelectorAll('[data-mark="range"]')).toHaveLength(3)
    expect(container.querySelectorAll('[data-mark="confidence"]')).toHaveLength(3)
    expect(screen.getByText('Measured')).toBeInTheDocument()
  })

  it('sizes each range in proportion to its span', () => {
    const { container } = render(<RangeChart {...base} width={600} />)
    const [one, two] = Array.from(container.querySelectorAll('[data-mark="range"]')).map((p) => pathBox(p.getAttribute('d')))
    expect(one.w / two.w).toBeCloseTo(4000 / 1500, 1)
  })

  it('reads a missing low end as "up to"', () => {
    render(<RangeChart {...base} />)
    expect(screen.getByText('up to $1,500')).toBeInTheDocument()
    expect(screen.getByText('$1,000 – $2,500')).toBeInTheDocument()
  })

  it('draws no bar for a lever with no figures, and prints the reason instead', () => {
    const data = [...levers, { name: 'Lever four', low: null, high: null, conf: 'Measured' }]
    const { container } = render(<RangeChart {...base} data={data} missingText={() => 'too few surveys here to call'} />)
    // Three bars, not four: a missing figure is never drawn at $0.
    expect(container.querySelectorAll('[data-mark="range"]')).toHaveLength(3)
    const reason = screen.getAllByText('too few surveys here to call').find((el) => el.closest('svg'))
    expect(reason).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }))
    const row = within(screen.getByRole('table')).getByRole('rowheader', { name: 'Lever four' }).closest('tr')!
    expect(within(row).getAllByText('—')).toHaveLength(2)
    expect(within(row).getByText('Too few surveys here to call')).toBeInTheDocument()
  })

  it('never pushes the label of a full-width range off the chart', () => {
    render(<RangeChart {...base} width={360} />)
    const text = screen.getByText('$0 – $4,000')
    const x = Number(text.getAttribute('x'))
    expect(x).toBeGreaterThan(0)
    expect(x).toBeLessThanOrEqual(360)
  })

  it('fades muted rows AND says why: on the row, in the legend and in the table', () => {
    const { container } = render(
      <RangeChart {...base} confidence={(d) => d.conf} muted={(d) => d.conf === 'Direction only'} mutedNote="direction only" />,
    )
    const faded = Array.from(container.querySelectorAll('[data-mark="range"]')).filter((p) => p.getAttribute('opacity') === '0.4')
    expect(faded).toHaveLength(1)
    const tag = container.querySelector('[data-part="tag"]')!
    expect(tag.closest('text')!.textContent).toBe('Lever three · direction only')
    expect(screen.getByText('Faded: direction only')).toBeInTheDocument()
    expect(container.querySelector('svg')!.getAttribute('aria-label')).toContain('Lever three: up to $1,500 (Direction only), faded: direction only')
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }))
    const table = screen.getByRole('table')
    // Header + one row per lever; the "up to" lever's low end reads $0, not a dash.
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(within(table).getAllByText('$0')).toHaveLength(2)
    expect(within(table).getByRole('columnheader', { name: 'Lever' })).toBeInTheDocument()
    expect(within(table).getAllByText('Faded: direction only').length).toBeGreaterThan(0)
  })

  it('drills a lever and shows the empty state', () => {
    const onSelect = vi.fn()
    const { rerender } = render(<RangeChart {...base} onSelect={onSelect} />)
    fireEvent.keyDown(screen.getByRole('button', { name: /^Lever two/ }), { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(levers[1])
    rerender(<RangeChart {...base} data={[]} />)
    expect(screen.getByText('No data in this view')).toBeInTheDocument()
  })
})
