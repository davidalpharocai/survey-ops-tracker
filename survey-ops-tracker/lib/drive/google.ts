// lib/drive/google.ts
import 'server-only'
import { google } from 'googleapis'
import { Readable } from 'stream'
import type { DriveChild, DriveClient } from './types'

const FOLDER = 'application/vnd.google-apps.folder'

function driveClient() {
  // Two supported auth modes (pick whichever env vars are present):
  // (A) No-admin: OAuth as a user who is a Shared Drive member (GOOGLE_OAUTH_*).
  // (B) Service account, optionally impersonating via domain-wide delegation.
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  if (refreshToken) {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
    if (!clientId || !clientSecret) throw new Error('Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET')
    const oauth = new google.auth.OAuth2(clientId, clientSecret)
    oauth.setCredentials({ refresh_token: refreshToken })
    return google.drive({ version: 'v3', auth: oauth })
  }
  const email = process.env.GOOGLE_CLIENT_EMAIL
  const key = process.env.GOOGLE_PRIVATE_KEY
  if (!email || !key) throw new Error('Missing GOOGLE_OAUTH_REFRESH_TOKEN or GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY')
  const auth = new google.auth.JWT({
    email,
    key: key.replace(/\\n/g, '\n'), // tolerate \n stored literally in env vars
    scopes: ['https://www.googleapis.com/auth/drive'],
    subject: process.env.GOOGLE_IMPERSONATE_SUBJECT || undefined, // domain-wide delegation: act as an internal Drive member
  })
  return google.drive({ version: 'v3', auth })
}

const COMMON = { supportsAllDrives: true, includeItemsFromAllDrives: true } as const

// Lazy singleton — deferred to first method call so the module can be imported
// at build time without the GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY present.
let _drive: ReturnType<typeof driveClient> | undefined

function getDrive() {
  if (!_drive) _drive = driveClient()
  return _drive
}

export class GoogleDrive implements DriveClient {
  private get drive() { return getDrive() }

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
