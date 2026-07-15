import { describe, it, expect } from 'vitest'
import { sanitizeName, isoToDot, projectFolderName, deliverableFileName, originalSendDate } from './naming'

describe('deliverables/naming', () => {
  it('isoToDot turns an ISO date into YYYY.MM.DD', () => {
    expect(isoToDot('2026-06-10')).toBe('2026.06.10')
    expect(isoToDot('2026-06-10T14:03:00Z')).toBe('2026.06.10')
  })

  it('sanitizeName strips path-hostile characters', () => {
    expect(sanitizeName('Top/line: "final"?')).toBe('Top-line- -final--')
    expect(sanitizeName('  a   b  ')).toBe('a b')
  })

  it('projectFolderName = name_code_date', () => {
    expect(projectFolderName('Q2 Consumer Tracker', 'PR00112', '2026-06-10'))
      .toBe('Q2 Consumer Tracker_PR00112_2026.06.10')
  })

  it('projectFolderName omits the date for a rerun (longitudinal) — one parent folder holds every wave', () => {
    expect(projectFolderName('Holocene Tracker', 'PR00149', '2026-07-15', true))
      .toBe('Holocene Tracker_PR00149')
  })

  it('deliverableFileName prefixes the dotted date', () => {
    expect(deliverableFileName('2026-06-10', 'Topline.pdf')).toBe('2026.06.10 — Topline.pdf')
  })

  it('originalSendDate prefers the forwarded header block, falls back to the message date', () => {
    const fwd = 'See attached.\n\n---------- Forwarded message ---------\nFrom: a@b.com\nDate: Mon, Jun 1, 2026 at 9:14 AM\nSubject: x\n'
    expect(originalSendDate(fwd, '2026-06-15T00:00:00Z').slice(0, 10)).toBe('2026-06-01')
    expect(originalSendDate('no block here', '2026-06-15T00:00:00Z')).toBe('2026-06-15T00:00:00Z')
  })
})
