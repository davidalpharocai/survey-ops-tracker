# Deliverables Depository — Phase 2: Email Capture + Review Queue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an analyst bcc/cc/forward an outbound client email to `deliverables@alpharoc.ai` and have its attachments/links auto-filed into the right `Client / {Project}_{PR#####}_{date}` Shared Drive folder — or staged in an in-app Review queue when the client/project can't be inferred — with a "Filed ✓" reply.

**Architecture:** A free Google Apps Script on a backing inbox POSTs each new message to a new `POST /api/deliverables/ingest` route (authed by `WEBHOOK_SECRET`). The route is a **thin adapter**: it wires real Supabase/Drive/Resend implementations into a **testable orchestration function** `ingestEmail(payload, deps)` in `lib/deliverables/email-ingest.ts`. The orchestration reuses every Phase-1 building block already shipped and tested — `matchDeliverable`, `fileDeliverable`, `findDuplicate`, `loadMatchData`, `extractDeliverableLinks`, the naming helpers, and the `GoogleDrive` client. The Review queue is a new client page (`/deliverables`) backed by `POST /api/deliverables/[id]/resolve`, which delegates to a testable `resolveDeliverable(deps, input)`. No new DB migration — the `deliverables` table already has every column we need.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase (Postgres + RLS), `googleapis` (Drive), Resend (`sendAndLog`), TanStack Query, Vitest + Testing Library, Google Apps Script (transport, runs in Google — not part of the Next build).

---

## Conventions for every task

- **Working directory:** the worktree `C:\Users\david\Claude Code Projects\.claude\worktrees\deliverables`. The Next app lives in the `survey-ops-tracker/` subfolder. Run all `npm` commands from `survey-ops-tracker/`.
- **Run a single test file:** `npm test -- <path>` (e.g. `npm test -- lib/deliverables/email.test.ts`). `npm test` runs `vitest run` (all tests).
- **Full gate before any commit that touches built code:** `npm test` → `npm run build` → `npm run lint`, all clean. ESLint runs as errors in `next build` — no `any`, no unused vars.
- **Commits:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Branch:** `feat/deliverables-email` (already checked out in this worktree).

## File Structure

**New — testable pure/orchestration libs (`survey-ops-tracker/lib/deliverables/`):**
- `email.ts` — parse the ingest payload: internal-sender gate, address-list parsing, external-recipient + forwarded-original-recipient extraction, the client-signal email, message-date → ISO, and attachment itemization (base64 → Buffer + hash, skipping trivial inline images). Pure.
- `confidence.ts` — `AUTO_FILE_THRESHOLD`, `confidenceBand`, `routeMatch` (the confident-vs-queue decision), and `describeCandidates` (turn matcher candidates into human labels for the queue). Pure.
- `folders.ts` — `ensureChildFolder`, `ensureClientFolder`, `ensureProjectFolder`, extracted from the Phase-1 upload route so the upload route, ingest, and resolve all share one copy.
- `reply.ts` — `replySubject` + `renderReplyHtml` for the "Filed ✓ / Needs review" receipt. Pure.
- `email-ingest.ts` — `ingestEmail(payload, deps)`: the full per-message orchestration (idempotency, gate, itemize, match, route, dedup, file, persist, reply). Dependencies injected so it's tested with `FakeDrive` + simple stubs.
- `resolve.ts` — `resolveDeliverable(deps, input)` + `dismissDeliverable(deps, input)`: move a queued file into the chosen project folder and flip status, or soft-delete. Dependencies injected.

**New — thin route adapters:**
- `survey-ops-tracker/app/api/deliverables/ingest/route.ts`
- `survey-ops-tracker/app/api/deliverables/[id]/resolve/route.ts`

**New — Review queue UI:**
- `survey-ops-tracker/lib/hooks/useReviewQueue.ts`
- `survey-ops-tracker/components/deliverables/ReviewQueue.tsx`
- (replace placeholder) `survey-ops-tracker/app/(app)/deliverables/page.tsx`

**New — transport (documented, runs in Google Apps Script, NOT built/tested by Next):**
- `survey-ops-tracker/scripts/apps-script/deliverables-forwarder.gs`
- `survey-ops-tracker/scripts/apps-script/README.md`

**Modified:**
- `survey-ops-tracker/app/api/deliverables/upload/route.ts` — import the extracted folder helpers (remove its local copies).
- `survey-ops-tracker/lib/deliverables/links.ts` — add `linkDisplayName`.
- `survey-ops-tracker/USER_GUIDE.md` — document emailing deliverables + the queue.

**No migration.** `deliverables` already has `kind, drive_file_id, drive_folder_id, file_name, original_file_name, file_hash, source_url, mime_type, size_bytes, source, status, match_confidence, match_method, match_candidates, duplicate_of, gmail_message_id, email_subject, email_from, email_date, forwarded_by, filed_by, filed_at, deleted_at`. Enums: `deliverable_source = 'email' | 'upload'`, `deliverable_kind = 'file' | 'link'`, `deliverable_status = 'filed' | 'review' | 'duplicate' | 'unsorted'`.

---

### Task 1: Extract shared folder helpers into `lib/deliverables/folders.ts`

The Phase-1 upload route defines `ensureClientFolder` / `ensureProjectFolder` privately. Ingest and resolve need the same logic, plus a small `ensureChildFolder`. Extract to a shared, testable module (widened to the `DriveClient` interface so it works with `FakeDrive`), then point the upload route at it.

**Files:**
- Create: `survey-ops-tracker/lib/deliverables/folders.ts`
- Test: `survey-ops-tracker/lib/deliverables/folders.test.ts`
- Modify: `survey-ops-tracker/app/api/deliverables/upload/route.ts`

- [ ] **Step 1: Write the failing test**

Create `survey-ops-tracker/lib/deliverables/folders.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import type { createAdminClient } from '@/lib/supabase/admin'
import { FakeDrive } from '@/lib/drive/fake'
import { ensureChildFolder, ensureClientFolder, ensureProjectFolder } from './folders'
import type { FolderResolver } from './ingest'

function resolver(drive: FakeDrive): FolderResolver {
  return {
    sharedDriveId: 'root',
    clientFolderId: async () => drive.createFolderIfMissing('root', 'Coatue'),
    projectFolderName: () => 'B2B Tracker_PR00003_2026.06.10',
    needsReviewFolderName: '00_Needs Review',
    unsortedFolderName: '_Unsorted',
  }
}

/** Minimal admin stub for ensureClientFolder: select(...).eq(...).single() + update(...).eq(...). */
function fakeAdmin(client: { drive_folder_id: string | null; name: string; code: string | null } | null, onUpdate?: (patch: Record<string, unknown>) => void) {
  const selectChain = { eq: () => selectChain, single: async () => ({ data: client, error: null }) }
  return {
    from: vi.fn(() => ({
      select: () => selectChain,
      update: (patch: Record<string, unknown>) => { onUpdate?.(patch); return { eq: async () => ({ error: null }) } },
    })),
  } as unknown as ReturnType<typeof createAdminClient>
}

describe('ensureChildFolder', () => {
  it('creates a child folder once, then finds the existing one', async () => {
    const drive = new FakeDrive('root')
    const a = await ensureChildFolder(drive, 'root', '00_Needs Review')
    const b = await ensureChildFolder(drive, 'root', '00_Needs Review')
    expect(a).toBe(b)
  })
})

describe('ensureProjectFolder', () => {
  it('creates Client/Project and is idempotent', async () => {
    const drive = new FakeDrive('root')
    const first = await ensureProjectFolder(drive, resolver(drive))
    const second = await ensureProjectFolder(drive, resolver(drive))
    expect(first).toBe(second)
    const clientFolder = await drive.findChildFolder('root', 'Coatue')
    expect(await drive.findChildFolder(clientFolder!, 'B2B Tracker_PR00003_2026.06.10')).toBe(first)
  })
})

describe('ensureClientFolder', () => {
  it('returns the stored drive_folder_id without touching Drive', async () => {
    const drive = new FakeDrive('root')
    const spy = vi.spyOn(drive, 'createFolder')
    const id = await ensureClientFolder(fakeAdmin({ drive_folder_id: 'existing-folder', name: 'Coatue', code: 'CL001' }), drive, 'root', 'c1')
    expect(id).toBe('existing-folder')
    expect(spy).not.toHaveBeenCalled()
  })

  it('creates "Name (CODE)" under the shared drive and writes it back when unmapped', async () => {
    const drive = new FakeDrive('root')
    let written: Record<string, unknown> | undefined
    const id = await ensureClientFolder(fakeAdmin({ drive_folder_id: null, name: 'Coatue', code: 'CL001' }, (p) => { written = p }), drive, 'root', 'c1')
    expect(await drive.findChildFolder('root', 'Coatue (CL001)')).toBe(id)
    expect(written).toEqual({ drive_folder_id: id })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/deliverables/folders.test.ts`
Expected: FAIL — `Failed to resolve import "./folders"`.

- [ ] **Step 3: Write minimal implementation**

Create `survey-ops-tracker/lib/deliverables/folders.ts` (logic copied verbatim from the upload route, widened to `DriveClient`):

