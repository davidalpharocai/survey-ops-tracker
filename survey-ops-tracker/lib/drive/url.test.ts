import { describe, it, expect } from 'vitest'
import { assertHttpUrl, InvalidUrlError, extractDriveFileId } from './url'

const NUL = String.fromCharCode(0)
const TAB = String.fromCharCode(9)
const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)

describe('assertHttpUrl', () => {
  it('returns the normalized href for a valid https url', () => {
    expect(assertHttpUrl('https://example.com/path?a=1')).toBe('https://example.com/path?a=1')
  })

  it('normalizes an http url (adds path, lowercases scheme + host)', () => {
    expect(assertHttpUrl('HTTP://Example.COM')).toBe('http://example.com/')
  })

  it('tolerates surrounding whitespace and a trailing newline', () => {
    expect(assertHttpUrl('  https://example.com/x ' + LF)).toBe('https://example.com/x')
  })

  it('never returns a string containing CR or LF', () => {
    expect(assertHttpUrl('https://example.com/a/b?q=1#frag')).not.toMatch(/[\r\n]/)
  })

  // --- the .url / InternetShortcut injection threat model ---

  it('rejects an embedded CRLF + IconFile injection payload', () => {
    const payload = 'http://evil' + CR + LF + 'IconFile=\\\\attacker-host\\share\\icon.ico'
    expect(() => assertHttpUrl(payload)).toThrow(InvalidUrlError)
  })

  it('rejects a bare LF', () => {
    expect(() => assertHttpUrl('http://e' + LF + 'x')).toThrow(InvalidUrlError)
  })

  it('rejects other embedded control characters (NUL, TAB)', () => {
    expect(() => assertHttpUrl('http://e' + NUL + 'x')).toThrow(InvalidUrlError)
    expect(() => assertHttpUrl('http://e' + TAB + 'x')).toThrow(InvalidUrlError)
  })

  it('rejects the file: scheme', () => {
    expect(() => assertHttpUrl('file:///etc/passwd')).toThrow(InvalidUrlError)
  })

  it('rejects the javascript: scheme', () => {
    expect(() => assertHttpUrl('javascript:alert(1)')).toThrow(InvalidUrlError)
  })

  it('rejects the data: scheme', () => {
    expect(() => assertHttpUrl('data:text/html,<script>alert(1)</script>')).toThrow(InvalidUrlError)
  })

  it('rejects a UNC-style path (not a url)', () => {
    expect(() => assertHttpUrl('\\\\attacker-host\\share\\icon.ico')).toThrow(InvalidUrlError)
  })

  it('rejects unparseable input', () => {
    expect(() => assertHttpUrl('not a url')).toThrow(InvalidUrlError)
    expect(() => assertHttpUrl('')).toThrow(InvalidUrlError)
  })
})

describe('extractDriveFileId', () => {
  it('pulls the id from a Google Doc edit URL', () => {
    expect(extractDriveFileId('https://docs.google.com/document/d/1AbC_def-123/edit')).toBe('1AbC_def-123')
  })

  it('handles Sheets, Slides, and Forms /d/ paths', () => {
    expect(extractDriveFileId('https://docs.google.com/spreadsheets/d/SHEET1/edit#gid=0')).toBe('SHEET1')
    expect(extractDriveFileId('https://docs.google.com/presentation/d/SLIDES1/edit')).toBe('SLIDES1')
    expect(extractDriveFileId('https://docs.google.com/forms/d/FORM1/viewform')).toBe('FORM1')
  })

  it('handles drive.google.com /file/d/ and /drive/folders/', () => {
    expect(extractDriveFileId('https://drive.google.com/file/d/FILE1/view?usp=sharing')).toBe('FILE1')
    expect(extractDriveFileId('https://drive.google.com/drive/folders/FOLDER1')).toBe('FOLDER1')
  })

  it('handles ?id= style links', () => {
    expect(extractDriveFileId('https://drive.google.com/open?id=OPEN1')).toBe('OPEN1')
    expect(extractDriveFileId('https://drive.google.com/uc?id=UC1&export=download')).toBe('UC1')
  })

  it('returns null for non-Google, unparseable, or id-less URLs', () => {
    expect(extractDriveFileId('https://example.com/document/d/x/edit')).toBeNull()
    expect(extractDriveFileId('not a url')).toBeNull()
    expect(extractDriveFileId('https://docs.google.com/')).toBeNull()
  })

  it('is not fooled by a lookalike host', () => {
    expect(extractDriveFileId('https://docs.google.com.evil.com/document/d/x/edit')).toBeNull()
  })
})
