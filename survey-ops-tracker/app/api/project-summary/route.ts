import Anthropic from '@anthropic-ai/sdk'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedEmail } from '@/lib/utils/allowedDomain'
import { getAiBudget, logAiUsage } from '@/lib/server/observability'
import { buildSummaryFacts, type SummaryFacts } from '@/lib/server/projectSummary'
import type { Blast } from '@/lib/hooks/useProjectBlasts'
import type { SurveyProject } from '@/lib/hooks/useProjects'
import type { StageHistoryRow } from '@/lib/utils/stageTiming'

// ✦ Summary — hybrid endpoint. Every number in `facts`/`watchouts` is computed
// in code by buildSummaryFacts (never invented by the model); Haiku only writes
// the prose that wraps those numbers. If Haiku's output can't be parsed as the
// expected JSON shape (or the call fails outright), we fall back to a plain,
// still-100%-factual narrative built straight from `facts` — the endpoint
// should never 500 just because the model formatted its answer oddly.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Haiku, not Sonnet/Opus: this call only phrases numbers we already computed —
// no reasoning, no tool use, no judgment calls — so the cheapest, fastest model
// is the right fit. Revisit if narrative quality on edge cases disappoints.
const MODEL = 'claude-haiku-4-5'
const MAX_TOKENS = 500

const SYSTEM_PROMPT =
  'You write a terse, factual status brief for an internal survey-operations tool. ' +
  "You are GIVEN exact figures as JSON — NEVER invent, alter, recompute, or round numbers differently; only phrase what you're given. " +
  "If a field is null or 'n/a', omit it gracefully rather than guessing. " +
  'Do NOT restate the watch-outs (shown separately). ' +
  'Respond with ONLY a JSON object: {"oneLine": string, "status": string, "progress": string, "money": string, "next": string}. ' +
  'Each value is ONE short sentence; oneLine <= 160 chars and is the headline.'

interface Narrative {
  oneLine: string
  status: string
  progress: string
  money: string
  next: string
}

// Same idea as the assistant route's `withCacheBreakpoint`, applied to a
// single static system prompt instead of a growing message list: mark the
// last (only) system block cacheable so repeat calls across users/projects
// reuse the cached prefix. Note: SYSTEM_PROMPT is well under Haiku's ~4096
// token minimum cacheable prefix, so in practice this breakpoint won't
// register a hit yet — it's wired up correctly for when the prompt grows.
function withCacheBreakpoint(text: string): Anthropic.TextBlockParam[] {
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }]
}

/** Defensive JSON extraction: try the whole trimmed text, then the largest
 *  {...} substring (in case the model wrapped the object in prose or a code
 *  fence despite instructions). Returns null — never throws — on failure. */
function parseNarrative(text: string): Narrative | null {
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s)
    } catch {
      return null
    }
  }

  let parsed = tryParse(text.trim())
  if (parsed == null) {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) parsed = tryParse(match[0])
  }
  if (parsed == null || typeof parsed !== 'object') return null

  const o = parsed as Record<string, unknown>
  const str = (k: string): string | null =>
    typeof o[k] === 'string' && o[k] ? (o[k] as string) : null

  const oneLine = str('oneLine')
  if (!oneLine) return null // must at least have the headline

  return {
    oneLine: oneLine.slice(0, 200),
    status: str('status') ?? '',
    progress: str('progress') ?? '',
    money: str('money') ?? '',
    next: str('next') ?? '',
  }
}

/** Plain narrative assembled straight from `facts` — used whenever the model
 *  call fails or its output can't be parsed. No numbers here are invented;
 *  everything is read directly off `facts`. */