```typescript
// lib/deliverables/folders.ts
import type { createAdminClient } from '@/lib/supabase/admin'
import type { DriveClient } from '@/lib/drive/types'
import type { FolderResolver } from './ingest'

export async function ensureChildFolder(drive: DriveClient, parentId: string, name: string): Promise<string> {
  return (await drive.findChildFolder(parentId, name)) ?? (await drive.createFolder(parentId, name))
}

export async function ensureClientFolder(
  admin: ReturnType<typeof createAdminClient>,
  drive: DriveClient,
  sharedDriveId: string,
  clientId: string,
): Promise<string> {
  const { data: client } = await admin.from('clients').select('drive_folder_id, name, code').eq('id', clientId).single()
  if (client?.drive_folder_id) return client.drive_folder_id
  const name = client?.code ? `${client.name} (${client.code})` : (client?.name ?? clientId)
  const created = await ensureChildFolder(drive, sharedDriveId, name)
  await admin.from('clients').update({ drive_folder_id: created }).eq('id', clientId)
  return created
}

export async function ensureProjectFolder(drive: DriveClient, r: FolderResolver): Promise<string> {
  const clientFolder = await r.clientFolderId()
  return ensureChildFolder(drive, clientFolder, r.projectFolderName())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/deliverables/folders.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Point the upload route at the shared helpers**

In `survey-ops-tracker/app/api/deliverables/upload/route.ts`: add to the imports
```typescript
import { ensureClientFolder, ensureProjectFolder } from '@/lib/deliverables/folders'
```
then **delete** the two local helper functions at the bottom of the file (the `async function ensureClientFolder(...)` and `async function ensureProjectFolder(...)` definitions). The call sites (`ensureClientFolder(admin, drive, sharedDriveId, project.client_id!)` and `ensureProjectFolder(drive, resolver)`) are unchanged — `GoogleDrive` implements `DriveClient`, so the widened parameter type is compatible.

- [ ] **Step 6: Verify the upload route still type-checks and builds**

Run: `npm run build`
Expected: build succeeds (no unused-var or type errors from the upload route).

- [ ] **Step 7: Commit**

```bash
git add survey-ops-tracker/lib/deliverables/folders.ts survey-ops-tracker/lib/deliverables/folders.test.ts survey-ops-tracker/app/api/deliverables/upload/route.ts
git commit -m "refactor(deliverables): extract shared Drive folder helpers into lib/deliverables/folders.ts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Email-payload parsing (`lib/deliverables/email.ts`)

Pure functions that turn the raw ingest JSON into the signals the matcher and filer need. This is the heart of the bcc/cc/forward handling.

**Files:**
- Create: `survey-ops-tracker/lib/deliverables/email.ts`
- Test: `survey-ops-tracker/lib/deliverables/email.test.ts`

- [ ] **Step 1: Write the failing test**

Create `survey-ops-tracker/lib/deliverables/email.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  emailDomain, isInternalSender, parseAddressList, externalRecipient,
  forwardedOriginalRecipient, clientSignalEmail, emailDateISO, itemizeAttachments,
} from './email'

describe('emailDomain / isInternalSender', () => {
  it('lowercases the domain and detects alpharoc senders', () => {
    expect(emailDomain('"Jane Doe" <Jane@Coatue.com>')).toBe('coatue.com')
    expect(isInternalSender('analyst@alpharoc.ai')).toBe(true)
    expect(isInternalSender('Person <person@coatue.com>')).toBe(false)
    expect(isInternalSender('')).toBe(false)
  })
})

describe('parseAddressList', () => {
  it('extracts every address regardless of display-name commas', () => {
    expect(parseAddressList('"Doe, Jane" <jane@coatue.com>, ops@alpharoc.ai')).toEqual(['jane@coatue.com', 'ops@alpharoc.ai'])
  })
  it('accepts an array and de-dupes case-insensitively', () => {
    expect(parseAddressList(['A@Coatue.com', 'a@coatue.com'])).toEqual(['a@coatue.com'])
  })
  it('returns [] for undefined', () => {
    expect(parseAddressList(undefined)).toEqual([])
  })
})

describe('externalRecipient', () => {
  it('returns the first non-alpharoc address across To then Cc', () => {
    expect(externalRecipient('analyst@alpharoc.ai, pm@coatue.com', 'ops@alpharoc.ai')).toBe('pm@coatue.com')
  })
  it('falls back to Cc when To is all-internal', () => {
    expect(externalRecipient('analyst@alpharoc.ai', 'client@bam.com')).toBe('client@bam.com')
  })
  it('returns null when everyone is internal', () => {
    expect(externalRecipient('a@alpharoc.ai', 'b@alpharoc.ai')).toBeNull()
  })
})

describe('forwardedOriginalRecipient', () => {
  it('parses the To: line inside a Gmail forwarded-message block', () => {
    const body = [
      'FYI — sent this to the client.',
      '---------- Forwarded message ---------',
      'From: Jane <jane@alpharoc.ai>',
      'Date: Mon, Jun 15, 2026 at 9:02 AM',
      'Subject: Final topline',
      'To: Client Person <person@coatue.com>',
    ].join('\n')
    expect(forwardedOriginalRecipient(body)).toBe('person@coatue.com')
  })
  it('returns null when there is no forwarded block', () => {
    expect(forwardedOriginalRecipient('just a plain body')).toBeNull()
  })
})

describe('clientSignalEmail', () => {
  it('prefers the external To/Cc recipient (bcc/cc case)', () => {
    expect(clientSignalEmail({ to: 'pm@coatue.com', cc: '', body: '' })).toBe('pm@coatue.com')
  })
  it('falls back to the forwarded original recipient (forward case)', () => {
    const body = '---------- Forwarded message ---------\nTo: person@bam.com'
    expect(clientSignalEmail({ to: 'analyst@alpharoc.ai', cc: '', body })).toBe('person@bam.com')
  })
  it('returns null when nothing external is found', () => {
    expect(clientSignalEmail({ to: 'a@alpharoc.ai', cc: '', body: 'no headers' })).toBeNull()
  })
})

describe('emailDateISO', () => {
  it('parses an RFC-2822 Date header to ISO', () => {
    expect(emailDateISO('Mon, 15 Jun 2026 09:02:00 -0400', new Date('2000-01-01T00:00:00Z'))).toBe('2026-06-15T13:02:00.000Z')
  })
  it('uses the fallback when the header is missing or unparseable', () => {
    const fb = new Date('2026-06-24T00:00:00Z')
    expect(emailDateISO(undefined, fb)).toBe(fb.toISOString())
    expect(emailDateISO('not a date', fb)).toBe(fb.toISOString())
  })
})

describe('itemizeAttachments', () => {
  it('decodes base64, hashes, and keeps real files', () => {
    const items = itemizeAttachments([{ filename: 'Topline.pdf', mimeType: 'application/pdf', base64: Buffer.from('pdf-bytes').toString('base64') }])
    expect(items).toHaveLength(1)
    expect(items[0].filename).toBe('Topline.pdf')
    expect(items[0].bytes.toString()).toBe('pdf-bytes')
    expect(items[0].hash).toMatch(/^[0-9a-f]{64}$/)
  })
  it('skips zero-byte attachments and tiny inline images (signatures/logos)', () => {
    const items = itemizeAttachments([
      { filename: 'empty.bin', mimeType: 'application/octet-stream', base64: '' },
      { filename: 'logo.png', mimeType: 'image/png', base64: Buffer.from('x'.repeat(500)).toString('base64') },
      { filename: 'big-chart.png', mimeType: 'image/png', base64: Buffer.from('y'.repeat(20_000)).toString('base64') },
    ])
    expect(items.map((i) => i.filename)).toEqual(['big-chart.png'])
  })
  it('returns [] for undefined', () => {
    expect(itemizeAttachments(undefined)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/deliverables/email.test.ts`
Expected: FAIL — `Failed to resolve import "./email"`.

- [ ] **Step 3: Write minimal implementation**

Create `survey-ops-tracker/lib/deliverables/email.ts`:

```typescript
// lib/deliverables/email.ts
import { sha256 } from './dedup'

export const ALPHAROC_DOMAIN = 'alpharoc.ai'
/** Inline images below this size are treated as signatures/logos, not deliverables. */
export const SKIP_IMAGE_MAX_BYTES = 10_000

export type AttachmentInput = { filename?: string; mimeType?: string; base64: string }
export type IngestPayload = {
  from: string
  to?: string | string[]
  cc?: string | string[]
  subject?: string
  date?: string
  messageId: string
  body?: string
  attachments?: AttachmentInput[]
}
export type FileItem = { filename: string; mimeType: string; bytes: Buffer; hash: string }

const EMAIL_RE = /[^\s<>,;"]+@[^\s<>,;"]+/g

/** Lowercased domain after the @, or '' if there is no address. */
export function emailDomain(addr: string): string {
  const m = addr.match(EMAIL_RE)
  const email = m?.[0]?.toLowerCase() ?? ''
  return email.split('@')[1] ?? ''
}

export function isInternalSender(from: string): boolean {
  return emailDomain(from) === ALPHAROC_DOMAIN
}

/** Extract every address from a header value (string or array), lowercased + de-duped, robust to display-name commas. */
export function parseAddressList(v: string | string[] | undefined): string[] {
  if (!v) return []
  const text = Array.isArray(v) ? v.join(',') : v
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(EMAIL_RE)) {
    const a = m[0].toLowerCase()
    if (!seen.has(a)) { seen.add(a); out.push(a) }
  }
  return out
}

/** First non-alpharoc address across To then Cc — i.e. the client you sent to. */
export function externalRecipient(to: string | string[] | undefined, cc: string | string[] | undefined): string | null {
  for (const a of [...parseAddressList(to), ...parseAddressList(cc)]) {
    if (!a.endsWith(`@${ALPHAROC_DOMAIN}`)) return a
  }
  return null
}

/** For a forward, the original recipient parsed from the forwarded-message header block. */
export function forwardedOriginalRecipient(body: string): string | null {
  const m = body.match(/Forwarded message[\s\S]{0,600}?\n\s*To:\s*(.+)/i)
  if (!m) return null
  for (const a of parseAddressList(m[1])) {
    if (!a.endsWith(`@${ALPHAROC_DOMAIN}`)) return a
  }
  return null
}

/** The email the matcher should resolve the client from. */
export function clientSignalEmail(input: { to?: string | string[]; cc?: string | string[]; body?: string }): string | null {
  return externalRecipient(input.to, input.cc) ?? forwardedOriginalRecipient(input.body ?? '')
}

export function emailDateISO(date: string | undefined, fallback: Date): string {
  if (date) {
    const d = new Date(date)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return fallback.toISOString()
}

export function itemizeAttachments(attachments: AttachmentInput[] | undefined): FileItem[] {
  const out: FileItem[] = []
  for (const a of attachments ?? []) {
    const bytes = Buffer.from(a.base64 ?? '', 'base64')
    if (bytes.length === 0) continue
    const mimeType = a.mimeType ?? 'application/octet-stream'
    if (mimeType.startsWith('image/') && bytes.length < SKIP_IMAGE_MAX_BYTES) continue
    out.push({ filename: a.filename || 'attachment', mimeType, bytes, hash: sha256(bytes) })
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/deliverables/email.test.ts`
Expected: PASS (all describe blocks green). If the RFC-2822 ISO assertion is off, it's a timezone-conversion expectation — keep the implementation (`new Date(...).toISOString()`) and trust the test value `2026-06-15T13:02:00.000Z` (09:02 −0400 = 13:02 UTC).

