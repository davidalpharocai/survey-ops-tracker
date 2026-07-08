import { describe, it, expect, vi } from 'vitest'
import { FakeDrive } from '@/lib/drive/fake'
import { ingestEmail, type IngestDeps, type EmailDeliverableRow, type MatchData } from './email-ingest'
import type { IngestPayload } from './email'
import { sha256 } from './dedup'

const matchData: MatchData = {
  clients: [{ id: 'c1', name: 'Coatue', code: 'CL001' }],
  projects: [{ id: 'p1', client_id: 'c1', project_code: 'PR00003', project_name: 'B2B Tracker' }],
  contacts: [{ email: 'pm@coatue.com', client_id: 'c1', project_id: 'p1' }],
  domainMap: { 'coatue.com': 'c1' },
}

function makeDeps(drive: FakeDrive, over: Partial<IngestDeps> = {}): { deps: IngestDeps; rows: EmailDeliverableRow[]; replies: { to: string; subject: string }[] } {
  const rows: EmailDeliverableRow[] = []
  const replies: { to: string; subject: string }[] = []
  const deps: IngestDeps = {
    drive,
    sharedDriveId: 'root',
    matchData,
    appUrl: 'https://app.example.com',
    now: new Date('2026-06-24T12:00:00Z'),
    isProcessed: async () => false,
    clientFolderId: async () => drive.createFolderIfMissing('root', 'Coatue'),
    findDup: async () => null,
    persist: async (row) => { rows.push(row) },
    reply: async (to, subject) => { replies.push({ to, subject }) },
    ...over,
  }
  return { deps, rows, replies }
}

const pdfPayload: IngestPayload = {
  from: 'analyst@alpharoc.ai',
  to: 'pm@coatue.com',
  cc: '',
  subject: 'Final topline',
  date: 'Mon, 15 Jun 2026 09:02:00 -0400',
  messageId: 'msg-1',
  body: 'See attached.',
  attachments: [{ filename: 'Topline.pdf', mimeType: 'application/pdf', base64: Buffer.from('pdf').toString('base64') }],
}

