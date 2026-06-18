import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { NProgressBar } from '@/components/shared/NProgressBar'

describe('NProgressBar', () => {
  it('shows collected and target values', () => {
    render(<NProgressBar collected={300} target={400} />)
    expect(screen.getByText('300 / 400')).toBeInTheDocument()
  })
  it('shows checkmark when target is met', () => {
    render(<NProgressBar collected={400} target={400} />)
    expect(screen.getByText(/✓/)).toBeInTheDocument()
  })
  it('shows dash when collected is null', () => {
    render(<NProgressBar collected={null} target={400} />)
    expect(screen.getByText('— / 400')).toBeInTheDocument()
  })
  it('shows a "no target" line (not an empty bar) when target is null', () => {
    render(<NProgressBar collected={300} target={null} />)
    expect(screen.getByText('300 collected · no target')).toBeInTheDocument()
  })
  it('shows "No target set" when there is no target and nothing collected', () => {
    render(<NProgressBar collected={0} target={null} />)
    expect(screen.getByText('No target set')).toBeInTheDocument()
  })
  it('renders nothing when target is null and the label is hidden (bare hero use)', () => {
    const { container } = render(<NProgressBar collected={0} target={null} showLabel={false} />)
    expect(container.firstChild).toBeNull()
  })
  it('renders without label when showLabel is false', () => {
    const { container } = render(<NProgressBar collected={300} target={400} showLabel={false} />)
    expect(screen.queryByText('300 / 400')).not.toBeInTheDocument()
    // progress bar container should still render
    expect(container.firstChild).not.toBeNull()
  })
})