- [ ] **Step 5: Commit**

```bash
git add survey-ops-tracker/lib/deliverables/email.ts survey-ops-tracker/lib/deliverables/email.test.ts
git commit -m "feat(deliverables): email-payload parsing (sender gate, recipient + date extraction, attachment itemization)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Confidence band, routing decision, candidate labels (`lib/deliverables/confidence.ts`)

Pure helpers shared by the ingest orchestration (routing + candidate labels to persist) and the queue UI (High/Med/Low).

**Files:**
- Create: `survey-ops-tracker/lib/deliverables/confidence.ts`
- Test: `survey-ops-tracker/lib/deliverables/confidence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `survey-ops-tracker/lib/deliverables/confidence.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { confidenceBand, routeMatch, describeCandidates, AUTO_FILE_THRESHOLD } from './confidence'
import type { MatchResult } from './types'

const matchData = {
  clients: [{ id: 'c1', name: 'Coatue', code: 'CL001' }],
  projects: [{ id: 'p1', client_id: 'c1', project_code: 'PR00003', project_name: 'B2B Tracker' }],
}

describe('confidenceBand', () => {
  it('maps scores to High/Med/Low', () => {
    expect(confidenceBand(0.9)).toBe('High')
    expect(confidenceBand(AUTO_FILE_THRESHOLD)).toBe('High')
    expect(confidenceBand(0.7)).toBe('Med')
    expect(confidenceBand(0.2)).toBe('Low')
  })
})

describe('routeMatch', () => {
  const base: MatchResult = { clientId: null, projectId: null, confidence: 0, method: 'none', candidates: [] }
  it('files when confident with a project', () => {
    expect(routeMatch({ ...base, clientId: 'c1', projectId: 'p1', confidence: 0.9 })).toEqual({ confident: true, hasProject: true, status: 'filed' })
  })
  it('unsorted when confident client but no project', () => {
    expect(routeMatch({ ...base, clientId: 'c1', confidence: 0.9 })).toEqual({ confident: true, hasProject: false, status: 'unsorted' })
  })
  it('review when below threshold', () => {
    expect(routeMatch({ ...base, clientId: 'c1', projectId: 'p1', confidence: 0.6 })).toEqual({ confident: false, hasProject: true, status: 'review' })
  })
  it('review when no client even if score is high', () => {
    expect(routeMatch({ ...base, confidence: 0.9 })).toEqual({ confident: false, hasProject: false, status: 'review' })
  })
})

describe('describeCandidates', () => {
  it('labels project candidates as "Client → Project (CODE)" with a band', () => {
    const labeled = describeCandidates(
      [{ clientId: 'c1', projectId: 'p1', confidence: 0.9, reason: 'contact', method: 'contact_email' }],
      matchData,
    )
    expect(labeled).toEqual([{ clientId: 'c1', projectId: 'p1', confidence: 0.9, band: 'High', label: 'Coatue → B2B Tracker (PR00003)' }])
  })
  it('labels client-only candidates with just the client name', () => {
    const labeled = describeCandidates([{ clientId: 'c1', projectId: null, confidence: 0.6, reason: 'cname', method: 'name' }], matchData)
    expect(labeled[0].label).toBe('Coatue')
    expect(labeled[0].band).toBe('Med')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/deliverables/confidence.test.ts`
Expected: FAIL — `Failed to resolve import "./confidence"`.

- [ ] **Step 3: Write minimal implementation**

Create `survey-ops-tracker/lib/deliverables/confidence.ts`:

```typescript
// lib/deliverables/confidence.ts
import type { Candidate, MatchResult } from './types'

export const AUTO_FILE_THRESHOLD = 0.85

export type ConfidenceBand = 'High' | 'Med' | 'Low'

export function confidenceBand(score: number): ConfidenceBand {
  if (score >= AUTO_FILE_THRESHOLD) return 'High'
  if (score >= 0.6) return 'Med'
  return 'Low'
}

export type Routing = { confident: boolean; hasProject: boolean; status: 'filed' | 'unsorted' | 'review' }

/** Mirrors fileDeliverable's internal routing so the persisted folder/status and the dedup target agree. */
export function routeMatch(match: MatchResult): Routing {
  const confident = match.confidence >= AUTO_FILE_THRESHOLD && match.clientId != null
  const hasProject = match.projectId != null
  const status: Routing['status'] = !confident ? 'review' : hasProject ? 'filed' : 'unsorted'
  return { confident, hasProject, status }
}

export type LabeledCandidate = { clientId: string | null; projectId: string | null; confidence: number; band: ConfidenceBand; label: string }

type NameData = {
  clients: { id: string; name: string; code: string | null }[]
  projects: { id: string; client_id: string | null; project_code: string; project_name: string }[]
}

/** Turn matcher candidates into self-describing rows for the review queue (stored in match_candidates). */
export function describeCandidates(candidates: Candidate[], data: NameData): LabeledCandidate[] {
  return candidates.map((c) => {
    const client = c.clientId ? data.clients.find((x) => x.id === c.clientId) : undefined
    const project = c.projectId ? data.projects.find((x) => x.id === c.projectId) : undefined
    const label = project
      ? `${client?.name ?? 'Unknown client'} → ${project.project_name} (${project.project_code})`
      : (client?.name ?? 'Unknown')
    return { clientId: c.clientId, projectId: c.projectId, confidence: c.confidence, band: confidenceBand(c.confidence), label }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/deliverables/confidence.test.ts`
Expected: PASS (all green).

- [ ] **Step 5: Commit**

```bash
git add survey-ops-tracker/lib/deliverables/confidence.ts survey-ops-tracker/lib/deliverables/confidence.test.ts
git commit -m "feat(deliverables): confidence band, confident-vs-queue routing, candidate labels

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `linkDisplayName` for emailed links (`lib/deliverables/links.ts`)

Emailed links need a readable name for their Drive shortcut/bookmark. Add one pure helper to the existing links module.

**Files:**
- Modify: `survey-ops-tracker/lib/deliverables/links.ts`
- Modify: `survey-ops-tracker/lib/deliverables/links.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `survey-ops-tracker/lib/deliverables/links.test.ts` (and add `linkDisplayName` to the existing import from `./links`):

```typescript
describe('linkDisplayName', () => {
  it('uses host + last meaningful path segment', () => {
    expect(linkDisplayName('https://app.occamdata.com/study/42?x=1')).toBe('app.occamdata.com — 42')
    expect(linkDisplayName('https://docs.google.com/spreadsheets/d/abc/edit')).toBe('docs.google.com — edit')
  })
  it('falls back to the host alone when there is no path', () => {
    expect(linkDisplayName('https://example.com')).toBe('example.com')
  })
  it('falls back to the raw string for an unparseable url', () => {
    expect(linkDisplayName('not a url')).toBe('not a url')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/deliverables/links.test.ts`
Expected: FAIL — `linkDisplayName is not exported` / not defined.

- [ ] **Step 3: Add the implementation**

Append to `survey-ops-tracker/lib/deliverables/links.ts`:

```typescript
/** A readable name for a link's Drive shortcut/bookmark: "host — last-path-segment". */
export function linkDisplayName(url: string): string {
  try {
    const u = new URL(url.trim())
    const segs = u.pathname.split('/').filter(Boolean)
    const last = segs.length ? segs.slice(-1).join(' ').replace(/[-_]+/g, ' ').trim() : ''
    return last ? `${u.hostname} — ${last}` : u.hostname
  } catch {
    return url.trim()
  }
}
```

> `linkDisplayName` uses only the final path segment (dashes/underscores → spaces), so the test expectations above are `'app.occamdata.com — 42'` and `'docs.google.com — edit'`, with `'example.com'` and `'not a url'` for the path-less and unparseable cases.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/deliverables/links.test.ts`
Expected: PASS (existing link tests + the new `linkDisplayName` block).

- [ ] **Step 5: Commit**

```bash
git add survey-ops-tracker/lib/deliverables/links.ts survey-ops-tracker/lib/deliverables/links.test.ts
git commit -m "feat(deliverables): linkDisplayName for emailed-link shortcut names

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: "Filed ✓ / Needs review" reply (`lib/deliverables/reply.ts`)

Pure rendering of the receipt email. The route's `reply` closure calls these and hands the HTML to `sendAndLog`.

**Files:**
- Create: `survey-ops-tracker/lib/deliverables/reply.ts`
- Test: `survey-ops-tracker/lib/deliverables/reply.test.ts`

- [ ] **Step 1: Write the failing test**

