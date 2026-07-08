import { describe, it, expect } from 'vitest'
import { extractMessageId, stripQuotedHistory, tokenizeSurveyIds, parseParticipants } from './parse'

describe('extractMessageId', () => {
  it('extracts the RFC-822 Message-ID without angle brackets', () => {
    const raw = 'Received: by x\r\nMessage-ID: <CAF=abc123@mail.gmail.com>\r\nSubject: hi'
    expect(extractMessageId(raw)).toBe('CAF=abc123@mail.gmail.com')
  })
  it('is case-insensitive on the header name and tolerates no space', () => {
    expect(extractMessageId('message-id:<zzz@host>')).toBe('zzz@host')
    expect(extractMessageId('MESSAGE-ID:  <yyy@host>')).toBe('yyy@host')
  })
  it('matches even when the header is not the first line', () => {
    const raw = 'From: a@b.com\nTo: c@d.com\nMessage-ID: <mid@server>\n\nbody'
    expect(extractMessageId(raw)).toBe('mid@server')
  })
  it('returns null when absent', () => {
    expect(extractMessageId('Subject: no id here\nFrom: a@b.com')).toBeNull()
    expect(extractMessageId('')).toBeNull()
  })
})

describe('stripQuotedHistory', () => {
  it('keeps only the top reply, dropping the "On … wrote:" block', () => {
    const body = [
      'Thanks, looks great!',
      '',
      'On Mon, Jul 7, 2026 at 10:00 AM John Doe <john@acme.com> wrote:',
      '> Here is the draft.',
      '> Let me know.',
    ].join('\n')
    expect(stripQuotedHistory(body)).toBe('Thanks, looks great!')
  })
  it('handles a wrapped "On … wrote:" attribution spanning two lines', () => {
    const body = [
      'Approved.',
      'On Mon, Jul 7, 2026 at 10:00 AM John Doe <john@acme.com>',
      'wrote:',
      '> original',
    ].join('\n')
    expect(stripQuotedHistory(body)).toBe('Approved.')
  })
  it('drops a signature below the "-- " delimiter', () => {
    const body = ['See attached.', '', '-- ', 'John Doe', 'VP, Acme'].join('\n')
    expect(stripQuotedHistory(body)).toBe('See attached.')
  })
  it('drops "-----Original Message-----" (Outlook) blocks', () => {
    const body = ['Got it.', '-----Original Message-----', 'From: x', 'Sent: y'].join('\n')
    expect(stripQuotedHistory(body)).toBe('Got it.')
  })
  it('strips standalone quoted lines', () => {
    const body = ['My reply.', '> quoted 1', '> quoted 2'].join('\n')
    expect(stripQuotedHistory(body)).toBe('My reply.')
  })
  it('returns the trimmed body when there is no quoted history', () => {
    expect(stripQuotedHistory('  just a plain body  ')).toBe('just a plain body')
  })
})

describe('tokenizeSurveyIds', () => {
  it('splits on commas/whitespace/newlines, trims, uppercases, dedupes', () => {
    expect(tokenizeSurveyIds('js1a20260101, js1a20260101\n  bar20260202 ')).toEqual([
      'JS1A20260101',
      'BAR20260202',
    ])
  })
  it('returns [] for null / empty / whitespace', () => {
    expect(tokenizeSurveyIds(null)).toEqual([])
    expect(tokenizeSurveyIds('')).toEqual([])
    expect(tokenizeSurveyIds('   \n  ')).toEqual([])
  })
})

describe('parseParticipants', () => {
  it('extracts a lowercased addr-spec from "Name <a@b>"', () => {
    expect(parseParticipants('John Doe <John@Acme.com>', 'ops@alpharoc.ai')).toEqual({
      from_email: 'john@acme.com',
      to_emails: ['ops@alpharoc.ai'],
    })
  })
  it('handles a bare from address and a multi-recipient To with display-name commas', () => {
    expect(parseParticipants('plain@x.com', '"Doe, Jane" <jane@acme.com>, bob@y.com')).toEqual({
      from_email: 'plain@x.com',
      to_emails: ['jane@acme.com', 'bob@y.com'],
    })
  })
  it('dedupes recipients case-insensitively and returns null from when absent', () => {
    expect(parseParticipants('', 'A@X.com, a@x.com')).toEqual({
      from_email: null,
      to_emails: ['a@x.com'],
    })
  })
})
