// lib/drive/google.ts
import 'server-only'
import { google } from 'googleapis'
import { Readable } from 'stream'
import type { DriveChild, DriveClient } from './types'

const FOLDER = 'application/vnd.google-apps.folder'

function driveClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!raw) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_KEY')
  const creds = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
  return google.drive({ version: 'v3', auth })
}

const COMMON = { supportsAllDrives: true, includeItemsFromAllDrives: true } as const

const _drive = driveClient()   // module-level singleton, created once

export class GoogleDrive implements DriveClient {
  private drive = _drive

  async findChildFolder(parentId: string, name: string): Promise<string | null> {
    const child = await this.findChild(parentId, name)
    return child && child.mimeType === FOLDER ? child.id : null
  }

  async createFolder(parentId: string, name: string): Promise<string> {
    const res = await this.drive.files.create({
      requestBody: { name, mimeType: FOLDER, parents: [parentId] },
      fields: 'id',
      supportsAllDrives: true,
    })
    return res.data.id!
  }

  async findChild(parentId: string, name: string): Promise<DriveChild | null> {
    const q = `'${parentId}' in parents and name = '${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and trashed = false`
    const res = await this.drive.files.list({ q, fields: 'files(id,name,mimeType)', pageSize: 1, ...COMMON })
    const f = res.data.files?.[0]
    return f ? { id: f.id!, name: f.name!, mimeType: f.mimeType! } : null
  }

  async uploadFile(parentId: string, name: string, mimeType: string, bytes: Buffer): Promise<string> {
    const res = await this.drive.files.create({
      requestBody: { name, parents: [parentId] },
      media: { mimeType, body: Readable.from(bytes) },
      fields: 'id',
      supportsAllDrives: true,
    })
    return res.data.id!
  }

  async createShortcut(parentId: string, name: string, targetFileId: string): Promise<string> {
    const res = await this.drive.files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.shortcut', parents: [parentId], shortcutDetails: { targetId: targetFileId } },
      fields: 'id',
      supportsAllDrives: true,
    })
    return res.data.id!
  }

  async createBookmark(parentId: string, name: string, url: string): Promise<string> {
    // A .url internet-shortcut file pointing at the external link.
    const body = `[InternetShortcut]\r\nURL=${url}\r\n`
    return this.uploadFile(parentId, name.endsWith('.url') ? name : `${name}.url`, 'text/plain', Buffer.from(body, 'utf8'))
  }

  async moveFile(fileId: string, newParentId: string): Promise<void> {
    const cur = await this.drive.files.get({ fileId, fields: 'parents', supportsAllDrives: true })
    const prev = (cur.data.parents ?? []).join(',')
    await this.drive.files.update({ fileId, addParents: newParentId, removeParents: prev, fields: 'id', supportsAllDrives: true })
  }
}