Create `survey-ops-tracker/lib/deliverables/reply.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { replySubject, renderReplyHtml, type ReplySummary } from './reply'

const filedSummary: ReplySummary = {
  queueUrl: 'https://app.example.com/deliverables',
  items: [{ name: '2026.06.15 — Topline.pdf', status: 'filed', clientName: 'Coatue', projectLabel: 'B2B Tracker (PR00003)', driveUrl: 'https://drive.google.com/file/d/xyz/view' }],
}
const reviewSummary: ReplySummary = {
  queueUrl: 'https://app.example.com/deliverables',
  items: [{ name: 'mystery.pdf', status: 'review' }],
}

describe('replySubject', () => {
  it('says Filed when everything filed', () => {
    expect(replySubject('Final topline', filedSummary)).toBe('Filed ✓ — Final topline')
  })
  it('says Needs review when any item is queued', () => {
    expect(replySubject('Final topline', reviewSummary)).toBe('Needs a quick review — Final topline')
  })
  it('tolerates a missing original subject', () => {
    expect(replySubject(undefined, filedSummary)).toBe('Filed ✓')
  })
})

describe('renderReplyHtml', () => {
  it('shows the client, project, and a Drive link for filed items', () => {
    const html = renderReplyHtml(filedSummary)
    expect(html).toContain('Coatue')
    expect(html).toContain('B2B Tracker (PR00003)')
    expect(html).toContain('https://drive.google.com/file/d/xyz/view')
    expect(html).toContain('2026.06.15 — Topline.pdf')
  })
  it('links to the review queue for queued items', () => {
    const html = renderReplyHtml(reviewSummary)
    expect(html).toContain('https://app.example.com/deliverables')
    expect(html.toLowerCase()).toContain('review')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/deliverables/reply.test.ts`
Expected: FAIL — `Failed to resolve import "./reply"`.

- [ ] **Step 3: Write minimal implementation**

Create `survey-ops-tracker/lib/deliverables/reply.ts`:

```typescript
// lib/deliverables/reply.ts
export type ReplyStatus = 'filed' | 'unsorted' | 'review' | 'duplicate'
export type ReplyItem = {
  name: string
  status: ReplyStatus
  clientName?: string | null
  projectLabel?: string | null
  driveUrl?: string | null
}
export type ReplySummary = { items: ReplyItem[]; queueUrl: string }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function replySubject(originalSubject: string | undefined, summary: ReplySummary): string {
  const needsReview = summary.items.some((i) => i.status === 'review' || i.status === 'unsorted')
  const prefix = needsReview ? 'Needs a quick review' : 'Filed ✓'
  return originalSubject ? `${prefix} — ${originalSubject}` : prefix
}

function lineFor(item: ReplyItem, queueUrl: string): string {
  const icon = item.status === 'review' || item.status === 'unsorted' ? '🟡' : item.status === 'duplicate' ? '♻️' : '✅'
  const name = `<strong>${esc(item.name)}</strong>`
  if (item.status === 'filed') {
    const link = item.driveUrl ? ` — <a href="${esc(item.driveUrl)}">View in Drive</a>` : ''
    return `<li>${icon} ${name} → Filed to ${esc(item.clientName ?? '')} / ${esc(item.projectLabel ?? '')}${link}</li>`
  }
  if (item.status === 'unsorted') {
    return `<li>${icon} ${name} → Filed under ${esc(item.clientName ?? 'the client')} / _Unsorted — <a href="${esc(queueUrl)}">assign a project</a></li>`
  }
  if (item.status === 'duplicate') {
    return `<li>${icon} ${name} → Already filed — skipped</li>`
  }
  return `<li>${icon} ${name} → Needs a quick review — <a href="${esc(queueUrl)}">open the queue</a></li>`
}

export function renderReplyHtml(summary: ReplySummary): string {
  const items = summary.items.map((i) => lineFor(i, summary.queueUrl)).join('\n')
  return [
    '<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5">',
    '<p>Thanks — here is what landed in the deliverables depository:</p>',
    `<ul>${items}</ul>`,
    `<p style="color:#666;font-size:12px">Review queue: <a href="${esc(summary.queueUrl)}">${esc(summary.queueUrl)}</a></p>`,
    '</div>',
  ].join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/deliverables/reply.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add survey-ops-tracker/lib/deliverables/reply.ts survey-ops-tracker/lib/deliverables/reply.test.ts
git commit -m "feat(deliverables): Filed-check / Needs-review email receipt rendering

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Ingest orchestration (`lib/deliverables/email-ingest.ts`)

The per-message engine. Dependencies are injected so this is fully tested with `FakeDrive` + stubs — covering the spec's required unit/integration cases (confident bcc → filed, ambiguous → review, duplicate → skipped, link-only → shortcut, external-sender gate, idempotency).

**Files:**
- Create: `survey-ops-tracker/lib/deliverables/email-ingest.ts`
- Test: `survey-ops-tracker/lib/deliverables/email-ingest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `survey-ops-tracker/lib/deliverables/email-ingest.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { FakeDrive } from '@/lib/drive/fake'
import { ingestEmail, type IngestDeps, type EmailDeliverableRow, type MatchData } from './email-ingest'
import type { IngestPayload } from './email'

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
    // Lives in Coatue / B2B Tracker_PR00003_2026.06.15 (date from the Date header)
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

  it('files a Google-native link-only email as a shortcut', async () => {
    const drive = new FakeDrive('root')
    const { deps, rows } = makeDeps(drive)
    const out = await ingestEmail({
      ...pdfPayload, messageId: 'msg-4', attachments: [],
      body: 'Here is the dashboard: https://docs.google.com/spreadsheets/d/abc/edit',
    }, deps)
    expect(out.action).toBe('processed')
    expect(rows[0]).toMatchObject({ kind: 'link', status: 'filed', source_url: 'https://docs.google.com/spreadsheets/d/abc/edit' })
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/deliverables/email-ingest.test.ts`
Expected: FAIL — `Failed to resolve import "./email-ingest"`.

- [ ] **Step 3: Write minimal implementation**

Create `survey-ops-tracker/lib/deliverables/email-ingest.ts`:

