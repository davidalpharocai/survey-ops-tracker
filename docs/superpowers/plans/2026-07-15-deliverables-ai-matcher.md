# Deliverables AI Matcher Tier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI fallback tier to the deliverables matcher that, for sub-threshold emails, picks the right survey from the tracker's memory and auto-files it only when the pick is confident AND independently corroborated — otherwise stages it in review with the AI's pick pre-filled.

**Architecture:** A new pure module `lib/deliverables/ai-matcher.ts` makes one forced-tool Claude call (mirroring `lib/parsing/claude-parser.ts`). `email-ingest.ts` calls it as a fallback when `routeMatch` is not confident, then a server-side `serverCorroborates` check decides auto-file vs review. A loader adds filing history. The ingest route wires the real Anthropic client + history. No migration.

**Tech Stack:** Next.js 15, `@anthropic-ai/sdk`, Supabase via PostgREST, Vitest, `FakeDrive`.

**Spec:** `docs/superpowers/specs/2026-07-15-deliverables-ai-matcher-design.md`

---

## File Structure

- **Create** `lib/deliverables/ai-matcher.ts` — the AI call (`aiMatch`), the `pick_survey` tool, system prompt, `AI_AUTO_FILE_THRESHOLD`, and the pure `serverCorroborates` helper.
- **Create** `lib/deliverables/ai-matcher.test.ts` — unit tests (fake Anthropic client).
- **Modify** `lib/deliverables/types.ts` — add `'ai'` to `MatchMethod`.
- **Modify** `lib/deliverables/load.ts` — add `loadFilingHistory`.
- **Modify** `lib/deliverables/email-ingest.ts` — AI fallback tier + corroboration gate; new injected deps `aiMatch`, `filingHistory`.
- **Modify** `lib/deliverables/email-ingest.test.ts` — AI-tier scenarios.
- **Modify** `app/api/deliverables/ingest/route.ts` — wire the Anthropic client + `loadFilingHistory`.

---

### Task 1: `ai-matcher.ts` — the AI call + corroboration helper

**Files:**
- Create: `lib/deliverables/ai-matcher.ts`
- Test: `lib/deliverables/ai-matcher.test.ts`
- Modify: `lib/deliverables/types.ts`

- [ ] **Step 1: Add `'ai'` to `MatchMethod` in `types.ts`.**

```ts
export type MatchMethod = 'code' | 'contact_email' | 'domain' | 'name' | 'ai' | 'none'
```

- [ ] **Step 2: Write `lib/deliverables/ai-matcher.ts`.**

```ts
// lib/deliverables/ai-matcher.ts
import Anthropic from '@anthropic-ai/sdk'
import { normalizeName } from './matcher'

export const AI_AUTO_FILE_THRESHOLD = 0.9

export type AiCandidate = { projectCode: string; projectName: string; clientName: string }
export type FilingHistoryRec = { clientId: string | null; projectCode: string; projectName: string; clientName: string }

export type AiMatchInput = {
  from: string
  subject: string
  filename: string      // attachment filename(s), space-joined
  bodySnippet: string   // first ~1500 chars, quoted thread trimmed by caller
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
        ? (raw.corroboratingSignal as CorroSignal) : null,
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
  haystack: string          // subject + ' ' + filename
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
```

- [ ] **Step 3: Write `ai-matcher.test.ts`** (fake client per `claude-parser.test.ts`).

