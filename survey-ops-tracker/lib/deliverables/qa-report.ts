// lib/deliverables/qa-report.ts
// Pure, I/O-free builder + Slack renderer for the weekly deliverables QA digest.
// The cron route fetches the rows and does the Slack POST; all logic lives here so it is unit-testable.

export type QaDeliverable = {
  id: string
  status: string
  match_method: string | null
  match_confidence: number | null
  match_candidates: unknown // stored LabeledCandidate[]; we only read [0].label defensively
  source: string
  file_hash: string | null
  project_id: string | null
  file_name: string | null
  original_file_name: string | null
  forwarded_by: string | null
  created_at: string
  filed_at: string | null
  deleted_at: string | null
}

export type QaProject = {
  id: string
  project_code: string | null
  project_name: string
  client: string | null
  deliver_date: string | null
  project_type: string | null
  deleted_at: string | null
}

export type QaConfig = { agingDays: number; lowConfidence: number; coverageLookbackDays: number; staleIngestDays: number; listCap: number; now: Date }
export const DEFAULT_QA_CONFIG: Omit<QaConfig, 'now'> = { agingDays: 7, lowConfidence: 0.9, coverageLookbackDays: 30, staleIngestDays: 14, listCap: 10 }

type AgingItem = { file: string; guess: string | null; ageDays: number; forwardedBy: string | null }
type SpotItem = { file: string; project: string | null; method: string | null; confidence: number | null }

export type QaReport = {
  generatedAt: string
  agingReview: { total: number; items: AgingItem[] }
  autoFileSpotCheck: { total: number; items: SpotItem[] }
  duplicates: { total: number; items: { file: string; count: number }[] }
  unsorted: { total: number; items: { file: string }[] }
  coverageGap: { total: number; examples: string[] }
  tally: { filed: number; bySourceMethod: { key: string; count: number }[] }
  pipelineHealth: { lastEmailIngestAt: string | null; daysSince: number | null; authRejections7d: number; healthy: boolean }
  clean: boolean
}

const DAY = 86400_000
const fileOf = (d: QaDeliverable) => d.original_file_name ?? d.file_name ?? '(unnamed)'
const daysBetween = (now: Date, iso: string) => Math.floor((now.getTime() - new Date(iso).getTime()) / DAY)

/** Top labeled candidate ("Client → Project (PR#####)") if present — read defensively from Json. */
function topGuess(d: QaDeliverable): string | null {
  const c = Array.isArray(d.match_candidates) ? d.match_candidates[0] : null
  const label = c && typeof c === 'object' && 'label' in c ? (c as { label?: unknown }).label : null
  return typeof label === 'string' ? label : null
}

export function buildQaReport(input: { deliverables: QaDeliverable[]; projects: QaProject[]; authRejections7d?: number }, config: QaConfig): QaReport {
  const { now, agingDays, lowConfidence, coverageLookbackDays, staleIngestDays, listCap } = config
  const live = input.deliverables.filter((d) => !d.deleted_at)
  const agingCutoff = now.getTime() - agingDays * DAY
  const recentCutoff = now.getTime() - agingDays * DAY

  const projLabel = (pid: string | null): string | null => {
    if (!pid) return null
    const p = input.projects.find((x) => x.id === pid)
    return p ? `${p.project_name}${p.project_code ? ` (${p.project_code})` : ''}` : null
  }

  // 1. Aging review queue — waiting past agingDays without resolution
  const agingAll = live
    .filter((d) => d.status === 'review' && new Date(d.created_at).getTime() < agingCutoff)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const agingReview = {
    total: agingAll.length,
    items: agingAll.slice(0, listCap).map((d) => ({ file: fileOf(d), guess: topGuess(d), ageDays: daysBetween(now, d.created_at), forwardedBy: d.forwarded_by })),
  }

  // 2. Auto-file spot-check — recent filings that were AI-matched or below the confidence bar
  const spotAll = live.filter(
    (d) =>
      d.status === 'filed' && d.filed_at != null && new Date(d.filed_at).getTime() >= recentCutoff &&
      (d.match_method === 'ai' || (d.match_confidence != null && d.match_confidence < lowConfidence)),
  )
  const autoFileSpotCheck = {
    total: spotAll.length,
    items: spotAll.slice(0, listCap).map((d) => ({ file: fileOf(d), project: projLabel(d.project_id), method: d.match_method, confidence: d.match_confidence })),
  }

  // 3a. Duplicates — same content (file_hash) across 2+ live, non-'duplicate' rows
  const byHash = new Map<string, QaDeliverable[]>()
  for (const d of live) {
    if (!d.file_hash || d.status === 'duplicate') continue
    byHash.set(d.file_hash, [...(byHash.get(d.file_hash) ?? []), d])
  }
  const dupGroups = [...byHash.values()].filter((g) => g.length >= 2)
  const duplicates = { total: dupGroups.length, items: dupGroups.slice(0, listCap).map((g) => ({ file: fileOf(g[0]), count: g.length })) }

  // 3b. Unsorted — filed to _Unsorted with no project
  const unsortedAll = live.filter((d) => d.status === 'unsorted')
  const unsorted = { total: unsortedAll.length, items: unsortedAll.slice(0, listCap).map((d) => ({ file: fileOf(d) })) }

  // 4a. Coverage gap — recently-delivered, non-internal projects with no filed deliverable (adoption signal)
  const covCutoff = now.getTime() - coverageLookbackDays * DAY
  const filedProjectIds = new Set(live.filter((d) => d.status === 'filed' && d.project_id).map((d) => d.project_id))
  const gapProjects = input.projects.filter(
    (p) =>
      !p.deleted_at && p.project_type !== 'Internal' && p.deliver_date != null &&
      new Date(p.deliver_date).getTime() >= covCutoff && new Date(p.deliver_date).getTime() <= now.getTime() &&
      !filedProjectIds.has(p.id),
  )
  const coverageGap = { total: gapProjects.length, examples: gapProjects.slice(0, 5).map((p) => `${p.project_name}${p.project_code ? ` (${p.project_code})` : ''}`) }

  // 4b. Tally — recent filings by source × method
  const filedRecent = live.filter((d) => d.status === 'filed' && d.filed_at != null && new Date(d.filed_at).getTime() >= recentCutoff)
  const tallyMap = new Map<string, number>()
  for (const d of filedRecent) {
    const key = `${d.source}|${d.match_method ?? 'none'}`
    tallyMap.set(key, (tallyMap.get(key) ?? 0) + 1)
  }
  const tally = { filed: filedRecent.length, bySourceMethod: [...tallyMap.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count) }

  // Pipeline health — the silent-outage detector. authRejections7d (rejected forwards, logged by the
  // ingest route) is the strong signal; a long gap since the last email ingest is a softer staleness warning.
  const emailLive = live.filter((d) => d.source === 'email')
  const lastEmailIngestAt = emailLive.length ? emailLive.reduce((m, d) => (d.created_at > m ? d.created_at : m), emailLive[0].created_at) : null
  const daysSince = lastEmailIngestAt ? daysBetween(now, lastEmailIngestAt) : null
  const authRejections7d = input.authRejections7d ?? 0
  const stale = daysSince != null && daysSince > staleIngestDays
  const pipelineHealth = { lastEmailIngestAt, daysSince, authRejections7d, healthy: authRejections7d === 0 && !stale }

  const clean =
    !agingReview.total && !autoFileSpotCheck.total && !duplicates.total && !unsorted.total && !coverageGap.total && pipelineHealth.healthy

  return { generatedAt: now.toISOString(), agingReview, autoFileSpotCheck, duplicates, unsorted, coverageGap, tally, pipelineHealth, clean }
}

