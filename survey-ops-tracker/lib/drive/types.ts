// lib/drive/types.ts
export type DriveChild = { id: string; name: string; mimeType: string }

export interface DriveClient {
  /** Find a direct child folder by exact name; null if absent. */
  findChildFolder(parentId: string, name: string): Promise<string | null>
  createFolder(parentId: string, name: string): Promise<string>
  /** Find a direct child of any type by exact name. */
  findChild(parentId: string, name: string): Promise<DriveChild | null>
  uploadFile(parentId: string, name: string, mimeType: string, bytes: Buffer): Promise<string>
  createShortcut(parentId: string, name: string, targetFileId: string): Promise<string>
  /** A small bookmark file for an external URL. */
  createBookmark(parentId: string, name: string, url: string): Promise<string>
  moveFile(fileId: string, newParentId: string): Promise<void>
}
