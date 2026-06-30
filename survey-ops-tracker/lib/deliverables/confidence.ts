// lib/deliverables/confidence.ts
import type { Candidate, MatchResult, ClientRec, ProjectRec } from './types'

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

type NameData = { clients: ClientRec[]; projects: ProjectRec[] }

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