const APP_URL = 'https://survey-ops-tracker.vercel.app'

// Escape the three mrkdwn control chars so a file/analyst value can't inject Slack markup.
function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
const overflow = (shown: number, total: number) => (total > shown ? `\n_…and ${total - shown} more_` : '')

export function renderQaReportText(r: QaReport): string {
  const date = r.generatedAt.slice(0, 10)
  const sections: string[] = [`📋 *Deliverables QA — ${date}*`]

  // Pipeline health — always shown; it's the whole point of the report to catch a silent forwarding outage.
  const ph = r.pipelineHealth
  const ingestLine = ph.lastEmailIngestAt ? `last email ingest ${ph.lastEmailIngestAt.slice(0, 10)} (${ph.daysSince}d ago)` : 'no email deliverable ingested yet'
  const rejLine = ph.authRejections7d > 0 ? ` · ⚠️ ${ph.authRejections7d} rejected forward(s) this week — the forwarder's WEBHOOK_SECRET is stale, re-sync it` : ''
  sections.push(`${ph.healthy ? '🟢' : '🔴'} *Email pipeline* — ${ingestLine}${rejLine}`)

  if (r.agingReview.total) {
    const lines = r.agingReview.items.map((i) => `• *${esc(i.file)}* — ${i.ageDays}d in queue${i.guess ? `, guess ${esc(i.guess)}` : ''}${i.forwardedBy ? `, from ${esc(i.forwardedBy)}` : ''}`)
    sections.push(`🕓 *Aging in review (${r.agingReview.total})*\n${lines.join('\n')}${overflow(r.agingReview.items.length, r.agingReview.total)}`)
  }
  if (r.autoFileSpotCheck.total) {
    const lines = r.autoFileSpotCheck.items.map((i) => `• *${esc(i.file)}* → ${esc(i.project) || '(no project)'} _(${esc(i.method)}, ${i.confidence ?? '—'})_`)
    sections.push(`🔎 *Auto-files to spot-check (${r.autoFileSpotCheck.total})*\n${lines.join('\n')}${overflow(r.autoFileSpotCheck.items.length, r.autoFileSpotCheck.total)}`)
  }
  if (r.duplicates.total) {
    const lines = r.duplicates.items.map((i) => `• *${esc(i.file)}* ×${i.count}`)
    sections.push(`♻️ *Possible duplicates (${r.duplicates.total})*\n${lines.join('\n')}${overflow(r.duplicates.items.length, r.duplicates.total)}`)
  }
  if (r.unsorted.total) {
    const lines = r.unsorted.items.map((i) => `• *${esc(i.file)}*`)
    sections.push(`📥 *Unsorted, no project (${r.unsorted.total})*\n${lines.join('\n')}${overflow(r.unsorted.items.length, r.unsorted.total)}`)
  }
  if (r.coverageGap.total) {
    sections.push(
      `📭 *Recently delivered, nothing filed (${r.coverageGap.total})* — adoption gap; forward these to deliverables@\n` +
        `${r.coverageGap.examples.map((e) => `• ${esc(e)}`).join('\n')}${overflow(r.coverageGap.examples.length, r.coverageGap.total)}`,
    )
  }
  if (r.tally.filed) {
    sections.push(`📈 *Filed this week: ${r.tally.filed}* — ${r.tally.bySourceMethod.map((x) => `${esc(x.key)}: ${x.count}`).join(' · ')}`)
  }

  if (r.clean) sections.push('✅ Depository is clean — nothing aging, no dupes, no gaps.')
  sections.push(`<${APP_URL}/deliverables|Open the review queue>`)
  return sections.join('\n\n')
}
