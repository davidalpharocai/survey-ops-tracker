import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { BulletChart } from './BulletChart'
import { num, pathBox } from './geometry.testutil'

// Invented surveys — no real contract, spend or budget figures.
interface Live {
  code: string
  spend: number
  contract: number | null
  budget: number | null
  collected: number
  target: number
}
const live: Live[] = [
  { code: 'SAMPLE-1', spend: 600, contract: 1000, budget: 450, collected: 45, target: 50 },
  { code: 'SAMPLE-2', spend: 1300, contract: 1200, budget: 500, collected: 70, target: 60 },
  { code: 'SAMPLE-3', spend: 150, contract: null, budget: 400, collected: 10, target: 40 },
]

const props = {
  ariaLabel: 'Live surveys',
  data: live,
  label: (d: Live) => d.code,
  value: (d: Live) => d.spend,
  max: (d: Live) => d.contract,
  budget: (d: Live) => d.budget,
  goal: (d: Live) => (d.contract == null ? null : d.contract * 0.5),
  progress: (d: Live) => ({ value: d.collected, target: d.target }),
}

describe('BulletChart', () => {
  it('draws spend, budget, goal and contract cap per row', () => {
    const { container } = render(<BulletChart {...props} />)
    expect(container.querySelectorAll('[data-mark="spend"]')).toHaveLength(3)
    expect(container.querySelectorAll('[data-mark="budget"]')).toHaveLength(3)
    // No goal and no cap on the row with no price.
    expect(container.querySelectorAll('[data-mark="goal"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-mark="cap"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-mark="progress"]')).toHaveLength(3)
  })

  it('puts the goal, budget and cap where their values fall on the row scale', () => {
    const { container } = render(<BulletChart {...props} data={[live[0]]} width={500} />)
    const x0 = 2
    const capX = num(container.querySelector('[data-mark="cap"]'), 'x') + 1.5
    const goalX = num(container.querySelector('[data-mark="goal"] line'), 'x1')
    const budgetX = num(container.querySelector('[data-mark="budget"]'), 'x1')
    // Spend is inside the contract value, so the scale ends at the cap.
    expect(goalX).toBeCloseTo(x0 + 0.5 * (capX - x0), 5)
    expect(budgetX).toBeCloseTo(x0 + (450 / 1000) * (capX - x0), 5)
    const spend = pathBox(container.querySelector('[data-mark="spend"]')!.getAttribute('d'))
    expect(spend.x1 - x0).toBeCloseTo((600 / 1000) * (capX - x0), 5)
  })

  it('turns spend past the contract value red, sized by the overrun', () => {
    const { container } = render(<BulletChart {...props} />)
    expect(container.querySelectorAll('[data-mark="over"]')).toHaveLength(1)
    const inside = pathBox(container.querySelectorAll('[data-mark="spend"]')[1].getAttribute('d'))
    const over = pathBox(container.querySelector('[data-mark="over"]')!.getAttribute('d'))
    // Navy from $0 to the $1,200 contract value, red from there to $1,300 spent.
    expect(over.w / (inside.x1 - 2)).toBeCloseTo((1300 - 1200) / 1200, 2)
  })

  it('says "of" the contract value, or budget-only with no price', () => {
    render(<BulletChart {...props} />)
    expect(screen.getByText('$600 of $1,000')).toBeInTheDocument()
    expect(screen.getByText('$150 of $400 budget')).toBeInTheDocument()
    expect(screen.getByText('45 of 50 N')).toBeInTheDocument()
  })

  it('drills with Space and lists spend ÷ contract in the table', () => {
    const onSelect = vi.fn()
    render(<BulletChart {...props} onSelect={onSelect} />)
    fireEvent.keyDown(screen.getByRole('button', { name: /^SAMPLE-2/ }), { key: ' ' })
    expect(onSelect).toHaveBeenCalledWith(live[1])
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }))
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Survey' })).toBeInTheDocument()
    expect(within(table).getByText('60%')).toBeInTheDocument()
    expect(within(table).getByText('No price')).toBeInTheDocument()
  })

  it('calls a $0 price "given away", never "no price", and never divides by it', () => {
    const trial = [{ code: 'SAMPLE-9', spend: 300, contract: 0, budget: null, collected: 50, target: 50 }]
    render(<BulletChart {...props} data={trial} />)
    expect(screen.getByText('$300 · given away')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }))
    const table = screen.getByRole('table')
    expect(within(table).getByText('Given away ($0 price)')).toBeInTheDocument()
    expect(within(table).queryByText(/Infinity|NaN/)).not.toBeInTheDocument()
  })

  it('never counts a $0 price as an overrun, and names its hatch correctly', () => {
    const rows = [
      { code: 'SAMPLE-7', spend: 300, contract: 0, budget: null, collected: 50, target: 50 },
      { code: 'SAMPLE-8', spend: 100, contract: 1000, budget: null, collected: 20, target: 50 },
    ]
    const { container } = render(<BulletChart {...props} data={rows} goal={undefined} />)
    const summary = container.querySelector('svg')!.getAttribute('aria-label')!
    expect(summary).toContain('0 past the contract value')
    expect(summary).toContain('1 given away ($0 price)')
    expect(summary).not.toContain('no price')
    // The hatch legend says what the hatched row says.
    expect(screen.getByText('Given away ($0 price)')).toBeInTheDocument()
    expect(screen.queryByText('No price')).not.toBeInTheDocument()
    expect(screen.queryByText('Past the contract value')).not.toBeInTheDocument()
  })

  it('lets the page say why a row has no contract value', () => {
    const rows = [{ code: 'SAMPLE-6', spend: 200, contract: null, budget: null, collected: 10, target: 0 }]
    render(<BulletChart {...props} data={rows} missingMax={() => 'no target'} />)
    expect(screen.getByText('$200 · no target')).toBeInTheDocument()
    // Legend.
    expect(screen.getByText('No target')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }))
    expect(within(screen.getByRole('table')).getByText('No target')).toBeInTheDocument()
  })

  it('shows the empty state', () => {
    render(<BulletChart {...props} data={[]} />)
    expect(screen.getByText('No data in this view')).toBeInTheDocument()
  })
})
