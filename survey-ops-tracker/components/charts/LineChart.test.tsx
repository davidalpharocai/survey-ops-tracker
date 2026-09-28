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

  it('renders a single point as a visible dot, and empty data as the empty state', () => {
    const { container, rerender } = render(
      <LineChart ariaLabel="One" data={[pts[0]]} x={(d) => d.m} series={[{ key: 'c', label: 'C', value: (d) => d.cycle }]} markers={false} />,
    )
    expect(container.querySelectorAll('[data-mark="point"]')).toHaveLength(1)
    rerender(<LineChart ariaLabel="None" data={[{ m: 'A', onTime: null, cycle: null }]} x={(d) => d.m} series={[{ key: 'c', label: 'C', value: (d) => d.cycle }]} />)
    expect(screen.getByText('No data in this view')).toBeInTheDocument()
  })
})
