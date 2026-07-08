// lib/email-activity/match.ts
// Direction-aware, precision-first matcher for the email→activity pipeline.
//
// Decision model (see spec 2026-07-07-email-to-activity-design.md,
// "Review resolutions"):
//   1. Explicit PR-code           → auto-log to that project in ANY state.
//   2. Validated survey-ID (1 owner) → auto-log to that project in ANY state.
//   Both explicit tiers IGNORE the watch window. `isActiveOperational` is never
//   used to pre-filter the loaded project set — it only gates the fuzzy tiers.
//   3. Fuzzy client tiers (contact / domain / name): resolve a client, then the
//   single in-window (Watching or Sweep) project. These AUTO-LOG only when
//   `opts.fuzzyAutoLog` is true (Phase 2); in Phase 1 (default false) they route
//   to review. A shared-domain-only contact is always downgraded to review.
//
// The window is a fixed 48h absolute duration off `delivered_at`, so it is
// timezone-invariant; `opts.now` is injectable for deterministic tests.

import { isActiveOperational } from '@/lib/mcp/data'
import { normalizeName } from '@/lib/deliverables/matcher'
import { SHARED_DOMAINS } from '@/lib/deliverables/shared-domains'
import type { EmailContactRec, EmailMatchData, EmailProjectRec } from './load'

export type EmailDecision = 'auto-log' | 'review' | 'pending_no_project'
export type EmailDirection = 'inbound' | 'outbound'
export type EmailMatchMethod = 'code' | 'survey_id' | 'contact_email' | 'domain' | 'name' | 'none'

export type EmailCandidate = {
  clientId: string | null
  projectId: string | null
  confidence: number
  reason: string
  method: EmailMatchMethod
}

export type EmailMatchInput = {
  fromEmail: string | null
  toEmails: string[]
  subject: string
  body: string
}

export type EmailMatchOpts = {
  /** Injected "now" for deterministic watch-window tests. Defaults to new Date(). */
  now?: Date
  /** Phase 2 flag: when true, fuzzy tiers auto-log a single in-window project. Default false. */
  fuzzyAutoLog?: boolean
  /** Domains treated as internal (outbound senders). Default alpharoc.ai / alpharoc.com. */
  internalDomains?: string[]
}

export type EmailMatchResult = {
  decision: EmailDecision
  projectId: string | null
  clientId: string | null
  confidence: number
  direction: EmailDirection
  method: EmailMatchMethod
  candidates: EmailCandidate[]
}

const CODE_RE = /\bPR\d{5}\b/gi
const SWEEP_MS = 2 * 24 * 60 * 60 * 1000
const DEFAULT_INTERNAL = ['alpharoc.ai', 'alpharoc.com']

const CONFIDENCE: Record<EmailMatchMethod, number> = {
  code: 0.99,
  survey_id: 0.98,
  contact_email: 0.9,
  domain: 0.8,
  name: 0.7,
  none: 0,
}

const domainOf = (email: string): string => (email.split('@')[1] ?? '').toLowerCase().trim()

function isInternal(email: string, internalDomains: string[]): boolean {
  const d = domainOf(email)
  return internalDomains.some((dom) => d === dom || d.endsWith(`.${dom}`))
}

const uniq = (xs: string[]): string[] => [...new Set(xs)]

/** Watching (active-operational) OR within the post-delivery Sweep window. */
function inWatchWindow(p: EmailProjectRec, now: Date): boolean {
  if (isActiveOperational(p)) return true
  if (p.board_column === 'Delivery' && p.delivered_at) {
    return now.getTime() <= Date.parse(p.delivered_at) + SWEEP_MS
  }
  return false // Closed/Hold, or Delivered with NULL/expired delivered_at → past-sweep
}

/**
 * Rerun disambiguation: given 2+ in-window candidates that form ONE rerun family,
 * pick the single newest non-Delivered wave. Returns null if they aren't a single
 * family or the newest wave isn't unique (→ caller routes to review).
 */
