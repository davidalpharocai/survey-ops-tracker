import { describe, it, expect } from 'vitest'
import {
  attachmentUrl, isInternalAttachment, attachmentPath, attachmentStoragePath, formatOf,
  ATTACHMENT_ROUTE,
} from './attachments'

describe('attachmentUrl / attachmentPath', () => {
  it('round-trips a path', () => {
    const p = 'abc-123/1758000000000-Tab plan v2.xlsx'
    expect(attachmentPath(attachmentUrl(p))).toBe(p)
  })

  it('survives spaces, slashes and other url-significant characters', () => {
    const p = 'abc/1-a b&c=d+e.xlsx'
    expect(attachmentPath(attachmentUrl(p))).toBe(p)
  })

  it('returns null for a pasted link rather than guessing', () => {
    expect(attachmentPath('https://docs.google.com/document/d/x/edit')).toBeNull()
    expect(attachmentPath(null)).toBeNull()
  })

  it('returns null for the route with no path', () => {
    expect(attachmentPath(ATTACHMENT_ROUTE)).toBeNull()
  })
})

describe('isInternalAttachment', () => {
  it('is true only for this app’s own file route', () => {
    expect(isInternalAttachment(attachmentUrl('p/1-a.pdf'))).toBe(true)
    expect(isInternalAttachment('https://docs.google.com/document/d/x/edit')).toBe(false)
    expect(isInternalAttachment('https://drive.google.com/file/d/x/view')).toBe(false)
  })

  it('is false for null, empty and non-strings', () => {
    expect(isInternalAttachment(null)).toBe(false)
    expect(isInternalAttachment(undefined)).toBe(false)
    expect(isInternalAttachment('')).toBe(false)
  })

  // The compliance panel offers linked_documents[0] to an EXTERNAL reviewer.
  // A lookalike host must not be able to pose as an internal route, and an
  // internal route must never be mistaken for a shareable link.
  it('does not match a remote url that merely contains the route', () => {
    expect(isInternalAttachment('https://evil.example.com/api/project-files?path=x')).toBe(false)
  })
})

describe('attachmentStoragePath', () => {
  it('is project-scoped and timestamped', () => {
    expect(attachmentStoragePath('proj1', 'Tab plan.xlsx', 1758000000000))
      .toBe('proj1/1758000000000-Tab plan.xlsx')
  })

  it('strips characters that could climb out of the folder', () => {
    const p = attachmentStoragePath('proj1', '../../etc/passwd', 1)
    // Slashes become underscores, then the leading dots are stripped -- so the
    // name cannot traverse and cannot be hidden.
    expect(p).toBe('proj1/1-_.._etc_passwd')
    expect(p.split('/').length).toBe(2)
    expect(p).not.toContain('..' + '/')
  })

  it('refuses to produce a leading-dot name', () => {
    expect(attachmentStoragePath('p', '...hidden', 1)).toBe('p/1-hidden')
  })

  it('falls back to a name rather than producing an empty one', () => {
    expect(attachmentStoragePath('p', '', 1)).toBe('p/1-file')
  })

  it('bounds a pathological file name', () => {
    const p = attachmentStoragePath('p', 'a'.repeat(500) + '.xlsx', 1)
    expect(p.length).toBeLessThan(140)
  })
})

describe('formatOf', () => {
  it('reads the extension', () => {
    expect(formatOf('databook.XLSX')).toBe('xlsx')
    expect(formatOf('notes.pdf')).toBe('pdf')
  })

  it('is null with no extension, which is not the same as an empty one', () => {
    expect(formatOf('README')).toBeNull()
    expect(formatOf('archive.')).toBeNull()
  })
})
