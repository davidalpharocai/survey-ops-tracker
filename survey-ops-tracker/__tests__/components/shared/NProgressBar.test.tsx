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
  it('shows dash when target is null', () => {
    render(<NProgressBar collected={300} target={null} />)
    expect(screen.getByText('300 / —')).toBeInTheDocument()
  })
  it('renders without label when showLabel is false', () => {
    const { container } = render(<NProgressBar collected={300} target={400} showLabel={false} />)
    expect(screen.queryByText('300 / 400')).not.toBeInTheDocument()
    // progress bar container should still render
    expect(container.firstChild).not.toBeNull()
  })
})