```typescript
// lib/deliverables/email-ingest.ts
import type { DriveClient } from '@/lib/drive/types'
import type { ClientRec, ContactRec, ProjectRec } from './types'
import { matchDeliverable } from './matcher'
import { fileDeliverable, type FolderResolver } from './ingest'
import { ensureChildFolder } from './folders'
import { projectFolderName, originalSendDate } from './naming'
import { extractDeliverableLinks, normalizeUrl, linkDisplayName } from './links'
import { routeMatch, describeCandidates, type LabeledCandidate, type Routing } from './confidence'
import { clientSignalEmail, emailDateISO, itemizeAttachments, isInternalSender, type IngestPayload } from './email'
import { replySubject, renderReplyHtml, type ReplyItem } from './reply'

export type MatchData = { clients: ClientRec[]; projects: ProjectRec[]; contacts: ContactRec[]; domainMap: Record<string, string> }

/** Plain row the adapter persists (cast to the deliverables Insert type at the route boundary). */
export type EmailDeliverableRow = {
  client_id: string | null
  project_id: string | null
  kind: 'file' | 'link'
  drive_file_id: string
  drive_folder_id: string
  file_name: string
  original_file_name: string | null
  file_hash: string | null
  source_url: string | null
  mime_type: string | null
  size_bytes: number | null
  source: 'email'
  status: 'filed' | 'review' | 'unsorted'
  match_confidence: number
  match_method: string
  match_candidates: LabeledCandidate[]
  gmail_message_id: string
  email_subject: string | null
  email_from: string | null
  email_date: string | null
  forwarded_by: string | null
  filed_by: null
  filed_at: string
}

export type IngestDeps = {
  drive: DriveClient
  sharedDriveId: string
  matchData: MatchData
  appUrl: string
  now: Date
  isProcessed: (gmailMessageId: string) => Promise<boolean>
  clientFolderId: (clientId: string) => Promise<string>
  findDup: (folderId: string, opts: { fileHash?: string | null; sourceUrl?: string | null }) => Promise<string | null>
  persist: (row: EmailDeliverableRow) => Promise<void>
  reply: (to: string, subject: string, html: string) => Promise<void>
}

export type IngestOutcome =
  | { action: 'ignored'; reason: 'external_sender' | 'duplicate_message' | 'no_items' }
  | { action: 'processed'; filed: number; queued: number; duplicates: number }

async function targetFolder(deps: IngestDeps, r: FolderResolver, routing: Routing): Promise<string> {
  if (!routing.confident) return ensureChildFolder(deps.drive, deps.sharedDriveId, r.needsReviewFolderName)
  const clientFolder = await r.clientFolderId()
  return ensureChildFolder(deps.drive, clientFolder, routing.hasProject ? r.projectFolderName() : r.unsortedFolderName)
}

export async function ingestEmail(payload: IngestPayload, deps: IngestDeps): Promise<IngestOutcome> {
  if (!isInternalSender(payload.from)) return { action: 'ignored', reason: 'external_sender' }
  if (await deps.isProcessed(payload.messageId)) return { action: 'ignored', reason: 'duplicate_message' }

  const files = itemizeAttachments(payload.attachments)
  const links = extractDeliverableLinks(payload.body ?? '')
  if (files.length === 0 && links.length === 0) return { action: 'ignored', reason: 'no_items' }

  const signalEmail = clientSignalEmail({ to: payload.to, cc: payload.cc, body: payload.body }) ?? ''
  const match = matchDeliverable({
    subject: payload.subject ?? '',
    body: payload.body ?? '',
    fromEmail: signalEmail,
    clients: deps.matchData.clients,
    projects: deps.matchData.projects,
    contacts: deps.matchData.contacts,
    domainMap: deps.matchData.domainMap,
  })
  const routing = routeMatch(match)
  const labeled = describeCandidates(match.candidates, deps.matchData)

  const emailDate = emailDateISO(payload.date, deps.now)
  const dateISO = originalSendDate(payload.body ?? '', emailDate)
  const project = match.projectId ? deps.matchData.projects.find((p) => p.id === match.projectId) ?? null : null
  const clientName = match.clientId ? deps.matchData.clients.find((c) => c.id === match.clientId)?.name ?? null : null

  const resolver: FolderResolver = {
    sharedDriveId: deps.sharedDriveId,
    clientFolderId: () => deps.clientFolderId(match.clientId!),
    projectFolderName: () => {
      if (!project) throw new Error('projectFolderName called without a resolved project')
      return projectFolderName(project.project_name, project.project_code, dateISO)
    },
    needsReviewFolderName: '00_Needs Review',
    unsortedFolderName: '_Unsorted',
  }

  const folderId = await targetFolder(deps, resolver, routing)
  const persistClientId = routing.confident ? match.clientId : null
  const persistProjectId = routing.status === 'filed' ? match.projectId : null

  let filed = 0, queued = 0, duplicates = 0
  const replyItems: ReplyItem[] = []

  async function handle(opts: {
    kind: 'file' | 'link'
    name: string
    dedup: { fileHash?: string | null; sourceUrl?: string | null }
    file?: { mimeType: string; bytes: Buffer }
    sourceUrl?: string | null
  }) {
    if (await deps.findDup(folderId, opts.dedup)) {
      duplicates++
      replyItems.push({ name: opts.name, status: 'duplicate' })
      return
    }
    const rec = await fileDeliverable(deps.drive, resolver, {
      kind: opts.kind, confident: routing.confident, hasProject: routing.hasProject,
      original_file_name: opts.name, dateISO,
      mimeType: opts.file?.mimeType, bytes: opts.file?.bytes, source_url: opts.sourceUrl ?? undefined,
    })
    await deps.persist({
      client_id: persistClientId, project_id: persistProjectId,
      kind: rec.kind, drive_file_id: rec.drive_file_id, drive_folder_id: rec.drive_folder_id, file_name: rec.file_name,
      original_file_name: opts.kind === 'file' ? opts.name : null,
      file_hash: opts.dedup.fileHash ?? null, source_url: opts.dedup.sourceUrl ?? null,
      mime_type: opts.file?.mimeType ?? null, size_bytes: opts.file?.bytes.length ?? null,
      source: 'email', status: rec.status,
      match_confidence: match.confidence, match_method: match.method, match_candidates: labeled,
      gmail_message_id: payload.messageId, email_subject: payload.subject ?? null, email_from: payload.from, email_date: emailDate,
      forwarded_by: payload.from, filed_by: null, filed_at: deps.now.toISOString(),
    })
    if (rec.status === 'filed') filed++
    else queued++
    replyItems.push({
      name: rec.file_name, status: rec.status,
      clientName, projectLabel: project ? `${project.project_name} (${project.project_code})` : null,
      driveUrl: rec.status === 'filed' ? `https://drive.google.com/file/d/${rec.drive_file_id}/view` : null,
    })
  }

  for (const f of files) {
    await handle({ kind: 'file', name: f.filename, dedup: { fileHash: f.hash }, file: { mimeType: f.mimeType, bytes: f.bytes } })
  }
  for (const raw of links) {
    const normalized = normalizeUrl(raw)
    await handle({ kind: 'link', name: linkDisplayName(raw), dedup: { sourceUrl: normalized }, sourceUrl: normalized })
  }

  if (replyItems.length > 0) {
    const summary = { items: replyItems, queueUrl: `${deps.appUrl}/deliverables` }
    await deps.reply(payload.from, replySubject(payload.subject, summary), renderReplyHtml(summary))
  }

  return { action: 'processed', filed, queued, duplicates }
}
```

> `renderReplyHtml`/`replySubject`/`ReplyItem` come from Task 5; `reply.ts` imports nothing internal, so this static import creates no cycle.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/deliverables/email-ingest.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Run the whole deliverables suite to confirm no regressions**

Run: `npm test -- lib/deliverables`
Expected: PASS (Phase-1 + new files).

- [ ] **Step 6: Commit**

```bash
git add survey-ops-tracker/lib/deliverables/email-ingest.ts survey-ops-tracker/lib/deliverables/email-ingest.test.ts
git commit -m "feat(deliverables): email ingest orchestration (match, route, dedup, file, persist, reply)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Ingest route adapter (`app/api/deliverables/ingest/route.ts`)

Thin adapter: auth via `WEBHOOK_SECRET`, parse, wire real Supabase/Drive/Resend into `IngestDeps`, call `ingestEmail`. No unit test (no route harness in this repo) — it's covered by Task 6's orchestration tests plus the manual E2E in Task 13. Verified here by build + lint.

**Files:**
- Create: `survey-ops-tracker/app/api/deliverables/ingest/route.ts`

- [ ] **Step 1: Write the route**

Create `survey-ops-tracker/app/api/deliverables/ingest/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GoogleDrive } from '@/lib/drive/google'
import { safeEqual } from '@/lib/utils/secureCompare'
import { ingestEmail, type IngestDeps, type EmailDeliverableRow } from '@/lib/deliverables/email-ingest'
import { loadMatchData } from '@/lib/deliverables/load'
import { findDuplicate } from '@/lib/deliverables/persist'
import { ensureClientFolder } from '@/lib/deliverables/folders'
import { sendAndLog } from '@/lib/email/send'
import type { Database } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: Request): boolean {
  const header = req.headers.get('x-webhook-secret') ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return safeEqual(header, process.env.WEBHOOK_SECRET)
}

export async function POST(req: Request) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })
  const sharedDriveId = process.env.DELIVERABLES_SHARED_DRIVE_ID
  if (!sharedDriveId) return NextResponse.json({ error: 'Deliverables drive not configured' }, { status: 500 })

  let payload: { from?: string; messageId?: string } & Record<string, unknown>
  try { payload = await req.json() } catch { return new Response('Invalid JSON', { status: 400 }) }
  if (!payload?.from || !payload?.messageId) return new Response('from and messageId required', { status: 400 })

  const admin = createAdminClient()
  const drive = new GoogleDrive()
  const matchData = await loadMatchData(admin)

  const deps: IngestDeps = {
    drive,
    sharedDriveId,
    matchData,
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin,
    now: new Date(),
    isProcessed: async (mid) => {
      const { data } = await admin.from('deliverables').select('id').eq('gmail_message_id', mid).limit(1)
      return (data?.length ?? 0) > 0
    },
    clientFolderId: (clientId) => ensureClientFolder(admin, drive, sharedDriveId, clientId),
    findDup: (folderId, opts) => findDuplicate(admin, folderId, opts),
    persist: async (row: EmailDeliverableRow) => {
      // Boundary cast: row is structurally the deliverables Insert; only match_candidates (LabeledCandidate[]) needs widening to Json.
      const { data: inserted, error } = await admin
        .from('deliverables')
        .insert(row as unknown as Database['public']['Tables']['deliverables']['Insert'])
        .select('id').single()
      if (error) { console.error('[deliverables/ingest] insert failed', { drive_file_id: row.drive_file_id, error }); return }
      if (row.project_id) {
        await admin.from('project_activity').insert({
          project_id: row.project_id, type: 'deliverable', direction: 'outbound',
          subject: row.file_name, snippet: `Filed deliverable (email): ${row.file_name}`,
          source: 'deliverables', external_id: `deliverable:${inserted!.id}`,
          occurred_at: new Date().toISOString(),
        })
      }
    },
    reply: async (to, subject, html) => {
      await sendAndLog({ to, subject, html, template: 'deliverable_email_receipt', submissionId: null })
    },
  }

  const outcome = await ingestEmail(payload as Parameters<typeof ingestEmail>[0], deps)
  return NextResponse.json({ ok: true, ...outcome })
}
```

- [ ] **Step 2: Build + lint**

Run: `npm run build`
Expected: route compiles (`/api/deliverables/ingest` listed). Then `npm run lint` — clean. If `Database['public']['Tables']['deliverables']['Insert']` doesn't resolve, confirm `lib/supabase/types.ts` exports `Database` (it does — the Row types reference it); use the same path the upload route's neighbors use.

- [ ] **Step 3: Commit**

```bash
git add survey-ops-tracker/app/api/deliverables/ingest/route.ts
git commit -m "feat(deliverables): POST /api/deliverables/ingest (WEBHOOK_SECRET-authed email capture)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Resolve orchestration (`lib/deliverables/resolve.ts`)

Testable core for the queue's "file this here" and "dismiss" actions. Dependencies injected; the spec's required test (`resolve → moveFile + status flip, DriveClient faked`) lives here.

**Files:**
- Create: `survey-ops-tracker/lib/deliverables/resolve.ts`
- Test: `survey-ops-tracker/lib/deliverables/resolve.test.ts`

- [ ] **Step 1: Write the failing test**

Create `survey-ops-tracker/lib/deliverables/resolve.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { resolveDeliverable, dismissDeliverable, type ResolveDeps, type DeliverableForResolve, type ProjectForResolve } from './resolve'

const queued: DeliverableForResolve = { id: 'd1', file_name: '2026.06.15 — x.pdf', drive_file_id: 'f1', status: 'review', deleted_at: null }
const project: ProjectForResolve = { id: 'p1', client_id: 'c1', project_code: 'PR00003', project_name: 'B2B Tracker', deliver_date: '2026-06-15' }