function fallbackNarrative(facts: SummaryFacts): Narrative {
  const pct = (n: number | null): string | null => (n != null ? `${Math.round(n)}%` : null)

  const nPart =
    facts.nTarget != null
      ? `${facts.nCollected.toLocaleString()} of ${facts.nTarget.toLocaleString()} collected${
          facts.nPct != null ? ` (${pct(facts.nPct)})` : ''
        }`
      : `${facts.nCollected.toLocaleString()} collected`

  const moneyPart =
    facts.budget != null
      ? `$${facts.spend.toLocaleString()} of $${facts.budget.toLocaleString()} spent${
          facts.spendPct != null ? ` (${pct(facts.spendPct)})` : ''
        }`
      : `$${facts.spend.toLocaleString()} spent`

  const oneLine = `${facts.stage}${facts.delivered ? ' · delivered' : ''} — ${nPart}.`.slice(0, 160)

  return {
    oneLine,
    status: facts.delivered
      ? 'Delivered.'
      : `Currently in ${facts.stage}${
          facts.daysInStage != null ? ` (${facts.daysInStage} day${facts.daysInStage === 1 ? '' : 's'})` : ''
        }.`,
    progress: `${nPart}.`,
    money: `${moneyPart}.`,
    next: facts.nextSteps[0] ?? 'No open next steps recorded.',
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAllowedEmail(user.email)) return new Response('Unauthorized', { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey.startsWith('your-')) {
    return Response.json(
      { error: 'AI summary is not configured yet (missing API key).' },
      { status: 503 }
    )
  }

  const budget = await getAiBudget()
  if (budget.blocked) {
    return Response.json(
      { error: `AI summary is paused for this month — the usage budget ($${budget.cap.toFixed(0)}) has been reached. An admin can raise it in Admin → AI usage.` },
      { status: 503 }
    )
  }

  const { projectId } = await req.json()
  if (typeof projectId !== 'string' || !projectId.trim()) {
    return new Response('Bad request', { status: 400 })
  }

  // Service-role reads, same pattern as lib/mcp/data.ts getProjectDetail — the
  // caller has already passed the allowed-email gate above.
  const admin = createAdminClient()

  const { data: project, error: projectErr } = await admin
    .from('survey_projects')
    .select('*, captain:team_members(id, name, initials)')
    .eq('id', projectId)
    .maybeSingle()
  if (projectErr) {
    console.error('project-summary: project fetch failed:', projectErr)
    return Response.json({ error: 'Could not load the project.' }, { status: 500 })
  }
  if (!project) {
    return Response.json({ error: 'Project not found.' }, { status: 404 })
  }

  const [blastsRes, stageHistoryRes, stepsRes] = await Promise.all([
    admin.from('project_blasts').select('*').eq('project_id', projectId).order('created_at', { ascending: true }),
    admin.from('project_stage_history').select('stage, entered_at').eq('project_id', projectId).order('entered_at', { ascending: true }),
    admin.from('project_steps').select('text').eq('project_id', projectId).eq('done', false).order('created_at', { ascending: true }),
  ])

  const blasts = (blastsRes.data ?? []) as Blast[]
  const stageHistory = (stageHistoryRes.data ?? []) as StageHistoryRow[]
  const openNextSteps = (stepsRes.data ?? []).map((s) => s.text)

  const now = new Date().toISOString()
  const facts = buildSummaryFacts({
    project: project as unknown as SurveyProject,
    blasts,
    stageHistory,
    now,
    openNextSteps,
  })

  const anthropic = new Anthropic({ apiKey })

  let narrative: Narrative
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: withCacheBreakpoint(SYSTEM_PROMPT),
      messages: [{ role: 'user', content: JSON.stringify(facts) }],
    })
    void logAiUsage({
      endpoint: 'project-summary',
      userEmail: user.email,
      model: MODEL,
      usage: response.usage,
    })
    const text = response.stop_reason === 'refusal'
      ? ''
      : (response.content.find(b => b.type === 'text')?.text ?? '')
    narrative = parseNarrative(text) ?? fallbackNarrative(facts)
  } catch (err) {
    console.error('project-summary: Anthropic call failed:', err)
    narrative = fallbackNarrative(facts)
  }

  return Response.json({
    narrative,
    facts,
    watchouts: facts.watchouts,
    generated_at: now,
  })
}
