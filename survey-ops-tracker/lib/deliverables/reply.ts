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
  const allDuplicate = summary.items.length > 0 && summary.items.every((i) => i.status === 'duplicate')
  const prefix = needsReview ? 'Needs a quick review' : allDuplicate ? 'Already filed' : 'Filed ✓'
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
