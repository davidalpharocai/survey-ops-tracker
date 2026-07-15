// lib/deliverables/ai-matcher.ts
import Anthropic from '@anthropic-ai/sdk'
import { normalizeName } from './matcher'

export const AI_AUTO_FILE_THRESHOLD = 0.9

export type AiCandidate = { projectCode: string; projectName: string; clientName: string }
export type FilingHistoryRec = { clientId: string | null; projectCode: string; projectName: string; clientName: string }

export type AiMatchInput = {
  from: string
  subject: string
  filename: string // attachment filename(s), space-joined
  bodySnippet: string // first ~1500 chars; caller trims the quoted thread
  candidates: AiCandidate[]
  history: FilingHistoryRec[]
}

export type CorroSignal = 'filename' | 'subject' | 'sender_domain' | 'history' | null
export type AiMatchResult = {
  projectCode: string | null
  confidence: number
  reasoning: string
  corroboratingSignal: CorroSignal
}

export const AI_MATCHER_SYSTEM = `You file survey deliverables (attachments an internal analyst forwarded) to the correct survey project.
You are given the email (sender, subject, attachment filename, a body snippet), the list of candidate survey projects (code, name, client), and recent past filings per client.
Pick the ONE survey project the deliverable belongs to, using every signal — the attachment filename and subject are the strongest (they usually name the client and study); the body may contain a forwarded thread.
Rules:
- Choose projectCode ONLY from the provided candidate list. If none clearly fits, return projectCode=null.
- confidence 0..1 reflects how sure you are. Reserve >=0.9 for cases a human would call obvious.
- corroboratingSignal names the single strongest hard signal for your pick (filename, subject, sender_domain, or history), or null.
- Never guess to be helpful. "Unsure" (null) is the correct answer when the signals are weak or conflicting.`

export const PICK_SURVEY_TOOL = {
  name: 'pick_survey',
  description: 'Record which survey project the deliverable belongs to (or that it is unclear).',
  input_schema: {
    type: 'object' as const,
    properties: {
      projectCode: { type: ['string', 'null'], description: 'Chosen survey code from the candidate list, or null if unclear' },
      confidence: { type: 'number', description: '0..1 confidence' },
      reasoning: { type: 'string', description: 'One sentence justification' },
      corroboratingSignal: { type: ['string', 'null'], enum: ['filename', 'subject', 'sender_domain', 'history', null] },
    },
    required: ['projectCode', 'confidence', 'reasoning', 'corroboratingSignal'],
  },
} satisfies Anthropic.Tool

const EMPTY: AiMatchResult = { projectCode: null, confidence: 0, reasoning: 'ai unavailable', corroboratingSignal: null }

function renderUser(input: AiMatchInput): string {
  const cands = input.candidates.map((c) => `- ${c.projectCode}: ${c.projectName} [client: ${c.clientName}]`).join('\n')
  const hist = input.history.length
    ? input.history.map((h) => `- ${h.clientName} -> ${h.projectCode} ${h.projectName}`).join('\n')
    : '(none)'
  return [
    `From: ${input.from}`,
    `Subject: ${input.subject}`,
    `Attachment filename(s): ${input.filename}`,
    `Body snippet: ${input.bodySnippet}`,
    ``,
    `Candidate surveys:\n${cands}`,
    ``,
    `Recent filings by client (learn the pattern):\n${hist}`,
  ].join('\n')
}

/** One forced-tool Claude call. Never throws — returns a null result on any failure. */
export async function aiMatch(input: AiMatchInput, client: Anthropic = new Anthropic()): Promise<AiMatchResult> {
  if (input.candidates.length === 0) return { ...EMPTY, reasoning: 'no candidates' }
  const model = process.env.DELIVERABLES_MATCH_MODEL ?? 'claude-haiku-4-5'
  try {
    const stream = client.messages.stream({
      model,
      max_tokens: 1024,
      system: AI_MATCHER_SYSTEM,
      tools: [PICK_SURVEY_TOOL],
      tool_choice: { type: 'tool', name: PICK_SURVEY_TOOL.name },
      messages: [{ role: 'user', content: renderUser(input) }],
    })
    const res = await stream.finalMessage()
    const tool = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (!tool) return { ...EMPTY, reasoning: 'no tool_use' }
    const raw = tool.input as Partial<AiMatchResult>
    const code = typeof raw.projectCode === 'string' ? raw.projectCode : null
    // Validate against the real candidate list — reject hallucinated codes.
    const valid = code && input.candidates.some((c) => c.projectCode === code) ? code : null
    return {
      projectCode: valid,
      confidence: valid ? Math.max(0, Math.min(1, Number(raw.confidence) || 0)) : 0,
      reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : '',
      corroboratingSignal: (['filename', 'subject', 'sender_domain', 'history'] as const).includes(raw.corroboratingSignal as never)
        ? (raw.corroboratingSignal as CorroSignal)
        : null,
    }
  } catch (e) {
    return { ...EMPTY, reasoning: `ai error: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/**
 * Independent server-side re-verification of the AI's pick. True only if a hard signal really supports it:
 * the client name or a distinctive project-name token is present in filename/subject, OR the sender domain
 * maps to the client, OR the client has a prior filing. The AI's own `corroboratingSignal` is NOT trusted.
 */
export function serverCorroborates(args: {
  clientName: string
  projectName: string
  haystack: string // subject + ' ' + filename
  senderDomainMatchesClient: boolean
  clientHasHistory: boolean
}): boolean {
  const hay = ` ${normalizeName(args.haystack)} `
  const cn = normalizeName(args.clientName)
  if (cn.length >= 3 && hay.includes(` ${cn} `)) return true
  const tokens = normalizeName(args.projectName).split(' ').filter((t) => t.length >= 4)
  if (tokens.some((t) => hay.includes(` ${t} `))) return true
  if (args.senderDomainMatchesClient) return true
  if (args.clientHasHistory) return true
  return false
}