function makeDeps(over: Partial<ResolveDeps> = {}) {
  const calls = { move: [] as [string, string][], update: [] as [string, Record<string, unknown>][], activity: [] as string[] }
  const deps: ResolveDeps = {
    getDeliverable: async () => queued,
    getProject: async () => project,
    projectFolderId: async () => 'project-folder',
    moveFile: async (fileId, folderId) => { calls.move.push([fileId, folderId]) },
    updateDeliverable: async (id, patch) => { calls.update.push([id, patch]) },
    logActivity: async (pid) => { calls.activity.push(pid) },
    now: new Date('2026-06-24T12:00:00Z'),
    ...over,
  }
  return { deps, calls }
}

describe('resolveDeliverable', () => {
  it('moves the file and flips the row to filed/manual', async () => {
    const { deps, calls } = makeDeps()
    const res = await resolveDeliverable(deps, { id: 'd1', projectId: 'p1', userId: 'u1' })
    expect(res.ok).toBe(true)
    expect(calls.move).toEqual([['f1', 'project-folder']])
    expect(calls.update[0][1]).toMatchObject({ client_id: 'c1', project_id: 'p1', drive_folder_id: 'project-folder', status: 'filed', match_method: 'manual', match_confidence: 1, filed_by: 'u1' })
    expect(calls.activity).toEqual(['p1'])
  })

  it('404s when the deliverable is missing or deleted', async () => {
    const { deps } = makeDeps({ getDeliverable: async () => null })
    expect(await resolveDeliverable(deps, { id: 'x', projectId: 'p1', userId: 'u1' })).toMatchObject({ ok: false, status: 404 })
  })

  it('409s when the deliverable is already filed', async () => {
    const { deps } = makeDeps({ getDeliverable: async () => ({ ...queued, status: 'filed' }) })
    expect(await resolveDeliverable(deps, { id: 'd1', projectId: 'p1', userId: 'u1' })).toMatchObject({ ok: false, status: 409 })
  })

  it('422s when the chosen project lacks a client or code', async () => {
    const { deps } = makeDeps({ getProject: async () => ({ ...project, client_id: null }) })
    expect(await resolveDeliverable(deps, { id: 'd1', projectId: 'p1', userId: 'u1' })).toMatchObject({ ok: false, status: 422 })
  })
})