function pickRerunWave(candidates: EmailProjectRec[]): EmailProjectRec | null {
  if (candidates.length === 0) return null
  const series = candidates[0].rerun_series_id
  if (!series || !candidates.every((p) => p.rerun_series_id === series)) return null
  const nonDelivered = candidates.filter((p) => p.board_column !== 'Delivery')
  if (nonDelivered.length === 0) return null
  nonDelivered.sort((a, b) => b.rerun_number - a.rerun_number)
  if (nonDelivered.length >= 2 && nonDelivered[0].rerun_number === nonDelivered[1].rerun_number) return null
  return nonDelivered[0]
}

/** Distinct client ids of contacts stored at exactly this (non-shared) domain. */
function clientsAtDomain(contacts: EmailContactRec[], dom: string): string[] {
  const set = new Set<string>()
  for (const c of contacts) {
    if (c.client_id && domainOf(c.email) === dom) set.add(c.client_id)
  }
  return [...set]
}

function build(
  decision: EmailDecision,
  projectId: string | null,
  clientId: string | null,
  confidence: number,
  direction: EmailDirection,
  method: EmailMatchMethod,
  candidates: EmailCandidate[]
): EmailMatchResult {
  return { decision, projectId, clientId, confidence, direction, method, candidates }
}

export function matchEmail(
  input: EmailMatchInput,
  data: EmailMatchData,
  opts: EmailMatchOpts = {}
): EmailMatchResult {
  const now = opts.now ?? new Date()
  const fuzzyAutoLog = opts.fuzzyAutoLog ?? false
  const internalDomains = opts.internalDomains ?? DEFAULT_INTERNAL

  const from = (input.fromEmail ?? '').toLowerCase().trim()
  const toEmails = input.toEmails.map((e) => e.toLowerCase().trim()).filter(Boolean)

  // Direction: an @alpharoc sender is our own outbound mail (resolve client from
  // the external recipients); anything else is inbound (resolve from the sender).
  const direction: EmailDirection = from && isInternal(from, internalDomains) ? 'outbound' : 'inbound'
  const partyEmails =
    direction === 'inbound'
      ? from
        ? [from]
        : []
      : toEmails.filter((e) => !isInternal(e, internalDomains))

  const hay = `${input.subject ?? ''}\n${input.body ?? ''}`
  const projById = new Map(data.projects.map((p) => [p.id, p]))

  // ---- Tier 1: explicit PR-code (any state, ignores window) ----
  const codes = uniq((hay.match(CODE_RE) ?? []).map((m) => m.toUpperCase()))
  for (const code of codes) {
    const p = data.projects.find((pr) => (pr.project_code ?? '').toUpperCase() === code)
    if (p) {
      const cand: EmailCandidate = { clientId: p.client_id, projectId: p.id, confidence: CONFIDENCE.code, reason: `code:${code}`, method: 'code' }
      return build('auto-log', p.id, p.client_id, CONFIDENCE.code, direction, 'code', [cand])
    }
  }
  const codeUnresolved = codes.length > 0 // a PR-code was present but no project matched it

  // ---- Tier 2: validated survey-ID (exact membership, any state) ----
  const tokens = new Set(hay.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean))
  const ownerIds = new Set<string>()
  let surveyToken = ''
  for (const token of tokens) {
    const owners = data.surveyIdMap.get(token)
    if (owners) {
      owners.forEach((id) => ownerIds.add(id))
      if (!surveyToken) surveyToken = token
    }
  }
  if (ownerIds.size === 1) {
    const id = [...ownerIds][0]
    const clientId = projById.get(id)?.client_id ?? null
    const cand: EmailCandidate = { clientId, projectId: id, confidence: CONFIDENCE.survey_id, reason: `survey:${surveyToken}`, method: 'survey_id' }
    return build('auto-log', id, clientId, CONFIDENCE.survey_id, direction, 'survey_id', [cand])
  }
  if (ownerIds.size > 1) {
    const cands: EmailCandidate[] = [...ownerIds].map((id) => ({
      clientId: projById.get(id)?.client_id ?? null,
      projectId: id,
      confidence: CONFIDENCE.survey_id,
      reason: 'survey_id:ambiguous',
      method: 'survey_id',
    }))
    return build('review', null, null, CONFIDENCE.survey_id, direction, 'survey_id', cands)
  }

  // ---- Fuzzy client resolution (contact → domain → name) ----
  let method: EmailMatchMethod = 'none'
  let clientIds: string[] = []

  // Contact tier: exact email membership.
  const contactHits = partyEmails.flatMap((e) => data.contacts.filter((c) => c.email === e && c.client_id))
  if (contactHits.length) {
    method = 'contact_email'
    clientIds = uniq(contactHits.map((c) => c.client_id as string))
  }

  // A contact resolved only via shared-domain address (e.g. gmail.com) is not a
  // trustworthy client tie on its own — force review even under fuzzyAutoLog.
  const sharedContactOnly = method === 'contact_email' && contactHits.every((c) => SHARED_DOMAINS.has(domainOf(c.email)))

  // Domain tier: only when no contact resolved a client.
  if (clientIds.length === 0) {
    for (const e of partyEmails) {
      const dom = domainOf(e)
      if (!dom || SHARED_DOMAINS.has(dom)) continue
      const clients = clientsAtDomain(data.contacts, dom)
      if (clients.length === 1) {
        method = 'domain'
        clientIds.push(clients[0])
      }
    }
    clientIds = uniq(clientIds)
  }

  // Name tier: project-name text → specific project(s) (+ their clients).
  let nameProjects: EmailProjectRec[] = []
  if (clientIds.length === 0) {
    const nhay = ` ${normalizeName(hay)} `
    nameProjects = data.projects.filter((p) => {
      const pn = normalizeName(p.project_name)
      return pn.length >= 4 && nhay.includes(` ${pn} `)
    })
    if (nameProjects.length) {
      method = 'name'
      clientIds = uniq(nameProjects.map((p) => p.client_id).filter((x): x is string => !!x))
    }
  }

  const fuzzyConf = CONFIDENCE[method]

  // No client at all: pending (explicit code present but project missing) or review.
  if (clientIds.length === 0) {
    if (codeUnresolved) return build('pending_no_project', null, null, 0, direction, 'code', [])
    return build('review', null, null, 0, direction, 'none', [])
  }

  // More than one client resolved → review with a candidate per client.
  if (clientIds.length > 1) {
    const cands: EmailCandidate[] = clientIds.map((cid) => ({ clientId: cid, projectId: null, confidence: fuzzyConf, reason: `${method}:multi-client`, method }))
    return build('review', null, null, fuzzyConf, direction, method, cands)
  }

  // Single client resolved: find the in-window target project(s).
  const clientId = clientIds[0]
  const inWindow = data.projects.filter((p) => p.client_id === clientId && inWatchWindow(p, now))

  // A name-tier match pins specific projects — constrain to those (in-window).
  let targets = inWindow
  if (method === 'name' && nameProjects.length) {
    const nameIds = new Set(nameProjects.map((p) => p.id))
    targets = inWindow.filter((p) => nameIds.has(p.id))
  }

  const candsFor = (ps: EmailProjectRec[]): EmailCandidate[] =>
    ps.map((p) => ({ clientId, projectId: p.id, confidence: fuzzyConf, reason: method, method }))

  // Resolve to a single target (rerun disambiguation for 2+).
  let target: EmailProjectRec | null = null
  if (targets.length === 1) target = targets[0]
  else if (targets.length > 1) target = pickRerunWave(targets)

  if (!target) {
    // 0 in-window, or 2+ ambiguous (non-rerun) → review; surface the best candidate set.
    const source = targets.length ? targets : inWindow.length ? inWindow : data.projects.filter((p) => p.client_id === clientId)
    return build('review', null, clientId, fuzzyConf, direction, method, candsFor(source))
  }

  const cand: EmailCandidate = { clientId, projectId: target.id, confidence: fuzzyConf, reason: method, method }
  const canAutoLog = fuzzyAutoLog && !sharedContactOnly
  if (canAutoLog) return build('auto-log', target.id, clientId, fuzzyConf, direction, method, [cand])
  return build('review', null, clientId, fuzzyConf, direction, method, [cand])
}
