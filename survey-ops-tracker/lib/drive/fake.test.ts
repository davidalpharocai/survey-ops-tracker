import { describe, it, expect } from 'vitest'
import { FakeDrive } from './fake'

describe('FakeDrive', () => {
  it('creates and finds folders idempotently by name', async () => {
    const d = new FakeDrive('root')
    const a = await d.createFolder('root', 'Balyasny (BAM)')
    expect(await d.findChildFolder('root', 'Balyasny (BAM)')).toBe(a)
    expect(await d.findChildFolder('root', 'Nope')).toBeNull()
  })

  it('uploads, finds, and moves files', async () => {
    const d = new FakeDrive('root')
    const f1 = await d.createFolder('root', 'F1')
    const f2 = await d.createFolder('root', 'F2')
    const file = await d.uploadFile(f1, 'a.pdf', 'application/pdf', Buffer.from('x'))
    expect((await d.findChild(f1, 'a.pdf'))?.id).toBe(file)
    await d.moveFile(file, f2)
    expect(await d.findChild(f1, 'a.pdf')).toBeNull()
    expect((await d.findChild(f2, 'a.pdf'))?.id).toBe(file)
  })

  it('creates shortcuts and bookmarks', async () => {
    const d = new FakeDrive('root')
    const sc = await d.createShortcut('root', 'sheet', 'target-123')
    const bm = await d.createBookmark('root', 'study.url', 'https://occam/x')
    expect((await d.findChild('root', 'sheet'))?.id).toBe(sc)
    expect((await d.findChild('root', 'study.url'))?.id).toBe(bm)
  })
})
