// lib/deliverables/matcher.ts
import type { Candidate, MatchInput, MatchResult } from './types'
import { SHARED_DOMAINS } from './shared-domains'
import { ALPHAROC_DOMAIN } from './email'

const CODE_RE = /\b(PR\d{5}|Cl\d{5})\b/i

// Our own org, derived from the internal mail domain (e.g. "alpharoc"). A deliverable is always FOR a
// client, never for us, so the fuzzy name tier must never resolve to our own company — otherwise it
// matches the forwarder's own signature/domain on essentially every internal forward.
const SELF_ORG = ALPHAROC_DOMAIN.split('.')[0]

// Generic survey/report jargon: too common to identify a project on its own, so these are excluded
// when falling back to single-token project-name matching (which needs a distinctive word).
const NAME_STOPWORDS = new Set([
  // report / survey jargon
  'survey', 'tracker', 'poll', 'study', 'consumer', 'wave', 'final', 'topline', 'report', 'data',
  'results', 'deck', 'analysis', 'project', 'phase', 'round', 'update', 'draft', 'deliverable',
  'graph', 'graphs', 'chart', 'charts', 'tagline', 'mock', 'test', 'campaign',
  // email / forwarding filler
  'follow', 'available', 'attached', 'please', 'thanks', 'regards', 'hello', 'team', 'here', 'fwd',
  // file extensions
  'xlsx', 'docx', 'pptx', 'pdf', 'csv', 'zip', 'png', 'jpg', 'jpeg',
])

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Distinctive words of a name: long enough, not generic jargon, not a bare number/year/quarter. */
function distinctiveTokens(name: string): string[] {
  return normalizeName(name)
    .split(' ')
    .filter((t) => t.length >= 4 && !NAME_STOPWORDS.has(t) && !/^\d+$/.test(t))
}

function domainOf(email: string): string {
  return (email.split('@')[1] ?? '').toLowerCase().trim()
}

export function matchDeliverable(input: MatchInput): MatchResult {
  const names = input.filenames ?? []
  // Deliberate signals — subject + attachment file names. Low-noise, so fuzzy token / client-name
  // matching reads only these; a long forwarded body would otherwise swamp them with false hits.
  const focused = ` ${normalizeName([input.subject, ...names].join(' '))} `
  // Everything, incl. the email body — for explicit codes and full project-name phrase hits, which are
  // specific enough to tolerate a quoted thread.
  const full = ` ${normalizeName([input.subject, input.body, ...names].join(' '))} `
  const codeText = [input.subject, input.body, ...names].join('\n')
  const candidates: Candidate[] = []

  // Tier 1 — explicit code (anywhere: subject, body, or file name)
  const code = codeText.match(CODE_RE)?.[1]?.toUpperCase()
  if (code?.startsWith('PR')) {
    const p = input.projects.find((p) => p.project_code.toUpperCase() === code)
    if (p) candidates.push({ clientId: p.client_id, projectId: p.id, confidence: 0.99, reason: `code:${code}`, method: 'code' })
  } else if (code?.startsWith('CL')) {
    const c = input.clients.find((c) => (c.code ?? '').toUpperCase() === code)
    if (c) candidates.push({ clientId: c.id, projectId: null, confidence: 0.95, reason: `code:${code}`, method: 'code' })
  }

  // Tier 2 — known contact email
  const from = input.fromEmail.toLowerCase().trim()
  const contact = input.contacts.find((c) => c.email.toLowerCase().trim() === from)
  if (contact?.client_id) candidates.push({ clientId: contact.client_id, projectId: contact.project_id, confidence: 0.9, reason: 'contact', method: 'contact_email' })

  // Tier 3 — sender domain (skip shared)
  const dom = domainOf(from)
  if (dom && dom !== ALPHAROC_DOMAIN && !SHARED_DOMAINS.has(dom) && input.domainMap[dom]) {
    candidates.push({ clientId: input.domainMap[dom], projectId: null, confidence: 0.8, reason: `domain:${dom}`, method: 'domain' })
  }

  // Tier 4 — name / project-name text (see focused vs full above)
  for (const p of input.projects) {
    const pn = normalizeName(p.project_name)
    if (pn.length >= 4 && full.includes(` ${pn} `)) {
      // Full project name present verbatim — strongest name signal.
      candidates.push({ clientId: p.client_id, projectId: p.id, confidence: 0.75, reason: `pname:${p.project_code}`, method: 'name' })
      continue
    }
    // Fallback: distinctive words of the project name (e.g. "Korea" from "Korea Consumer Survey", or the
    // client/study named right in the attachment filename), so a forward that drops the boilerplate still
    // guesses the right project. Read from the focused signals only, and kept below AUTO_FILE_THRESHOLD —
    // a fuzzy token match improves the review-queue guess, it never auto-files.
    const hits = distinctiveTokens(p.project_name).filter((t) => focused.includes(` ${t} `))
    if (hits.length) {
      candidates.push({
        clientId: p.client_id, projectId: p.id,
        confidence: hits.length >= 2 ? 0.7 : 0.62,
        reason: `ptoken:${p.project_code}:${hits.join('+')}`, method: 'name',
      })
    }
  }
  for (const c of input.clients) {
    const cn = normalizeName(c.name)
    // Never resolve to our own company from fuzzy text (a forwarder's signature/domain) — see SELF_ORG.
    if (cn.split(' ').includes(SELF_ORG)) continue
    if (cn.length >= 3 && focused.includes(` ${cn} `)) {
      candidates.push({ clientId: c.id, projectId: null, confidence: 0.6, reason: 'cname', method: 'name' })
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence)
  const best = candidates[0]
  if (!best) return { clientId: null, projectId: null, confidence: 0, method: 'none', candidates: [] }

  // Resolve a project within the chosen client if we don't have one yet.
  let projectId = best.projectId
  if (best.clientId && !projectId) {
    const withProj = candidates.find((c) => c.clientId === best.clientId && c.projectId)
    if (withProj) projectId = withProj.projectId
    else {
      const clientProjects = input.projects.filter((p) => p.client_id === best.clientId)
      if (clientProjects.length === 1) projectId = clientProjects[0].id
    }
  }

  return { clientId: best.clientId, projectId, confidence: best.confidence, method: best.method, candidates: candidates.slice(0, 3) }
}
