// lib/deliverables/dedup.ts
import { createHash } from 'crypto'

export function sha256(bytes: Buffer | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
