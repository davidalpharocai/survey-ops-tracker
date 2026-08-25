import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NRangeCell } from './NSegmentsEditor'

const open = () => fireEvent.click(screen.getByRole('button', { name: /edit n target/i }))
const minBox = () => screen.getByLabelText('N Target minimum')
const maxBox = () => screen.getByLabelText('N Target maximum')

describe('NRangeCell', () => {
  it('displays a single number when both ends agree, and a range when they differ', () => {
    const { rerender } = render(
      <NRangeCell label="N Target" min={1350} max={1350} onSave={vi.fn()} />,
    )
    expect(screen.getByText('1,350')).toBeInTheDocument()

    rerender(<NRangeCell label="N Target" min={1350} max={1600} onSave={vi.fn()} />)
    expect(screen.getByText('1,350 – 1,600')).toBeInTheDocument()
  })

  it('fills BOTH ends from one typed number — the common single-N case', () => {
    const onSave = vi.fn()
    render(<NRangeCell label="N Target" min={null} max={null} onSave={onSave} />)

    open()
    fireEvent.change(minBox(), { target: { value: '1350' } })
    fireEvent.blur(minBox())

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith({ min: 1350, max: 1350 })
  })

  it('opens with an empty max box when the two ends already match', () => {
    render(<NRangeCell label="N Target" min={1350} max={1350} onSave={vi.fn()} />)

    open()
    expect((minBox() as HTMLInputElement).value).toBe('1350')
    // Changing an agreed N has to stay ONE edit, so the max box starts blank
    // behind its "same as min" placeholder rather than repeating the number.
    expect((maxBox() as HTMLInputElement).value).toBe('')
  })

  it('widens a range in a SINGLE save carrying both columns (the pair-write contract)', () => {
    // Migration 078 raises on max < min and only sees what the patch carries, so
    // 100..200 -> 1000..2000 must never go out as two one-ended writes.
    const onSave = vi.fn()
    render(<NRangeCell label="N Target" min={100} max={200} onSave={onSave} />)

    open()
    fireEvent.change(minBox(), { target: { value: '1000' } })
    fireEvent.change(maxBox(), { target: { value: '2000' } })
    fireEvent.blur(maxBox())

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith({ min: 1000, max: 2000 })
  })

  it('narrows a range in a single save too', () => {
    const onSave = vi.fn()
    render(<NRangeCell label="N Target" min={1000} max={2000} onSave={onSave} />)

    open()
    fireEvent.change(minBox(), { target: { value: '100' } })
    fireEvent.change(maxBox(), { target: { value: '200' } })
    fireEvent.blur(minBox())

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith({ min: 100, max: 200 })
  })

  it('clearing the max collapses back to one agreed number', () => {
    const onSave = vi.fn()
    render(<NRangeCell label="N Target" min={1000} max={2000} onSave={onSave} />)

    open()
    fireEvent.change(maxBox(), { target: { value: '' } })
    fireEvent.blur(maxBox())

    expect(onSave).toHaveBeenCalledWith({ min: 1000, max: 1000 })
  })

  it('explains a transposed range instead of saving it', () => {
    const onSave = vi.fn()
    render(<NRangeCell label="N Target" min={null} max={null} onSave={onSave} />)

    open()
    fireEvent.change(minBox(), { target: { value: '1000' } })
    fireEvent.change(maxBox(), { target: { value: '100' } })
    fireEvent.blur(maxBox())

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText(/is below min/i)).toBeInTheDocument()
    // Editor stays open on the offending values so they can be swapped.
    expect(maxBox()).toBeInTheDocument()
  })

  it('does not save unparseable input, and leaves both stored values alone', () => {
    const onSave = vi.fn()
    render(<NRangeCell label="N Target" min={1000} max={2000} onSave={onSave} />)

    open()
    fireEvent.change(maxBox(), { target: { value: 'abc' } })
    fireEvent.blur(maxBox())

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Not a number')).toBeInTheDocument()
  })

  it('accepts the same = formulas and comma grouping as the number cells', () => {
    const onSave = vi.fn()
    render(<NRangeCell label="N Target" min={null} max={null} onSave={onSave} />)

    open()
    fireEvent.change(minBox(), { target: { value: '1,350' } })
    fireEvent.change(maxBox(), { target: { value: '=1350+250' } })
    fireEvent.blur(maxBox())

    expect(onSave).toHaveBeenCalledWith({ min: 1350, max: 1600 })
  })

  it('clearing both ends saves nulls rather than a half pair', () => {
    const onSave = vi.fn()
    render(<NRangeCell label="N Target" min={1000} max={2000} onSave={onSave} />)

    open()
    fireEvent.change(minBox(), { target: { value: '' } })
    fireEvent.change(maxBox(), { target: { value: '' } })
    fireEvent.blur(minBox())

    expect(onSave).toHaveBeenCalledWith({ min: null, max: null })
  })

  it('cancels on Escape without saving', () => {
    const onSave = vi.fn()
    render(<NRangeCell label="N Target" min={1000} max={2000} onSave={onSave} />)

    open()
    fireEvent.change(minBox(), { target: { value: '5000' } })
    fireEvent.keyDown(minBox(), { key: 'Escape' })

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('N Target minimum')).not.toBeInTheDocument()
  })
})
