import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NumberCell } from './NumberCell'
import { DateCell } from './DateCell'

describe('NumberCell', () => {
  it('evaluates a typed = formula and saves the numeric result', () => {
    const onSave = vi.fn()
    render(<NumberCell label="N target" value={null} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: /edit n target/i }))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '=4200+800' } })
    fireEvent.blur(input)

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(5000)
  })
})

describe('DateCell (date mode)', () => {
  it('shows an error and does NOT commit an impossible date', () => {
    const onSave = vi.fn()
    render(<DateCell label="Due date" value={null} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: /edit due date/i }))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '2/30/2026' } })
    fireEvent.blur(input)

    expect(screen.getByText('Not a real date')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('commits a valid typed date as an ISO string', () => {
    const onSave = vi.fn()
    render(<DateCell label="Due date" value={null} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: /edit due date/i }))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '7/6/2026' } })
    fireEvent.blur(input)

    expect(onSave).toHaveBeenCalledWith('2026-07-06')
  })
})
