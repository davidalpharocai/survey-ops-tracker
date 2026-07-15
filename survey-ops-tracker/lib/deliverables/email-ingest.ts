// lib/deliverables/email-ingest.ts
import type { DriveClient } from '@/lib/drive/types'
import type { ClientRec, ContactRec, ProjectRec } from './types'
import { matchDeliverable, namedClients } from './matcher'
import { fileDeliverable, type FolderResolver } from './ingest'
import { projectFolderName, originalSendDate } from './naming'
import { routeMatch, describeCandidates, type LabeledCandidate } from './confidence'
import { clientSignalEmail, emailDateISO, itemizeAttachments, isInternalSender, emailDomain, type IngestPayload } from './email'
import { replySubject, renderReplyHtml, type ReplyItem } from './reply'
import { serverCorroborates, AI_AUTO_FILE_THRESHOLD, type AiMatchInput, type AiMatchResult, type FilingHistoryRec } from './ai-matcher'

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
  // Matches the deliverable_status enum / FiledRecord.status; at runtime only filed|review|unsorted are persisted (dups are skipped before fileDeliverable).
  status: 'filed' | 'review' | 'duplicate' | 'unsorted'
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
  // Dedup is content-global (any folder): a file already filed anywhere in the depository is treated as a
  // duplicate, so an already-filed deliverable arriving by email is not re-staged into the review queue.
  findDup: (opts: { fileHash?: string | null; sourceUrl?: string | null }) => Promise<string | null>
  persist: (row: EmailDeliverableRow) => Promise<void>
  reply: (to: string, subject: string, html: string) => Promise<void>
  // AI matcher tier (optional). When absent, matching is deterministic-only (unchanged behavior).
  aiMatch?: (input: AiMatchInput) => Promise<AiMatchResult>
  filingHistory?: FilingHistoryRec[]
}

export type IngestOutcome =
  | { action: 'ignored'; reason: 'external_sender' | 'duplicate_message' | 'no_items' }
  | { action: 'processed'; filed: number; queued: number; duplicates: number }

export async function ingestEmail(payload: IngestPayload, deps: IngestDeps): Promise<IngestOutcome> {
  if (!isInternalSender(payload.from)) return { action: 'ignored', reason: 'external_sender' }
  if (await deps.isProcessed(payload.messageId)) return { action: 'ignored', reason: 'duplicate_message' }

  const files = itemizeAttachments(payload.attachments)
  // Attachments only — deliverable links in the body are intentionally NOT auto-filed.
  if (files.length === 0) return { action: 'ignored', reason: 'no_items' }

  const signalEmail = clientSignalEmail({ to: payload.to, cc: payload.cc, body: payload.body }) ?? ''

  // Global content-dedup, checked up front (per attachment) so an already-filed re-forward is skipped
  // WITHOUT spending an AI matcher call.
  const dupIds = await Promise.all(files.map((f) => deps.findDup({ fileHash: f.hash })))
  const anyNew = dupIds.some((d) => !d)

  const matchInput = {
    subject: payload.subject ?? '',
    body: payload.body ?? '',
    fromEmail: signalEmail,
    filenames: files.map((f) => f.filename.replace(/\.[^.]+$/, '')), // the deliverable filenames name the client/study
    clients: deps.matchData.clients,
    projects: deps.matchData.projects,
    contacts: deps.matchData.contacts,
    domainMap: deps.matchData.domainMap,
  }
  let match = matchDeliverable(matchInput)
  let routing = routeMatch(match)

  // AI matcher tier — only when the deterministic match is sub-threshold AND there is a new attachment to file.
  if (!routing.confident && anyNew && deps.aiMatch) {
    // Constrain the AI to the named client's projects when the filename/subject clearly names a client,
    // so the model can't pick another client's look-alike project (a "holocene…" file → only Holocene's
    // surveys). Falls back to all projects when no client is named.
    const named = namedClients(matchInput)
    const pool = named.size ? deps.matchData.projects.filter((p) => p.client_id && named.has(p.client_id)) : deps.matchData.projects
    const candidates = pool.map((p) => ({
      projectCode: p.project_code,
      projectName: p.project_name,
      clientName: deps.matchData.clients.find((c) => c.id === p.client_id)?.name ?? 'Unknown',
    }))
    const ai = await deps.aiMatch({
      from: payload.from,
      subject: payload.subject ?? '',
      filename: files.map((f) => f.filename).join(', '),
      bodySnippet: (payload.body ?? '').slice(0, 1500),
      candidates,
      history: deps.filingHistory ?? [],
    })
    const chosen = ai.projectCode ? deps.matchData.projects.find((p) => p.project_code === ai.projectCode) ?? null : null
    if (chosen) {
      const chosenClientName = deps.matchData.clients.find((c) => c.id === chosen.client_id)?.name ?? ''
      const dom = emailDomain(signalEmail)
      // Corroboration is re-verified server-side — the AI's own claim is never trusted alone.
      const corroborated =
        ai.confidence >= AI_AUTO_FILE_THRESHOLD &&
        serverCorroborates({
          clientName: chosenClientName,
          projectName: chosen.project_name,
          haystack: `${payload.subject ?? ''} ${files.map((f) => f.filename).join(' ')}`,
          senderDomainMatchesClient: !!dom && deps.matchData.domainMap[dom] === chosen.client_id,
          clientHasHistory: (deps.filingHistory ?? []).some((h) => h.clientId === chosen.client_id),
        })
      match = {
        clientId: chosen.client_id,
        projectId: chosen.id,
        // Corroborated → auto-file band; otherwise keep in the review band but surface the pick as the best guess.
        confidence: corroborated ? Math.max(ai.confidence, 0.85) : 0.6,
        method: 'ai',
        candidates: [
          { clientId: chosen.client_id, projectId: chosen.id, confidence: ai.confidence, reason: `ai:${ai.reasoning}`, method: 'ai' as const },
          ...match.candidates,
        ].slice(0, 3),
      }
      routing = routeMatch(match)
    }
  }

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
      return projectFolderName(project.project_name, project.project_code, dateISO, project.longitudinal ?? false)
    },
    needsReviewFolderName: '00_Needs Review',
    unsortedFolderName: '_Unsorted',
  }

  const persistClientId = routing.confident ? match.clientId : null
  const persistProjectId = routing.status === 'filed' ? match.projectId : null

  let filed = 0, queued = 0, duplicates = 0
  const replyItems: ReplyItem[] = []

  async function handle(opts: {
    kind: 'file' | 'link'
    name: string
    dedup: { fileHash?: string | null; sourceUrl?: string | null }
    dupId: string | null
    file?: { mimeType: string; bytes: Buffer }
    sourceUrl?: string | null
  }) {
    if (opts.dupId) {
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

  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    await handle({ kind: 'file', name: f.filename, dedup: { fileHash: f.hash }, dupId: dupIds[i], file: { mimeType: f.mimeType, bytes: f.bytes } })
  }

  if (replyItems.length > 0) {
    const summary = { items: replyItems, queueUrl: `${deps.appUrl}/deliverables` }
    await deps.reply(payload.from, replySubject(payload.subject, summary), renderReplyHtml(summary))
  }

  return { action: 'processed', filed, queued, duplicates }
}
