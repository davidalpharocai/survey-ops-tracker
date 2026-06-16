// lib/deliverables/matcher.ts
import type { Candidate, MatchInput, MatchMethod, MatchResult } from './types'

const CODE_RE = /\b(PR\d{5}|Cl\d{5})\b/i
const SHARED_DOMAINS = new Set(['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'aol.com', 'me.com'])

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function domainOf(email: string): string {
  return (email.split('@')[1] ?? '').toLowerCase().trim()
}

export function matchDeliverable(input: MatchInput): MatchResult {
  const hay = `${input.subject}\n${input.body}`
  const nhay = ` ${normalizeName(hay)} `
  const candidates: Candidate[] = []

  // Tier 1 — explicit code
  const code = hay.match(CODE_RE)?.[1]?.toUpperCase()
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
  if (dom && !SHARED_DOMAINS.has(dom) && input.domainMap[dom]) {
    candidates.push({ clientId: input.domainMap[dom], projectId: null, confidence: 0.8, reason: `domain:${dom}`, method: 'domain' })
  }

  // Tier 4 — name / project-name text
  for (const p of input.projects) {
    const pn = normalizeName(p.project_name)
    if (pn.length >= 4 && nhay.includes(` ${pn} `)) {
      candidates.push({ clientId: p.client_id, projectId: p.id, confidence: 0.75, reason: `pname:${p.project_code}`, method: 'name' })
    }
  }
  for (const c of input.clients) {
    const cn = normalizeName(c.name)
    if (cn.length >= 3 && nhay.includes(` ${cn} `)) {
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
