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

  it('an unset value opens on a placeholder, not the first option, so picking the first option still saves', () => {
    const onSave = vi.fn()
    render(
      <SelectCell
        label="Type"
        value=""
        options={[
          { value: 'PS', label: 'PS' },
          { value: 'B2B', label: 'B2B' },
        ]}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /edit type/i }))
    const select = screen.getByRole('combobox') as HTMLSelectElement

    // Regression: without the placeholder option the browser falls back to the
    // first option, so the select reads 'PS' while the field shows "— set" —
    // and choosing PS fires no change event, silently saving nothing.
    expect(select.value).toBe('')

    fireEvent.change(select, { target: { value: 'PS' } })
    expect(onSave).toHaveBeenCalledWith('PS')
  })

  it('choosing the placeholder closes without saving', () => {
    const onSave = vi.fn()
    render(
      <SelectCell
        label="Type"
        value=""
        options={[{ value: 'PS', label: 'PS' }]}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /edit type/i }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})

/* A COPYABLE FIELD MUST STILL LOOK EDITABLE.
   TextCell sets valueInteractive = copyable && hasValue, which hands the value's
   click to the copy control. That left the hover-reveal pencil as the only route
   into the editor — and a field whose sole affordance is invisible reads as
   read-only. David hit exactly this on PR00426's Survey IDs and reported the
   field as uneditable. The same field was ALSO inconsistent with itself: empty it
   was click-to-edit, filled it was click-to-copy. */
describe('TextCell: the edit affordance survives copyable', () => {
  it('keeps the pencil visible when the value click is taken by copy', () => {
    render(<TextCell label="Survey IDs" value="AWRVTUK20260908" copyable onSave={vi.fn()} />)
    const pencil = screen.getByRole('button', { name: /edit survey ids/i })
    expect(pencil.className).toContain('opacity-100')
    expect(pencil.className).not.toContain('opacity-0')
  })

  it('still opens the editor from that pencil', () => {
    const onSave = vi.fn()
    render(<TextCell label="Survey IDs" value="AWRVTUK20260908" copyable onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: /edit survey ids/i }))
    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('AWRVTUK20260908')
    fireEvent.change(input, { target: { value: 'AWRVTUK20260908, AWRVTFR20260908' } })
    fireEvent.blur(input)
    expect(onSave).toHaveBeenCalledWith('AWRVTUK20260908, AWRVTFR20260908')
  })

  it('leaves the pencil hover-only on an ordinary field, where clicking the value also edits', () => {
    render(<TextCell label="Objective" value="Some text" onSave={vi.fn()} />)
    expect(screen.getByRole('button', { name: /edit objective/i }).className).toContain('opacity-0')
  })
})
