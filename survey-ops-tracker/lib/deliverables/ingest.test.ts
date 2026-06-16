import { describe, it, expect } from 'vitest'
import { fileDeliverable, type FileInput, type FolderResolver } from './ingest'
import { FakeDrive } from '@/lib/drive/fake'

function resolver(drive: FakeDrive): FolderResolver {
  return {
    sharedDriveId: 'root',
    clientFolderId: async () => drive.createFolderIfMissing('root', 'Balyasny (BAM)'),
    projectFolderName: () => 'Q2 Consumer Tracker_PR00112_2026.06.10',
    needsReviewFolderName: '00_Needs Review',
    unsortedFolderName: '_Unsorted',
  }
}

describe('fileDeliverable', () => {
  it('files a confident attachment into Client/Project and returns a filed record', async () => {
    const drive = new FakeDrive('root')
    const input: FileInput = {
      kind: 'file', confident: true, hasProject: true,
      original_file_name: 'Topline.pdf', mimeType: 'application/pdf',
      bytes: Buffer.from('pdf'), dateISO: '2026-06-10',
    }
    const rec = await fileDeliverable(drive, resolver(drive), input)
    expect(rec.status).toBe('filed')
    expect(rec.kind).toBe('file')
    expect(rec.drive_file_id).toBeTruthy()
    // file lives in the project folder, named with the dotted date
    const clientFolder = await drive.findChildFolder('root', 'Balyasny (BAM)')
    const projFolder = await drive.findChildFolder(clientFolder!, 'Q2 Consumer Tracker_PR00112_2026.06.10')
    expect((await drive.findChild(projFolder!, '2026.06.10 — Topline.pdf'))?.id).toBe(rec.drive_file_id)
  })

  it('stages an unconfident item in 00_Needs Review', async () => {
    const drive = new FakeDrive('root')
    const input: FileInput = { kind: 'file', confident: false, hasProject: false, original_file_name: 'x.pdf', mimeType: 'application/pdf', bytes: Buffer.from('x'), dateISO: '2026-06-10' }
    const rec = await fileDeliverable(drive, resolver(drive), input)
    expect(rec.status).toBe('review')
    const staging = await drive.findChildFolder('root', '00_Needs Review')
    expect((await drive.findChild(staging!, '2026.06.10 — x.pdf'))?.id).toBe(rec.drive_file_id)
  })

  it('files a Google-native link as a shortcut', async () => {
    const drive = new FakeDrive('root')
    const input: FileInput = { kind: 'link', confident: true, hasProject: true, source_url: 'https://docs.google.com/spreadsheets/d/abc/edit', dateISO: '2026-06-10', original_file_name: 'Q2 Sheet' }
    const rec = await fileDeliverable(drive, resolver(drive), input)
    expect(rec.status).toBe('filed')
    expect(rec.kind).toBe('link')
    expect(rec.drive_file_id).toBeTruthy()
  })

  it('files a Google Drive folder link (with id) as a shortcut', async () => {
    const drive = new FakeDrive('root')
    const input: FileInput = {
      kind: 'link', confident: true, hasProject: true,
      source_url: 'https://drive.google.com/drive/folders/1AbCdef',
      dateISO: '2026-06-10', original_file_name: 'Client Folder',
    }
    const rec = await fileDeliverable(drive, resolver(drive), input)
    expect(rec.status).toBe('filed')
    expect(rec.kind).toBe('link')
    // drive created a shortcut (not a bookmark) — verify by checking the mimeType stored
    const clientFolder = await drive.findChildFolder('root', 'Balyasny (BAM)')
    const projFolder = await drive.findChildFolder(clientFolder!, 'Q2 Consumer Tracker_PR00112_2026.06.10')
    const child = await drive.findChild(projFolder!, '2026.06.10 — Client Folder')
    expect(child).toBeTruthy()
    expect(child!.mimeType).toBe('application/vnd.google-apps.shortcut')
    expect(child!.id).toBe(rec.drive_file_id)
  })

  it('falls back to a bookmark for a Google-native url with no extractable id', async () => {
    const drive = new FakeDrive('root')
    // drive.google.com is Google-native but this path has neither /d/ nor /folders/
    const input: FileInput = {
      kind: 'link', confident: true, hasProject: true,
      source_url: 'https://drive.google.com/open',
      dateISO: '2026-06-10', original_file_name: 'Mystery Link',
    }
    const rec = await fileDeliverable(drive, resolver(drive), input)
    expect(rec.status).toBe('filed')
    expect(rec.kind).toBe('link')
    const clientFolder = await drive.findChildFolder('root', 'Balyasny (BAM)')
    const projFolder = await drive.findChildFolder(clientFolder!, 'Q2 Consumer Tracker_PR00112_2026.06.10')
    const child = await drive.findChild(projFolder!, '2026.06.10 — Mystery Link')
    expect(child).toBeTruthy()
    expect(child!.mimeType).toBe('text/uri-list')
    expect(child!.id).toBe(rec.drive_file_id)
  })
})