```ts
import { describe, it, expect, vi } from 'vitest'
import { aiMatch, serverCorroborates, type AiMatchInput } from './ai-matcher'

function fakeClient(toolInput: unknown) {
  return { messages: { stream: vi.fn().mockReturnValue({
    finalMessage: vi.fn().mockResolvedValue({ content: [{ type: 'tool_use', name: 'pick_survey', input: toolInput }], stop_reason: 'end_turn' }),
  }) } }
}
function throwingClient() {
  return { messages: { stream: vi.fn(() => { throw new Error('boom') }) } }
}
const base: AiMatchInput = {
  from: 'analyst@alpharoc.ai', subject: 'Fwd: Korea Survey', filename: 'Wellington - Harvey Study.xlsx',
  bodySnippet: 'see attached', candidates: [{ projectCode: 'PR00226', projectName: 'Harvey Study', clientName: 'Wellington' }], history: [],
}

describe('aiMatch', () => {
  it('returns a validated pick', async () => {
    const r = await aiMatch(base, fakeClient({ projectCode: 'PR00226', confidence: 0.95, reasoning: 'filename', corroboratingSignal: 'filename' }) as any)
    expect(r.projectCode).toBe('PR00226'); expect(r.confidence).toBeCloseTo(0.95)
  })
  it('coerces a hallucinated code to null (unsure)', async () => {
    const r = await aiMatch(base, fakeClient({ projectCode: 'PR99999', confidence: 0.9, reasoning: 'x', corroboratingSignal: null }) as any)
    expect(r.projectCode).toBeNull(); expect(r.confidence).toBe(0)
  })
  it('handles genuine unsure (null)', async () => {
    const r = await aiMatch(base, fakeClient({ projectCode: null, confidence: 0, reasoning: 'weak', corroboratingSignal: null }) as any)
    expect(r.projectCode).toBeNull()
  })
  it('never throws — returns a null result on client error', async () => {
    const r = await aiMatch(base, throwingClient() as any)
    expect(r.projectCode).toBeNull(); expect(r.reasoning).toMatch(/ai error/)
  })
  it('skips the call when there are no candidates', async () => {
    const c = fakeClient({}); await aiMatch({ ...base, candidates: [] }, c as any)
    expect(c.messages.stream).not.toHaveBeenCalled()
  })
})

describe('serverCorroborates', () => {
  const d = { clientName: 'Wellington', projectName: 'Harvey Study', senderDomainMatchesClient: false, clientHasHistory: false }
  it('true when the client name is in the haystack', () => expect(serverCorroborates({ ...d, haystack: 'Wellington - Harvey Study.xlsx' })).toBe(true))
  it('true on a distinctive project token', () => expect(serverCorroborates({ ...d, haystack: 'harvey deck.pdf' })).toBe(true))
  it('true when sender domain maps to the client', () => expect(serverCorroborates({ ...d, haystack: 'x.pdf', senderDomainMatchesClient: true })).toBe(true))
  it('true when the client has prior filings', () => expect(serverCorroborates({ ...d, haystack: 'x.pdf', clientHasHistory: true })).toBe(true))
  it('false when nothing supports the pick', () => expect(serverCorroborates({ ...d, haystack: 'q3 report.pdf' })).toBe(false))
})
```

- [ ] **Step 4: Run** `npx vitest run lib/deliverables/ai-matcher.test.ts` → all pass. **Commit.**

---

### Task 2: `loadFilingHistory` in `load.ts`

**Files:** Modify `lib/deliverables/load.ts`; Test `lib/deliverables/load.test.ts` (create if absent — use the PostgREST fetch stub pattern from `persist.test.ts`).

- [ ] **Step 1:** Add to `load.ts`:

```ts
import type { FilingHistoryRec } from './ai-matcher'

/** Recent filed deliverables mapped to their survey + client — the AI tier's "memory". */
export async function loadFilingHistory(
  admin: ReturnType<typeof createAdminClient>,
  clients: ClientRec[],
  projects: ProjectRec[],
  limit = 200,
): Promise<FilingHistoryRec[]> {
  const { data } = await admin.from('deliverables')
    .select('project_id').eq('status', 'filed').is('deleted_at', null)
    .not('project_id', 'is', null).order('filed_at', { ascending: false }).limit(limit)
  const projById = new Map(projects.map((p) => [p.id, p]))
  const clientName = new Map(clients.map((c) => [c.id, c.name]))
  const out: FilingHistoryRec[] = []
  const seen = new Set<string>()
  for (const row of data ?? []) {
    const p = projById.get(row.project_id as string)
    if (!p || seen.has(p.id)) continue
    seen.add(p.id)
    out.push({ clientId: p.client_id, projectCode: p.project_code, projectName: p.project_name, clientName: clientName.get(p.client_id ?? '') ?? 'Unknown' })
  }
  return out
}
```

- [ ] **Step 2:** Test that it dedupes by project and joins client names (stub `admin.from(...).select....limit()` to resolve `{data:[{project_id:'p1'},{project_id:'p1'},{project_id:'p2'}]}`; pass clients/projects fixtures; assert 2 unique recs with correct names).
- [ ] **Step 3:** Run the test → pass. **Commit.**

---

### Task 3: AI fallback tier + corroboration gate in `email-ingest.ts`

**Files:** Modify `lib/deliverables/email-ingest.ts`, `lib/deliverables/email-ingest.test.ts`.

- [ ] **Step 1: Extend `IngestDeps`** with optional AI hooks (optional so existing callers/tests are unaffected):

```ts
import type { AiMatchResult, FilingHistoryRec } from './ai-matcher'
// in IngestDeps:
  aiMatch?: (input: import('./ai-matcher').AiMatchInput) => Promise<AiMatchResult>
  filingHistory?: FilingHistoryRec[]
```

- [ ] **Step 2: After `const routing = routeMatch(match)`**, insert the AI fallback. Keep the deterministic result unless the AI both picks a valid candidate and (for auto-file) corroborates:

