// lib/email-activity/filters.ts
// Generates an importable Gmail filter set (Gmail → Settings → Filters and
// Blocked Addresses → Import filters) that FORWARDS any mail from a known client
// contact/domain to the activity@ Group. It deliberately does NOT archive/skip
// the inbox — the captain keeps their own copy; only a forwarded duplicate goes
// to activity@. Every captain imports the same set.
//
// Re-import after regeneration: Gmail import does NOT de-dupe, so delete the old
// "Survey Ops activity capture" filters before importing a fresh set.

const DEFAULT_FORWARD_TO = 'activity@alpharoc.ai'
// Gmail caps a single filter's search-criterion length; keep each `from:(…)`
// group well under it and split across multiple filter entries.
const MAX_CRITERION_LEN = 1200

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;')
}

function filterEntry(fromValue: string, forwardTo: string): string {
  return (
    `  <entry>\n` +
    `    <category term='filter'></category>\n` +
    `    <title>Survey Ops activity capture</title>\n` +
    `    <content></content>\n` +
    `    <apps:property name='from' value='${xmlEscape(fromValue)}'/>\n` +
    `    <apps:property name='forwardTo' value='${xmlEscape(forwardTo)}'/>\n` +
    `  </entry>\n`
  )
}

/** De-dupe + lowercase + sort senders, then pack them into `a OR b OR …` groups
 *  each within the criterion length cap. */
export function chunkSenders(senders: string[], maxLen: number = MAX_CRITERION_LEN): string[] {
  const clean = [...new Set(senders.map((s) => s.trim().toLowerCase()).filter(Boolean))].sort()
  const chunks: string[] = []
  let cur: string[] = []
  for (const s of clean) {
    const projected = cur.length ? `${cur.join(' OR ')} OR ${s}` : s
    if (cur.length && projected.length > maxLen) {
      chunks.push(cur.join(' OR '))
      cur = [s]
    } else {
      cur.push(s)
    }
  }
  if (cur.length) chunks.push(cur.join(' OR '))
  return chunks
}

export function generateFilterXml(senders: string[], forwardTo: string = DEFAULT_FORWARD_TO): string {
  const entries = chunkSenders(senders)
    .map((c) => filterEntry(c, forwardTo))
    .join('')
  return (
    `<?xml version='1.0' encoding='UTF-8'?>\n` +
    `<feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'>\n` +
    `  <title>Survey Ops — Activity capture filters</title>\n` +
    entries +
    `</feed>\n`
  )
}