describe('ingestEmail', () => {
  it('auto-files a confident bcc deliverable and replies "Filed"', async () => {
    const drive = new FakeDrive('root')
    const { deps, rows, replies } = makeDeps(drive)
    const out = await ingestEmail(pdfPayload, deps)

    expect(out).toEqual({ action: 'processed', filed: 1, queued: 0, duplicates: 0 })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ client_id: 'c1', project_id: 'p1', status: 'filed', source: 'email', kind: 'file', gmail_message_id: 'msg-1', forwarded_by: 'analyst@alpharoc.ai' })
    expect(replies[0].subject).toContain('Filed')
    const client = await drive.findChildFolder('root', 'Coatue')
    const proj = await drive.findChildFolder(client!, 'B2B Tracker_PR00003_2026.06.15')
    expect(await drive.findChild(proj!, '2026.06.15 — Topline.pdf')).toBeTruthy()
  })

  it('stages an ambiguous deliverable in the review queue', async () => {
    const drive = new FakeDrive('root')
    const { deps, rows, replies } = makeDeps(drive)
    const out = await ingestEmail({ ...pdfPayload, to: 'unknown@randomco.com', body: 'no hints', messageId: 'msg-2' }, deps)

    expect(out).toEqual({ action: 'processed', filed: 0, queued: 1, duplicates: 0 })
    expect(rows[0]).toMatchObject({ client_id: null, project_id: null, status: 'review' })
    expect(replies[0].subject).toContain('Needs a quick review')
    expect(await drive.findChildFolder('root', '00_Needs Review')).toBeTruthy()
  })

  it('skips an exact duplicate without persisting or re-uploading', async () => {
    const drive = new FakeDrive('root')
    const { deps, rows } = makeDeps(drive, { findDup: async () => 'existing-id' })
    const out = await ingestEmail({ ...pdfPayload, messageId: 'msg-3' }, deps)
    expect(out).toEqual({ action: 'processed', filed: 0, queued: 0, duplicates: 1 })
    expect(rows).toHaveLength(0)
  })

  it('does not re-stage a review copy when the attachment is already filed elsewhere (global content dedup)', async () => {
    const drive = new FakeDrive('root')
    // Ambiguous recipient → would normally route to 00_Needs Review, but this exact file is already in the depository.
    const { deps, rows, replies } = makeDeps(drive, { findDup: async () => 'already-filed-id' })
    const out = await ingestEmail({ ...pdfPayload, to: 'unknown@randomco.com', body: 'no hints', messageId: 'msg-dup-elsewhere' }, deps)
    expect(out).toEqual({ action: 'processed', filed: 0, queued: 0, duplicates: 1 })
    expect(rows).toHaveLength(0)                                                 // no review row created
    expect(replies[0].subject).toContain('Already filed')
    expect(await drive.findChildFolder('root', '00_Needs Review')).toBeFalsy()   // and no empty review folder created
  })

  it('ignores a link-only email — links are not auto-filed (attachments only)', async () => {
    const drive = new FakeDrive('root')
    const { deps, rows } = makeDeps(drive)
    const out = await ingestEmail({
      ...pdfPayload, messageId: 'msg-4', attachments: [],
      body: 'Here is the dashboard: https://docs.google.com/spreadsheets/d/abc/edit',
    }, deps)
    expect(out).toEqual({ action: 'ignored', reason: 'no_items' })
    expect(rows).toHaveLength(0)
  })

  it('ignores a non-alpharoc sender (no Drive writes, no persist, no reply)', async () => {
    const drive = new FakeDrive('root')
    const createSpy = vi.spyOn(drive, 'createFolder')
    const { deps, rows, replies } = makeDeps(drive)
    const out = await ingestEmail({ ...pdfPayload, from: 'attacker@coatue.com', messageId: 'msg-5' }, deps)
    expect(out).toEqual({ action: 'ignored', reason: 'external_sender' })
    expect(createSpy).not.toHaveBeenCalled()
    expect(rows).toHaveLength(0)
    expect(replies).toHaveLength(0)
  })

  it('no-ops on an already-processed message id', async () => {
    const drive = new FakeDrive('root')
    const { deps, rows } = makeDeps(drive, { isProcessed: async () => true })
    const out = await ingestEmail({ ...pdfPayload, messageId: 'msg-1' }, deps)
    expect(out).toEqual({ action: 'ignored', reason: 'duplicate_message' })
    expect(rows).toHaveLength(0)
  })

  it('ignores an internal email with no attachments or deliverable links', async () => {
    const drive = new FakeDrive('root')
    const { deps } = makeDeps(drive)
    const out = await ingestEmail({ ...pdfPayload, messageId: 'msg-6', attachments: [], body: 'just a note, no links' }, deps)
    expect(out).toEqual({ action: 'ignored', reason: 'no_items' })
  })

  it('files multiple attachments from one email into the same folder (ignoring any body link)', async () => {
    const drive = new FakeDrive('root')
    const { deps, rows } = makeDeps(drive)
    const out = await ingestEmail({
      ...pdfPayload, messageId: 'msg-multi',
      attachments: [
        { filename: 'Topline.pdf', mimeType: 'application/pdf', base64: Buffer.from('aaa').toString('base64') },
        { filename: 'Crosstabs.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: Buffer.from('bbb').toString('base64') },
      ],
      body: 'See attached, plus https://docs.google.com/spreadsheets/d/zzz/edit',
    }, deps)
    expect(out).toEqual({ action: 'processed', filed: 2, queued: 0, duplicates: 0 })
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.drive_folder_id)).size).toBe(1)
  })

  it('skips a duplicate item but files its new sibling in the same email', async () => {
    const drive = new FakeDrive('root')
    const dupHash = sha256(Buffer.from('dupe'))
    const { deps, rows } = makeDeps(drive, { findDup: async (opts) => (opts.fileHash === dupHash ? 'existing-id' : null) })
    const out = await ingestEmail({
      ...pdfPayload, messageId: 'msg-mixed',
      attachments: [
        { filename: 'Old.pdf', mimeType: 'application/pdf', base64: Buffer.from('dupe').toString('base64') },
        { filename: 'New.pdf', mimeType: 'application/pdf', base64: Buffer.from('fresh').toString('base64') },
      ],
    }, deps)
    expect(out).toEqual({ action: 'processed', filed: 1, queued: 0, duplicates: 1 })
    expect(rows).toHaveLength(1)
    expect(rows[0].original_file_name).toBe('New.pdf')
  })
})