```ts
import { AI_AUTO_FILE_THRESHOLD, serverCorroborates } from './ai-matcher'
import { emailDomain } from './email'
import { normalizeName } from './matcher'

let effMatch = match
let routing = routeMatch(match)

if (!routing.confident && deps.aiMatch) {
  const candidates = deps.matchData.projects.map((p) => ({
    projectCode: p.project_code, projectName: p.project_name,
    clientName: deps.matchData.clients.find((c) => c.id === p.client_id)?.name ?? 'Unknown',
  }))
  const ai = await deps.aiMatch({
    from: payload.from, subject: payload.subject ?? '',
    filename: files.map((f) => f.filename).join(', '),
    bodySnippet: (payload.body ?? '').slice(0, 1500),
    candidates, history: deps.filingHistory ?? [],
  })
  const chosen = ai.projectCode ? deps.matchData.projects.find((p) => p.project_code === ai.projectCode) : null
  if (chosen) {
    const clientName = deps.matchData.clients.find((c) => c.id === chosen.client_id)?.name ?? ''
    const dom = emailDomain(signalEmail)
    const corroborated = ai.confidence >= AI_AUTO_FILE_THRESHOLD && serverCorroborates({
      clientName, projectName: chosen.project_name,
      haystack: `${payload.subject ?? ''} ${files.map((f) => f.filename).join(' ')}`,
      senderDomainMatchesClient: !!dom && deps.matchData.domainMap[dom] === chosen.client_id,
      clientHasHistory: (deps.filingHistory ?? []).some((h) => h.clientId === chosen.client_id),
    })
    // Upgrade the match to the AI's pick. Confidence: >=0.85 (filed) only when corroborated, else keep it
    // in the review band but still surface the pick as the best guess.
    effMatch = { clientId: chosen.client_id, projectId: chosen.id, confidence: corroborated ? Math.max(ai.confidence, 0.85) : 0.6,
      method: 'ai', candidates: [{ clientId: chosen.client_id, projectId: chosen.id, confidence: ai.confidence, reason: `ai:${ai.reasoning}`, method: 'ai' }, ...match.candidates].slice(0, 3) }
    routing = routeMatch(effMatch)
  }
}
```

  Then replace the downstream references (`match` → `effMatch`) for `describeCandidates`, `project`, `clientName`, `persistClientId`, `persistProjectId`, and the persisted `match_confidence`/`match_method`/`match_candidates`. (The `resolver` already reads `match.clientId`/`match.projectId` via `effMatch`.)

  > Note the signal email must be computed before this block — move `const signalEmail = clientSignalEmail(...)` above it if needed (it is already computed near the top).

- [ ] **Step 3: Add tests** to `email-ingest.test.ts` (extend `makeDeps` to accept `aiMatch`/`filingHistory`):
  - AI confident + corroborated (filename contains client) → `filed`, `project_id` set to the AI's project, reply "Filed ✓".
  - AI confident but NOT corroborated (no signal) → `review`, reply best guess = the AI's project.
  - AI unsure (`projectCode:null`) → `review`, no project guess.
  - deterministic-confident case → `aiMatch` spy NOT called.
  - `aiMatch` absent (undefined) → behaves exactly as today (existing tests still green).

- [ ] **Step 4: Run** `npx vitest run lib/deliverables/email-ingest.test.ts lib/deliverables/ai-matcher.test.ts` → pass. **Commit.**

---

### Task 4: Wire the AI tier into the ingest route

**Files:** Modify `app/api/deliverables/ingest/route.ts`.

- [ ] **Step 1:** Import + construct, and add to `deps`:

```ts
import Anthropic from '@anthropic-ai/sdk'
import { aiMatch } from '@/lib/deliverables/ai-matcher'
import { loadFilingHistory } from '@/lib/deliverables/load'
// ...
const anthropic = new Anthropic()
const filingHistory = await loadFilingHistory(admin, matchData.clients, matchData.projects)
// in deps:
  aiMatch: (input) => aiMatch(input, anthropic),
  filingHistory,
```

- [ ] **Step 2: Full verification:**
  - `npx vitest run` → all green (no concurrent build).
  - `npm run build` → exit 0 (run separately, not alongside vitest).
  - `npm run lint` → no new errors.
- [ ] **Step 3: Commit; open PR to `main`; squash-merge.** Vercel auto-deploys. `ANTHROPIC_API_KEY` already set in prod.

---

## Self-Review Checklist (run before executing)

- Spec coverage: corroborated-auto-file ✅ (Task 3 gate), full-memory context ✅ (candidates + history, Tasks 2–3), Haiku default via env ✅ (Task 1), guardrails — hallucination→review ✅, error→review (never throws) ✅, dedup precedes AI ✅ (AI runs after the existing dedup/attachment gates in `ingestEmail`), recipients untouched ✅ (reply path unchanged).
- Type consistency: `AiMatchResult`/`FilingHistoryRec`/`AiMatchInput` used identically across `ai-matcher.ts`, `load.ts`, `email-ingest.ts`; `MatchMethod` gains `'ai'` in Task 1 before use.
- No placeholders.
