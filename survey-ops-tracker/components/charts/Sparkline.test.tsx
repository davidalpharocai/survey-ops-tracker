import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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
})
