import { describe, it, expect } from 'vitest'
import {
  emailDomain, isInternalSender, parseAddressList, externalRecipient,
  forwardedOriginalRecipient, clientSignalEmail, emailDateISO, itemizeAttachments,
} from './email'

describe('emailDomain / isInternalSender', () => {
  it('lowercases the domain and detects alpharoc senders', () => {
    expect(emailDomain('"Jane Doe" <Jane@Coatue.com>')).toBe('coatue.com')
    expect(isInternalSender('analyst@alpharoc.ai')).toBe(true)
    expect(isInternalSender('Person <person@coatue.com>')).toBe(false)
    expect(isInternalSender('')).toBe(false)
  })
})

describe('parseAddressList', () => {
  it('extracts every address regardless of display-name commas', () => {
    expect(parseAddressList('"Doe, Jane" <jane@coatue.com>, ops@alpharoc.ai')).toEqual(['jane@coatue.com', 'ops@alpharoc.ai'])
  })
  it('accepts an array and de-dupes case-insensitively', () => {
    expect(parseAddressList(['A@Coatue.com', 'a@coatue.com'])).toEqual(['a@coatue.com'])
  })
  it('returns [] for undefined', () => {
    expect(parseAddressList(undefined)).toEqual([])
  })
})

describe('externalRecipient', () => {
  it('returns the first non-alpharoc address across To then Cc', () => {
    expect(externalRecipient('analyst@alpharoc.ai, pm@coatue.com', 'ops@alpharoc.ai')).toBe('pm@coatue.com')
  })
  it('falls back to Cc when To is all-internal', () => {
    expect(externalRecipient('analyst@alpharoc.ai', 'client@bam.com')).toBe('client@bam.com')
  })
  it('returns null when everyone is internal', () => {
    expect(externalRecipient('a@alpharoc.ai', 'b@alpharoc.ai')).toBeNull()
  })
})

describe('forwardedOriginalRecipient', () => {
  it('parses the To: line inside a Gmail forwarded-message block', () => {
    const body = [
      'FYI — sent this to the client.',
      '---------- Forwarded message ---------',
      'From: Jane <jane@alpharoc.ai>',
      'Date: Mon, Jun 15, 2026 at 9:02 AM',
      'Subject: Final topline',
      'To: Client Person <person@coatue.com>',
    ].join('\n')
    expect(forwardedOriginalRecipient(body)).toBe('person@coatue.com')
  })
  it('returns null when there is no forwarded block', () => {
    expect(forwardedOriginalRecipient('just a plain body')).toBeNull()
  })
})

describe('clientSignalEmail', () => {
  it('prefers the external To/Cc recipient (bcc/cc case)', () => {
    expect(clientSignalEmail({ to: 'pm@coatue.com', cc: '', body: '' })).toBe('pm@coatue.com')
  })
  it('falls back to the forwarded original recipient (forward case)', () => {
    const body = '---------- Forwarded message ---------\nTo: person@bam.com'
    expect(clientSignalEmail({ to: 'analyst@alpharoc.ai', cc: '', body })).toBe('person@bam.com')
  })
  it('returns null when nothing external is found', () => {
    expect(clientSignalEmail({ to: 'a@alpharoc.ai', cc: '', body: 'no headers' })).toBeNull()
  })
})

describe('emailDateISO', () => {
  it('parses an RFC-2822 Date header to ISO', () => {
    expect(emailDateISO('Mon, 15 Jun 2026 09:02:00 -0400', new Date('2000-01-01T00:00:00Z'))).toBe('2026-06-15T13:02:00.000Z')
  })
  it('uses the fallback when the header is missing or unparseable', () => {
    const fb = new Date('2026-06-24T00:00:00Z')
    expect(emailDateISO(undefined, fb)).toBe(fb.toISOString())
    expect(emailDateISO('not a date', fb)).toBe(fb.toISOString())
  })
})

describe('itemizeAttachments', () => {
  it('decodes base64, hashes, and keeps real files', () => {
    const items = itemizeAttachments([{ filename: 'Topline.pdf', mimeType: 'application/pdf', base64: Buffer.from('pdf-bytes').toString('base64') }])
    expect(items).toHaveLength(1)
    expect(items[0].filename).toBe('Topline.pdf')
    expect(items[0].bytes.toString()).toBe('pdf-bytes')
    expect(items[0].hash).toMatch(/^[0-9a-f]{64}$/)
  })
  it('skips zero-byte attachments and tiny inline images (signatures/logos)', () => {
    const items = itemizeAttachments([
      { filename: 'empty.bin', mimeType: 'application/octet-stream', base64: '' },
      { filename: 'logo.png', mimeType: 'image/png', base64: Buffer.from('x'.repeat(500)).toString('base64') },
      { filename: 'big-chart.png', mimeType: 'image/png', base64: Buffer.from('y'.repeat(20_000)).toString('base64') },
    ])
    expect(items.map((i) => i.filename)).toEqual(['big-chart.png'])
  })
  it('returns [] for undefined', () => {
    expect(itemizeAttachments(undefined)).toEqual([])
  })
})
