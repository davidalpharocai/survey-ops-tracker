// lib/drive/fake.ts
import type { DriveChild, DriveClient } from './types'

type Node = { id: string; name: string; mimeType: string; parentId: string }
const FOLDER = 'application/vnd.google-apps.folder'

export class FakeDrive implements DriveClient {
  private nodes = new Map<string, Node>()
  private seq = 0
  constructor(public rootId = 'root') {}

  private id(): string { return `id-${++this.seq}` }
  private childrenOf(parentId: string): Node[] { return [...this.nodes.values()].filter((n) => n.parentId === parentId) }

  async findChildFolder(parentId: string, name: string): Promise<string | null> {
    const hit = this.childrenOf(parentId).find((n) => n.mimeType === FOLDER && n.name === name)
    return hit?.id ?? null
  }
  async createFolder(parentId: string, name: string): Promise<string> {
    const id = this.id()
    this.nodes.set(id, { id, name, mimeType: FOLDER, parentId })
    return id
  }
  async findChild(parentId: string, name: string): Promise<DriveChild | null> {
    const hit = this.childrenOf(parentId).find((n) => n.name === name)
    return hit ? { id: hit.id, name: hit.name, mimeType: hit.mimeType } : null
  }
  async uploadFile(parentId: string, name: string, mimeType: string, _bytes: Buffer): Promise<string> {
    const id = this.id()
    this.nodes.set(id, { id, name, mimeType, parentId })
    return id
  }
  async createShortcut(parentId: string, name: string, _targetFileId: string): Promise<string> {
    const id = this.id()
    this.nodes.set(id, { id, name, mimeType: 'application/vnd.google-apps.shortcut', parentId })
    return id
  }
  async createBookmark(parentId: string, name: string, _url: string): Promise<string> {
    const id = this.id()
    this.nodes.set(id, { id, name, mimeType: 'text/uri-list', parentId })
    return id
  }
  async moveFile(fileId: string, newParentId: string): Promise<void> {
    const n = this.nodes.get(fileId)
    if (n) n.parentId = newParentId
  }

  // convenience for tests
  async createFolderIfMissing(parentId: string, name: string): Promise<string> {
    return (await this.findChildFolder(parentId, name)) ?? (await this.createFolder(parentId, name))
  }
}
