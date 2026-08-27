import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { readSegmentNote, SegmentNote } from './NSegmentsEditor'

// jest-dom matchers are deliberately not used here (`toBeInTheDocument` is the
// source of the repo's pre-existing tsc errors in test files) — plain truthiness
// assertions say the same thing and keep `tsc --noEmit` clean.

describe('readSegmentNote (dark-ship probe for migration 084)', () => {
  // useProjectSegments selects `*`, so the shape of the row IS the schema
  // signal: pre-084 there is no `note` key at all, post-084 there is one holding
  // null. Everything the UI does about the note hangs off this distinction.
  const base = { id: 's1', project_id: 'p1', label: 'Buyers', n_target: 500 }

  it('reports the column as unsupported for a pre-084 row, so nothing is rendered', () => {
    expect(readSegmentNote(base)).toEqual({ supported: false, note: null })
  })

  it('reports it supported once the column exists, even while the note is null', () => {
    // This is the case that must NOT be confused with the one above: the column
    // is there, so the "＋ Note" trigger has to appear.
    expect(readSegmentNote({ ...base, note: null })).toEqual({ supported: true, note: null })
  })

  it('returns the note text when there is one', () => {
    expect(readSegmentNote({ ...base, note: 'Oversample: client asked' })).toEqual({
      supported: true,
      note: 'Oversample: client asked',
    })
  })

  it('treats an empty or whitespace-only note as no note, but keeps supported true', () => {
    // A row touched by SQL or the connector can hold '' where the editor would
    // have written null — it must not render as a blank note row.
    expect(readSegmentNote({ ...base, note: '' })).toEqual({ supported: true, note: null })
    expect(readSegmentNote({ ...base, note: '   \n ' })).toEqual({ supported: true, note: null })
  })

  it('survives a null/undefined row instead of throwing', () => {
    expect(readSegmentNote(null)).toEqual({ supported: false, note: null })
    expect(readSegmentNote(undefined)).toEqual({ supported: false, note: null })
  })
})

function renderNote(
  over: Partial<React.ComponentProps<typeof SegmentNote>> = {},
) {
  const onSave = vi.fn()
  const onOpen = vi.fn()
  const onClose = vi.fn()
  const utils = render(
    <SegmentNote
      note={null}
      editing={false}
      onOpen={onOpen}
      onClose={onClose}
      onSave={onSave}
      {...over}
    />,
  )
  return { ...utils, onSave, onOpen, onClose }
}

const area = () => screen.getByLabelText('Segment note') as HTMLTextAreaElement

describe('SegmentNote', () => {
  it('renders NOTHING when the segment has no note — no row, no empty box', () => {
    // The height guarantee: a segment card already carries a label, an N range,
    // an internal target, collected, actual, audience, audience size and a price
    // override. An empty note must not add a pixel to that; the "＋ Note"
    // trigger lives in the card's existing header row instead.
    const { container } = renderNote({ note: null, editing: false })
    expect(container.childElementCount).toBe(0)
  })

  it('shows the note, and the WHOLE LINE opens the editor (blast-description treatment)', () => {
    const { onOpen } = renderNote({ note: 'Regional quota — client asked' })

    fireEvent.click(screen.getByText('Regional quota — client asked'))
    expect(onOpen).toHaveBeenCalledTimes(1)

    // The hover pencil is a second way in, not the only way in.
    fireEvent.click(screen.getByRole('button', { name: /edit note/i }))
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('says out loud that the note belongs to this segment, not the project', () => {
    renderNote({ note: 'Anything' })
    // InfoTooltip puts its text on the trigger's aria-label.
    expect(screen.getByLabelText(/THIS SEGMENT only/i)).toBeTruthy()
  })

  it('keeps a long note to one line and hands the full text to the title', () => {
    const long =
      'Client moved the Sellers quota twice: first to 400 after the pilot came back light, ' +
      'then back to 500 once the incidence estimate was revised. Fielding notes are in the ' +
      'Slack channel, and the regional split is deliberately uneven.'
    renderNote({ note: long })

    const line = screen.getByTitle(long)
    // FieldCell clips the value slot; this span carries the clip so a long note
    // can never stretch the card, and title= keeps all of it readable on hover.
    expect(line.className).toContain('truncate')
    expect(line.textContent).toBe(long)
  })

  it('seeds the textarea from the stored note and saves the trimmed text', () => {
    const { onSave, onClose } = renderNote({ note: 'old note', editing: true })
    expect(area().value).toBe('old note')

    fireEvent.change(area(), { target: { value: '  Buyers skew younger  ' } })
    fireEvent.blur(area())

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('Buyers skew younger')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clears to null, never to an empty string', () => {
    // '' would read as "there is a note, it is blank" everywhere downstream —
    // readSegmentNote normalises it, but the write should not create it.
    const { onSave } = renderNote({ note: 'old note', editing: true })

    fireEvent.change(area(), { target: { value: '   ' } })
    fireEvent.blur(area())

    expect(onSave).toHaveBeenCalledWith(null)
  })

  it('writes nothing when the note comes back unchanged', () => {
    // Opening and closing a note should not spend a round trip or refetch the
    // segment list.
    const { onSave, onClose } = renderNote({ note: 'unchanged', editing: true })

    fireEvent.blur(area())

    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('cancels on Escape, keeping the stored note', () => {
    const { onSave, onClose } = renderNote({ note: 'keep me', editing: true })

    area().focus()
    fireEvent.change(area(), { target: { value: 'discard me' } })
    fireEvent.keyDown(area(), { key: 'Escape' })

    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('saves on ⌘/Ctrl+Enter — plain Enter stays a newline', () => {
    const { onSave } = renderNote({ note: null, editing: true })

    area().focus()
    fireEvent.change(area(), { target: { value: 'first line' } })
    fireEvent.keyDown(area(), { key: 'Enter' })
    expect(onSave).not.toHaveBeenCalled()

    fireEvent.keyDown(area(), { key: 'Enter', ctrlKey: true })
    expect(onSave).toHaveBeenCalledWith('first line')
  })
})
