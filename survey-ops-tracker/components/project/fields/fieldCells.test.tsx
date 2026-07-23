import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NumberCell } from './NumberCell'
import { DateCell } from './DateCell'
import { TextCell } from './TextCell'
import { SelectCell } from './SelectCell'

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

  it('does NOT save unparseable input (value preserved) and shows a hint', () => {
    const onSave = vi.fn()
    render(<NumberCell label="N target" value={1200} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: /edit n target/i }))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.blur(input)

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Not a number')).toBeInTheDocument()
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

describe('TextCell', () => {
  it('commits the trimmed text on blur', () => {
    const onSave = vi.fn()
    render(<TextCell label="Client" value={null} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: /edit client/i }))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '  Acme Corp  ' } })
    fireEvent.blur(input)

    expect(onSave).toHaveBeenCalledWith('Acme Corp')
  })

  it('cancels on Escape without calling onSave', () => {
    const onSave = vi.fn()
    render(<TextCell label="Client" value="Original" onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: /edit client/i }))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Changed' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})

describe('SelectCell', () => {
  it('commits the chosen option on change', () => {
    const onSave = vi.fn()
    render(
      <SelectCell
        label="Type"
        value="PS"
        options={[
          { value: 'PS', label: 'PS' },
          { value: 'B2B', label: 'B2B' },
        ]}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /edit type/i }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'B2B' } })

    expect(onSave).toHaveBeenCalledWith('B2B')
  })
})