describe('dismissDeliverable', () => {
  it('soft-deletes the row', async () => {
    const update = vi.fn(async () => {})
    const res = await dismissDeliverable({ updateDeliverable: update, now: new Date('2026-06-24T12:00:00Z') }, { id: 'd1' })
    expect(res.ok).toBe(true)
    expect(update).toHaveBeenCalledWith('d1', { deleted_at: '2026-06-24T12:00:00.000Z' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/deliverables/resolve.test.ts`
Expected: FAIL — `Failed to resolve import "./resolve"`.

- [ ] **Step 3: Write minimal implementation**

Create `survey-ops-tracker/lib/deliverables/resolve.ts`:

```typescript
// lib/deliverables/resolve.ts
export type DeliverableForResolve = { id: string; file_name: string | null; drive_file_id: string | null; status: string; deleted_at: string | null }
export type ProjectForResolve = { id: string; client_id: string | null; project_code: string | null; project_name: string; deliver_date: string | null }

export type ResolveDeps = {
  getDeliverable: (id: string) => Promise<DeliverableForResolve | null>
  getProject: (id: string) => Promise<ProjectForResolve | null>
  projectFolderId: (project: ProjectForResolve) => Promise<string>
  moveFile: (fileId: string, folderId: string) => Promise<void>
  updateDeliverable: (id: string, patch: Record<string, unknown>) => Promise<void>
  logActivity: (projectId: string, fileName: string, deliverableId: string) => Promise<void>
  now: Date
}

export type ResolveResult = { ok: true } | { ok: false; error: string; status: number }

export async function resolveDeliverable(deps: ResolveDeps, input: { id: string; projectId: string; userId: string }): Promise<ResolveResult> {
  const d = await deps.getDeliverable(input.id)
  if (!d || d.deleted_at) return { ok: false, error: 'Deliverable not found', status: 404 }
  if (d.status !== 'review' && d.status !== 'unsorted') return { ok: false, error: 'Deliverable is already filed', status: 409 }

  const p = await deps.getProject(input.projectId)
  if (!p || !p.client_id || !p.project_code) return { ok: false, error: 'Project must have a client and code', status: 422 }

  const folderId = await deps.projectFolderId(p)
  if (d.drive_file_id) await deps.moveFile(d.drive_file_id, folderId)
  await deps.updateDeliverable(input.id, {
    client_id: p.client_id, project_id: p.id, drive_folder_id: folderId,
    status: 'filed', match_method: 'manual', match_confidence: 1,
    filed_by: input.userId, filed_at: deps.now.toISOString(),
  })
  await deps.logActivity(p.id, d.file_name ?? 'deliverable', input.id)
  return { ok: true }
}

export async function dismissDeliverable(deps: { updateDeliverable: (id: string, patch: Record<string, unknown>) => Promise<void>; now: Date }, input: { id: string }): Promise<{ ok: true }> {
  await deps.updateDeliverable(input.id, { deleted_at: deps.now.toISOString() })
  return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/deliverables/resolve.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add survey-ops-tracker/lib/deliverables/resolve.ts survey-ops-tracker/lib/deliverables/resolve.test.ts
git commit -m "feat(deliverables): resolve/dismiss orchestration for the review queue

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Resolve route adapter (`app/api/deliverables/[id]/resolve/route.ts`)

Thin adapter, analyst-only, Next 15 dynamic params. Wires `resolveDeliverable`/`dismissDeliverable`. Verified by build + lint + Task 8 tests + manual E2E.

**Files:**
- Create: `survey-ops-tracker/app/api/deliverables/[id]/resolve/route.ts`

- [ ] **Step 1: Write the route**

Create `survey-ops-tracker/app/api/deliverables/[id]/resolve/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GoogleDrive } from '@/lib/drive/google'
import { resolveDeliverable, dismissDeliverable, type ResolveDeps } from '@/lib/deliverables/resolve'
import { ensureClientFolder, ensureProjectFolder } from '@/lib/deliverables/folders'
import { projectFolderName } from '@/lib/deliverables/naming'
import type { FolderResolver } from '@/lib/deliverables/ingest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function requireAnalyst() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { projectId?: string; dismiss?: boolean }
  const admin = createAdminClient()

  if (body.dismiss) {
    await dismissDeliverable({ updateDeliverable: async (rid, patch) => { await admin.from('deliverables').update(patch).eq('id', rid) }, now: new Date() }, { id })
    return NextResponse.json({ ok: true, dismissed: true })
  }

  if (!body.projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  const sharedDriveId = process.env.DELIVERABLES_SHARED_DRIVE_ID
  if (!sharedDriveId) return NextResponse.json({ error: 'Deliverables drive not configured' }, { status: 500 })
  const drive = new GoogleDrive()

  const deps: ResolveDeps = {
    getDeliverable: async (rid) => (await admin.from('deliverables').select('id, file_name, drive_file_id, status, deleted_at').eq('id', rid).single()).data,
    getProject: async (pid) => (await admin.from('survey_projects').select('id, client_id, project_code, project_name, deliver_date').eq('id', pid).is('deleted_at', null).single()).data,
    projectFolderId: async (p) => {
      const dateISO = p.deliver_date ?? new Date().toISOString().slice(0, 10)
      const resolver: FolderResolver = {
        sharedDriveId,
        clientFolderId: () => ensureClientFolder(admin, drive, sharedDriveId, p.client_id!),
        projectFolderName: () => projectFolderName(p.project_name, p.project_code!, dateISO),
        needsReviewFolderName: '00_Needs Review',
        unsortedFolderName: '_Unsorted',
      }
      return ensureProjectFolder(drive, resolver)
    },
    moveFile: (fileId, folderId) => drive.moveFile(fileId, folderId),
    updateDeliverable: async (rid, patch) => { await admin.from('deliverables').update(patch).eq('id', rid) },
    logActivity: async (pid, fileName, did) => {
      await admin.from('project_activity').insert({
        project_id: pid, type: 'deliverable', direction: 'outbound',
        subject: fileName, snippet: `Filed deliverable (resolved): ${fileName}`,
        source: 'deliverables', external_id: `deliverable:${did}`,
        occurred_at: new Date().toISOString(),
      })
    },
    now: new Date(),
  }

  const result = await resolveDeliverable(deps, { id, projectId: body.projectId, userId: user.id })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Build + lint**

Run: `npm run build` then `npm run lint`
Expected: `/api/deliverables/[id]/resolve` compiles; lint clean.

- [ ] **Step 3: Commit**

```bash
git add "survey-ops-tracker/app/api/deliverables/[id]/resolve/route.ts"
git commit -m "feat(deliverables): POST /api/deliverables/[id]/resolve (analyst resolve + dismiss)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Review-queue data hooks (`lib/hooks/useReviewQueue.ts`)

TanStack Query hooks mirroring `lib/hooks/useDeliverables.ts`. The queue reads via the browser Supabase client (analyst RLS applies). Project options are fetched as two simple queries (projects + clients) and joined client-side to avoid embedded-resource typing friction.

**Files:**
- Create: `survey-ops-tracker/lib/hooks/useReviewQueue.ts`

- [ ] **Step 1: Write the hooks**

Create `survey-ops-tracker/lib/hooks/useReviewQueue.ts`:

```typescript
'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { LabeledCandidate } from '@/lib/deliverables/confidence'

export type QueueRow = {
  id: string
  file_name: string | null
  original_file_name: string | null
  kind: 'file' | 'link'
  status: 'review' | 'unsorted'
  source_url: string | null
  drive_file_id: string | null
  email_subject: string | null
  email_from: string | null
  match_candidates: LabeledCandidate[] | null
  client_id: string | null
  project_id: string | null
}

export type ProjectOption = { id: string; label: string }

export function useReviewQueue() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['deliverables-queue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deliverables')
        .select('id, file_name, original_file_name, kind, status, source_url, drive_file_id, email_subject, email_from, match_candidates, client_id, project_id')
        .in('status', ['review', 'unsorted'])
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as QueueRow[]
    },
  })
}

export function useProjectOptions() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['project-options'],
    queryFn: async (): Promise<ProjectOption[]> => {
      const [{ data: projects, error: pErr }, { data: clients, error: cErr }] = await Promise.all([
        supabase.from('survey_projects').select('id, project_code, project_name, client_id').is('deleted_at', null).not('project_code', 'is', null).order('project_name'),
        supabase.from('clients').select('id, name'),
      ])
      if (pErr) throw pErr
      if (cErr) throw cErr
      const clientName = new Map((clients ?? []).map((c) => [c.id, c.name]))
      return (projects ?? []).map((p) => ({
        id: p.id,
        label: `${p.client_id ? clientName.get(p.client_id) ?? '—' : '—'} — ${p.project_name} (${p.project_code})`,
      }))
    },
  })
}

export function useResolveDeliverable() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, projectId }: { id: string; projectId: string }) => {
      const res = await fetch(`/api/deliverables/${id}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Resolve failed')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deliverables-queue'] }),
  })
}

export function useDismissDeliverable() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const res = await fetch(`/api/deliverables/${id}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dismiss: true }) })
      if (!res.ok) throw new Error('Dismiss failed')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deliverables-queue'] }),
  })
}
```

- [ ] **Step 2: Type-check via build**

Run: `npm run build`
Expected: compiles. (No standalone test — exercised by the component test in Task 11.)

- [ ] **Step 3: Commit**

```bash
git add survey-ops-tracker/lib/hooks/useReviewQueue.ts
git commit -m "feat(deliverables): review-queue data hooks (queue, project options, resolve, dismiss)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Review-queue component + page (`components/deliverables/ReviewQueue.tsx`, `app/(app)/deliverables/page.tsx`)

The working queue. Mirrors the patterns in `components/deliverables/DeliverablesPanel.tsx` (Badge, InfoTooltip, toast) and is tested like `__tests__/components/deliverables/DeliverablesPanel.test.tsx` (mock the hooks).

**Files:**
- Create: `survey-ops-tracker/components/deliverables/ReviewQueue.tsx`
- Test: `survey-ops-tracker/__tests__/components/deliverables/ReviewQueue.test.tsx`
- Modify: `survey-ops-tracker/app/(app)/deliverables/page.tsx`

- [ ] **Step 1: Write the failing component test**

Create `survey-ops-tracker/__tests__/components/deliverables/ReviewQueue.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReviewQueue } from '@/components/deliverables/ReviewQueue'

const resolveMutate = vi.fn()
const dismissMutate = vi.fn()

vi.mock('@/lib/hooks/useReviewQueue', () => ({
  useReviewQueue: () => ({
    data: [{
      id: 'd1', file_name: '2026.06.15 — Topline.pdf', original_file_name: 'Topline.pdf', kind: 'file',
      status: 'review', source_url: null, drive_file_id: 'f1', email_subject: 'Final topline', email_from: 'analyst@alpharoc.ai',
      match_candidates: [{ clientId: 'c1', projectId: 'p1', confidence: 0.7, band: 'Med', label: 'Coatue → B2B Tracker (PR00003)' }],
      client_id: null, project_id: null,
    }],
    isLoading: false,
  }),
  useProjectOptions: () => ({ data: [{ id: 'p1', label: 'Coatue — B2B Tracker (PR00003)' }], isLoading: false }),
  useResolveDeliverable: () => ({ mutate: resolveMutate, isPending: false }),
  useDismissDeliverable: () => ({ mutate: dismissMutate, isPending: false }),
}))

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

describe('ReviewQueue', () => {
  it('shows the email context and a candidate with its band', () => {
    render(wrap(<ReviewQueue />))
    expect(screen.getByText('Final topline')).toBeInTheDocument()
    expect(screen.getByText(/Coatue → B2B Tracker \(PR00003\)/)).toBeInTheDocument()
    expect(screen.getByText(/Med/)).toBeInTheDocument()
  })

  it('files the chosen candidate via the resolve mutation', () => {
    render(wrap(<ReviewQueue />))
    fireEvent.click(screen.getByRole('button', { name: /Coatue → B2B Tracker \(PR00003\)/ }))
    expect(resolveMutate).toHaveBeenCalledWith({ id: 'd1', projectId: 'p1' })
  })

  it('dismisses non-deliverables', () => {
    render(wrap(<ReviewQueue />))
    fireEvent.click(screen.getByRole('button', { name: /not a deliverable/i }))
    expect(dismissMutate).toHaveBeenCalledWith({ id: 'd1' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/components/deliverables/ReviewQueue.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/deliverables/ReviewQueue"`.

- [ ] **Step 3: Write the component**

Create `survey-ops-tracker/components/deliverables/ReviewQueue.tsx`:

```typescript
'use client'
import { useState } from 'react'
import { useReviewQueue, useProjectOptions, useResolveDeliverable, useDismissDeliverable, type QueueRow } from '@/lib/hooks/useReviewQueue'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/lib/utils/toast'

const driveUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`

function QueueCard({ row }: { row: QueueRow }) {
  const options = useProjectOptions()
  const resolve = useResolveDeliverable()
  const dismiss = useDismissDeliverable()
  const [manual, setManual] = useState('')
  const busy = resolve.isPending || dismiss.isPending

  function file(projectId: string) {
    resolve.mutate({ id: row.id, projectId }, {
      onSuccess: () => toast('Filed ✓', 'success'),
      onError: (e) => toast(String((e as Error).message)),
    })
  }

  const href = row.source_url ?? (row.drive_file_id ? driveUrl(row.drive_file_id) : '#')
  const candidates = (row.match_candidates ?? []).filter((c) => c.projectId)

  return (
    <li className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 text-sm">
        <span>{row.kind === 'link' ? '🔗' : '📄'}</span>
        <a className="font-medium truncate hover:underline" href={href} target="_blank" rel="noreferrer">
          {row.file_name ?? row.original_file_name ?? 'Untitled'}
        </a>
        {row.status === 'unsorted' && <Badge variant="outline">unsorted</Badge>}
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        {row.email_subject ?? '(no subject)'} · from {row.email_from ?? 'unknown'}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {candidates.length > 0 ? (
          candidates.map((c, i) => (
            <button
              key={i}
              disabled={busy}
              onClick={() => file(c.projectId!)}
              className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-40"
            >
              {c.label} <span className="text-muted-foreground">({c.band})</span>
            </button>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">No confident guess — pick a project:</span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          className="text-xs px-2 py-1.5 rounded-lg border border-border bg-background flex-1 min-w-48"
        >
          <option value="">Search / pick another project…</option>
          {(options.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <button
          disabled={busy || !manual}
          onClick={() => file(manual)}
          className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-40"
        >
          File here
        </button>
        <button
          disabled={busy}
          onClick={() => dismiss.mutate({ id: row.id }, { onSuccess: () => toast('Dismissed', 'success'), onError: (e) => toast(String((e as Error).message)) })}
          className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-40 text-muted-foreground"
        >
          Not a deliverable
        </button>
      </div>
    </li>
  )
}

export function ReviewQueue() {
  const { data, isLoading } = useReviewQueue()

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!data || data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground flex items-center">
        Nothing to review 🎉
        <InfoTooltip text="Emailed deliverables we couldn't auto-file to a single client + project land here. Auto-filed ones go straight to the client's Shared Drive folder." />
      </p>
    )
  }

  return (
    <ul className="space-y-3">
      {data.map((row) => <QueueCard key={row.id} row={row} />)}
    </ul>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- __tests__/components/deliverables/ReviewQueue.test.tsx`
Expected: PASS (3 tests). The candidate button's accessible name includes the `(Med)` span, so `name: /Coatue → B2B Tracker \(PR00003\)/` matches.

- [ ] **Step 5: Swap the placeholder page**

Replace the contents of `survey-ops-tracker/app/(app)/deliverables/page.tsx` with:

```typescript
import { ReviewQueue } from '@/components/deliverables/ReviewQueue'

export const dynamic = 'force-dynamic'

export default function DeliverablesPage() {
  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-lg font-semibold">Deliverables — Review queue</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-4">
        Emailed deliverables we couldn&apos;t auto-file to a single client + project land here — confirm the client/project to file them.
        Most deliverables auto-file straight to the client&apos;s Shared Drive folder; you can also attach one directly from any project page.
      </p>
      <ReviewQueue />
    </div>
  )
}
```

- [ ] **Step 6: Build + lint + full test run**

Run: `npm run build` then `npm run lint` then `npm test`
Expected: all clean/green.

- [ ] **Step 7: Commit**

```bash
git add survey-ops-tracker/components/deliverables/ReviewQueue.tsx "survey-ops-tracker/__tests__/components/deliverables/ReviewQueue.test.tsx" "survey-ops-tracker/app/(app)/deliverables/page.tsx"
git commit -m "feat(deliverables): review-queue page (candidate one-click filing, manual pick, dismiss)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Apps Script transport + setup README (`scripts/apps-script/`)

The free transport. It runs in Google's Apps Script (NOT part of the Next build or test suite). It is intentionally dumb — all logic is server-side; idempotency is enforced by `gmail_message_id`, so a retried run is harmless.

**Files:**
- Create: `survey-ops-tracker/scripts/apps-script/deliverables-forwarder.gs`
- Create: `survey-ops-tracker/scripts/apps-script/README.md`

- [ ] **Step 1: Write the Apps Script**

Create `survey-ops-tracker/scripts/apps-script/deliverables-forwarder.gs`:

```javascript
/**
 * Deliverables forwarder — Apps Script (runs in Google, not in the Next app).
 *
 * Bound to the backing inbox that the deliverables@alpharoc.ai Google Group delivers into.
 * On a ~5-minute trigger it finds unprocessed inbox messages, POSTs each to the app's
 * /api/deliverables/ingest endpoint, then labels the thread so it is never re-sent.
 *
 * Script Properties required (Project Settings → Script properties):
 *   INGEST_URL     e.g. https://survey-ops-tracker.vercel.app/api/deliverables/ingest
 *   WEBHOOK_SECRET  the same value set in Vercel
 *
 * One-time: run installTrigger() once, then authorize when prompted.
 */

var PROCESSED_LABEL = 'deliverables-filed';
var MAX_ATTACHMENT_BYTES = 26214400; // ~25 MB; skip larger so the POST stays well under limits

function processInbox() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('INGEST_URL');
  var secret = props.getProperty('WEBHOOK_SECRET');
  if (!url || !secret) throw new Error('Set INGEST_URL and WEBHOOK_SECRET in Script Properties.');

  var label = GmailApp.getUserLabelByName(PROCESSED_LABEL) || GmailApp.createLabel(PROCESSED_LABEL);
  // Unprocessed inbox threads from the last week (the trigger runs often; the window is just a safety bound).
  var threads = GmailApp.search('in:inbox -label:' + PROCESSED_LABEL + ' newer_than:7d', 0, 50);

  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t];
    var messages = thread.getMessages();
    var allOk = true;

    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];
      var attachments = [];
      // includeInlineImages:false drops signature logos / tracking pixels at the source.
      var atts = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
      for (var a = 0; a < atts.length; a++) {
        var blob = atts[a];
        if (blob.getBytes().length > MAX_ATTACHMENT_BYTES) continue;
        attachments.push({
          filename: blob.getName(),
          mimeType: blob.getContentType(),
          base64: Utilities.base64Encode(blob.getBytes()),
        });
      }

      var payload = {
        from: msg.getFrom(),
        to: msg.getTo(),
        cc: msg.getCc(),
        subject: msg.getSubject(),
        date: msg.getDate().toUTCString(),
        messageId: msg.getId(),
        body: msg.getPlainBody(),
        attachments: attachments,
      };

      var res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-webhook-secret': secret },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });
      var code = res.getResponseCode();
      if (code < 200 || code >= 300) {
        allOk = false;
        Logger.log('Ingest failed (' + code + ') for message ' + msg.getId() + ': ' + res.getContentText());
      }
    }

    // Only label the thread done if every message posted OK; otherwise retry next run (server is idempotent).
    if (allOk) thread.addLabel(label);
  }
}

function installTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processInbox') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('processInbox').timeBased().everyMinutes(5).create();
  Logger.log('Trigger installed: processInbox every 5 minutes.');
}
```

- [ ] **Step 2: Write the setup README**

Create `survey-ops-tracker/scripts/apps-script/README.md`:

```markdown
# Deliverables email capture — transport setup (free, no admin)

Lets the team **bcc / cc / forward** an outbound client email to **deliverables@alpharoc.ai**;
the app auto-files the attachments/links into the client's Shared Drive folder (or the in-app
review queue) and replies "Filed ✓".

## What you set up (one time)

1. **Create the Google Group `deliverables@alpharoc.ai`** (groups.google.com → Create group).
   - Who can post: *Anyone on the web* is NOT needed — internal posting is enough, but allowing
     external posting is harmless because the app only processes messages **from @alpharoc.ai**.
   - Set the group to **deliver messages to a backing inbox**: add a Workspace user (e.g. an ops
     mailbox you control) as a member with "Each email" delivery, OR use a Collaborative Inbox.
     The simplest reliable option: add one Workspace user as a member so every group message
     also lands in that user's Gmail inbox.

2. **In that backing inbox's Google account**, go to **script.google.com → New project**.
   - Paste the contents of `deliverables-forwarder.gs`.
   - **Project Settings → Script properties → Add**:
     - `INGEST_URL` = `https://survey-ops-tracker.vercel.app/api/deliverables/ingest`
     - `WEBHOOK_SECRET` = (the same value already set in Vercel — ask the app owner)
   - Run **`installTrigger`** once. Approve the OAuth consent (Gmail read + external requests).
     This authorizes the script to read that inbox and call the app.

3. **Done.** Within ~5 minutes of a message landing, it's processed and the thread gets a
   `deliverables-filed` label. The sender receives a "Filed ✓ / Needs a quick review" reply.

## Tips for the team
- Put the project code (e.g. **PR00003**) in the subject for a near-certain auto-file.
- Attachments and Google/Occam/Edwin links are both captured.
- Anything we can't confidently match appears in the app's **Deliverables → Review queue**.

## Notes
- The script is intentionally dumb; all matching/filing logic is in the app. Retries are safe
  (the server de-dupes by Gmail message id).
- Attachments over ~25 MB are skipped by the script — share those as a Drive link instead.
```

- [ ] **Step 3: Commit**

```bash
git add survey-ops-tracker/scripts/apps-script/deliverables-forwarder.gs survey-ops-tracker/scripts/apps-script/README.md
git commit -m "feat(deliverables): Apps Script email transport + setup README

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: USER_GUIDE update + final gate

Document the feature for the team, then run the full gate one last time.

**Files:**
- Modify: `survey-ops-tracker/USER_GUIDE.md`

- [ ] **Step 1: Add a "Emailing deliverables" section to USER_GUIDE.md**

Find the existing Deliverables section in `survey-ops-tracker/USER_GUIDE.md` (search for "Deliverables"; Phase 1 added the in-app upload docs). Immediately after it, add:

```markdown
### Emailing deliverables (bcc / cc / forward)

You don't have to open the app to file a deliverable. When you send the final files/links to a
client, just **bcc, cc, or forward** that email to **deliverables@alpharoc.ai**.

- The system reads the **client you sent to** (the external recipient) plus the subject/body to
  figure out the client and project, then files every attachment and deliverable link into the
  client's `Client / {Project}_{PR#####}_{date}` Shared Drive folder.
- Put the **project code (e.g. PR00003) in the subject** for a near-certain match.
- You'll get a quick **"Filed ✓"** reply listing each item and its Drive link. If we couldn't tell
  which client/project it belonged to, the reply says **"Needs a quick review"** with a link to the
  **Deliverables → Review queue**.

### The Review queue

Open **Deliverables** in the top menu. Anything emailed in that we couldn't auto-file to a single
client + project shows here with our best guesses (High / Med / Low confidence). Click a guess to
file it, pick another project from the dropdown, or mark it **"Not a deliverable"** to dismiss it.
Items already filed under the right client but with no project show as **unsorted** — assign a
project the same way.
```

- [ ] **Step 2: Final full gate**

Run, from `survey-ops-tracker/`:
```bash
npm test
npm run build
npm run lint
```
Expected: all tests green, build succeeds, lint clean.

- [ ] **Step 3: Commit**

```bash
git add survey-ops-tracker/USER_GUIDE.md
git commit -m "docs(deliverables): user guide — emailing deliverables + the review queue

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Post-build: human setup + verification (David — all free, no admin)

These are external to the code and gate go-live (also recorded in the spec §8):

1. **Create the Google Group `deliverables@alpharoc.ai`** and point it at a backing inbox (a Workspace user you control). See `scripts/apps-script/README.md`.
2. **Authorize the Apps Script** in that inbox's account: paste `deliverables-forwarder.gs`, set `INGEST_URL` + `WEBHOOK_SECRET` in Script Properties, run `installTrigger`, approve consent.
3. `WEBHOOK_SECRET` is already set in Vercel; **no new env vars**. (Optionally set `NEXT_PUBLIC_APP_URL` so reply links use the canonical domain rather than the request origin.)

**Manual E2E (do before announcing to the team):**
- bcc a test email **to a real client address you can match**, with a PDF attached, including `PRxxxxx` in the subject → within ~5 min it should auto-file to `Client / {Project}_{PR#####}_{date}` and you should receive a "Filed ✓" reply.
- bcc a deliberately ambiguous email (no code, unknown recipient) → it should land in **Deliverables → Review queue**; resolve it to a project and confirm the file moves into the project folder.
- Re-send the same message → no duplicate row/file (idempotent + dedup).
- Send from a non-@alpharoc.ai address → ignored (nothing filed).

## Spec coverage map (self-review)

- §1 Transport → Task 12 (Apps Script + README) + §8 human setup.
- §2 Ingest endpoint (auth, idempotency, sender gate, itemize, resolve, file/queue, persist, reply) → Tasks 2, 3, 6, 7.
- §3 Matching signal (external recipient / forwarded original; reuse unchanged matcher; original send date) → Task 2 (`clientSignalEmail`, `emailDateISO`) + Task 6 (feeds `matchDeliverable`, uses `originalSendDate`).
- §4 Review queue (list review+unsorted, plain-language candidates + High/Med/Low, resolve via moveFile + status flip, dismiss) → Tasks 3, 8, 9, 10, 11.
- §5 "Filed ✓" reply via `sendAndLog` → Task 5 (render) + Task 7 (send).
- §6 Security (WEBHOOK_SECRET, internal-sender gate, analyst-only resolve, URL hardening reused) → Tasks 6, 7, 9 (the bookmark `assertHttpUrl` hardening is already in the reused `GoogleDrive`/`fileDeliverable`).
- §7 Testing (unit: recipient extraction, itemization, confident-vs-queue, idempotency, sender gate; integration: ingest confident/ambiguous/duplicate/link/external; resolve moveFile+flip; component: queue) → Tasks 2, 3, 6, 8, 11.
- §8 Human setup → README (Task 12) + Post-build section.
- Out of scope (Phase 3: weekly QA report, AI matcher tier, aging emails) → not in this plan, by design.
