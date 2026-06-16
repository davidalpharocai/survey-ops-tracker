// lib/deliverables/types.ts
export type ClientRec = { id: string; name: string; code: string | null }
export type ProjectRec = { id: string; client_id: string | null; project_code: string; project_name: string }
export type ContactRec = { email: string; client_id: string | null; project_id: string | null }

export type Candidate = { clientId: string | null; projectId: string | null; confidence: number; reason: string; method: MatchMethod }

export type MatchInput = {
  subject: string
  body: string
  fromEmail: string
  clients: ClientRec[]
  projects: ProjectRec[]            // non-deleted only
  contacts: ContactRec[]            // project_recipients + known client contacts
  domainMap: Record<string, string> // emailDomain -> clientId
}

export type MatchMethod = 'code' | 'contact_email' | 'domain' | 'name' | 'none'
export type MatchResult = {
  clientId: string | null
  projectId: string | null
  confidence: number
  method: MatchMethod
  candidates: Candidate[]
}
