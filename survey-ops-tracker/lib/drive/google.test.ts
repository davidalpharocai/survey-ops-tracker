import { describe, it, expect, beforeEach, vi } from 'vitest'

// Capture the args passed to drive.files.list so we can inspect the `q` string
// that GoogleDrive.findChild builds. vi.hoisted keeps the mock fn available to
// the (hoisted) vi.mock factory below.
const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }))

vi.mock('googleapis', () => ({
  google: {
    auth: { JWT: class {} },
    drive: () => ({ files: { list: listMock } }),
  },
}))

// driveClient() decodes this base64 JSON before building the (mocked) JWT.
process.env.GOOGLE_SERVICE_ACCOUNT_KEY = Buffer.from(
  JSON.stringify({ client_email: 'test@example.com', private_key: 'test-key' }),
).toString('base64')

import { GoogleDrive } from './google'

const drive = new GoogleDrive()

function lastQuery(): string {
  const calls = listMock.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1][0].q as string
}

/**
 * Faithful model of how the Drive query language lexes a single-quoted string
 * literal: `\\` decodes to one backslash, `\'` decodes to one quote, and the
 * first UNescaped quote ends the literal. Returns the decoded value plus
 * everything after the closing quote.
 *
 * This is the inverse of findChild's escaping. If the escaping is correct,
 * `value` round-trips to the original name and `rest` is exactly the trailing
 * clause — which together PROVE the (possibly adversarial) name never broke out
 * of the literal. If the escape order were ever reversed, both assertions fail.
 */
function parseLiteralAfter(q: string, marker = "name = '"): { value: string; rest: string } {
  const start = q.indexOf(marker)
  if (start < 0) throw new Error(`marker ${JSON.stringify(marker)} not found in query: ${q}`)
  let i = start + marker.length
  let value = ''
  for (; i < q.length; i++) {
    const c = q[i]
    if (c === '\\') { value += q[++i] ?? ''; continue } // escaped char: take the next char literally
    if (c === "'") break                                // unescaped quote: end of literal
    value += c
  }
  return { value, rest: q.slice(i + 1) }
}

describe('GoogleDrive.findChild query construction', () => {
  beforeEach(() => {
    listMock.mockReset()
    listMock.mockResolvedValue({ data: { files: [] } })
  })

  it('builds the expected query for a benign name', async () => {
    await drive.findChild('folder-123', 'a.pdf')
    expect(lastQuery()).toBe("'folder-123' in parents and name = 'a.pdf' and trashed = false")
  })

  it("escapes single quotes so they can't terminate the literal", async () => {
    const name = "O'Brien's Q2 (final).pdf"
    await drive.findChild('p', name)
    const q = lastQuery()
    // each ' becomes \'
    expect(q).toContain("name = 'O\\'Brien\\'s Q2 (final).pdf'")
    expect(parseLiteralAfter(q)).toEqual({ value: name, rest: ' and trashed = false' })
  })

  it('escapes backslashes by doubling them', async () => {
    const name = String.raw`C:\reports\q2.pdf` // contains literal backslashes
    await drive.findChild('p', name)
    const q = lastQuery()
    expect(q).toContain(String.raw`name = 'C:\\reports\\q2.pdf'`)
    expect(parseLiteralAfter(q)).toEqual({ value: name, rest: ' and trashed = false' })
  })

  it('neutralizes a backslash-then-quote payload (escape ORDER matters)', async () => {
    // The classic break-out: a backslash immediately before a quote. If the code
    // escaped quotes BEFORE backslashes, the injected quote would escape the
    // literal. Backslash-first escaping (the current code) keeps it contained.
    const name = "\\'" // one backslash + one quote
    await drive.findChild('p', name)
    const q = lastQuery()
    expect(parseLiteralAfter(q)).toEqual({ value: name, rest: ' and trashed = false' })
  })

  // A battery of adversarial / attacker-influenceable filenames (the Phase-2
  // email-ingest threat model). Each must round-trip through the literal lexer
  // unchanged, with the trailing clause intact — proving no name can inject a
  // query clause regardless of its contents.
  const ADVERSARIAL: Array<[string, string]> = [
    ['clause injection via quote', "x' or trashed = false or name = '"],
    ['SQL-style tautology', "' or '1'='1"],
    ['backslash + quote + clause', String.raw`evil\' or name != '`],
    ['mimics the query structure', "a' and name = 'b"],
    ['trailing backslash', 'needs review\\'],
    ['leading backslash + quote', "\\\\'; rm -rf"],
    ['embedded newline control char', 'line1\nline2.pdf'],
    ['CRLF injection attempt', 'a\r\nname = \'b'],
    ['unicode plus quote', "report\u{1F642}'--"],
    ['only metacharacters', "\\'\\'\\'"],
  ]

  it.each(ADVERSARIAL)('contains an adversarial name within the literal: %s', async (_label, name) => {
    await drive.findChild('parent-folder-1', name)
    const q = lastQuery()
    const { value, rest } = parseLiteralAfter(q)
    expect(value).toBe(name)               // the name decodes back to itself
    expect(rest).toBe(' and trashed = false') // nothing leaked past the closing quote
  })

  it('also escapes names routed through findChildFolder (folder lookups)', async () => {
    // findChildFolder delegates to findChild, so folder-name lookups get the
    // same escaping. Covers the callers that pass folder names (e.g. client
    // folder "Name (CODE)") into the same query path.
    const name = "Acme O'Brien (Cl00042)"
    await drive.findChildFolder('shared-drive', name)
    expect(parseLiteralAfter(lastQuery())).toEqual({ value: name, rest: ' and trashed = false' })
  })
})
