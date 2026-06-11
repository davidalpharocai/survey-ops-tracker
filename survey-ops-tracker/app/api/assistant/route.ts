import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { isAllowedEmail } from '@/lib/utils/allowedDomain'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM_PROMPT = `You are the AlphaRoc Survey Ops assistant, embedded in the team's survey project tracker.

You answer questions about the team's survey projects using the project data provided below. Be concise and direct — the team wants quick answers, not essays. Use plain language. When listing projects, use short bullet lists. Format dates like "Jun 24". When relevant, mention the project's current stage, due date, or budget status.

Key concepts:
- Pipeline stages (in order): Submitted → Doc Programming → Survey Programming → EdWin QA → Fielding → Data QA → Delivery
- Scoping phase (pre-sale): New Inquiry → Proposal Sent → Pricing Discussion → Awaiting Approval
- N Target = response goal; N Collected = responses so far; N Actual = usable responses after cleaning
- Budget vs Actual Spend tracks internal cost; cost per N = spend ÷ responses
- Voter surveys need extra QA and citation language
- Project types: PS = PureSpectrum (consumer panel fielded via the PureSpectrum survey data tool), B2B = expert/business panel, Rerun = repeat wave of an earlier study
- Next steps are checkable to-do items per project; completed ones (done=true) form the project's 'Latest' log of what was recently finished
- Survey ID format: [file owner's initials][client+project abbreviation][YYYYMMDD file created][country/region if any].
  Example: ALBNFOF20260529UK = Alden + Bain Future of Food + created 2026-05-29 + UK. You can decode IDs for users on request.

Answer style for status questions: LEAD with deadline and collection risk (overdue or behind-pace projects first), and always show N collected vs target (e.g. "142/250").

If asked something unrelated to survey operations or the project data, politely steer back to the tracker. Never invent project data that isn't in the list below.`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAllowedEmail(user.email)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey.startsWith('your-')) {
    return new Response(
      'The AI assistant is not configured yet (missing API key).',
      { status: 503 }
    )
  }

  const { messages } = await req.json()
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response('Bad request', { status: 400 })
  }

  const { data: projects, error } = await supabase
    .from('survey_projects')
    .select('*, captain:team_members(name, initials)')
    .order('due_date', { ascending: true })

  if (error) {
    return new Response('Failed to load project data', { status: 500 })
  }

  // Recent logged activity (emails etc.) so the assistant can answer
  // "what's the latest with the client" without anyone opening Gmail
  const { data: activity } = await supabase
    .from('project_activity')
    .select('project_id, type, direction, sender, subject, snippet, occurred_at')
    .order('occurred_at', { ascending: false })
    .limit(80)

  // Structured next steps (checkable items). If the migration hasn't been
  // applied yet, supabase returns an error and we just fall back to [].
  const { data: steps } = await supabase
    .from('project_steps')
    .select('project_id, text, done, completed_at, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  const nameById = new Map((projects ?? []).map(p => [p.id, p.project_name]))
  const activityContext = (activity ?? []).map(a => ({
    project: nameById.get(a.project_id) ?? a.project_id,
    when: a.occurred_at,
    type: a.type,
    direction: a.direction,
    from: a.sender,
    subject: a.subject,
    snippet: a.snippet,
  }))

  const stepsContext = (steps ?? []).map(s => ({
    project: nameById.get(s.project_id) ?? s.project_id,
    text: s.text,
    done: s.done,
    completed_at: s.completed_at,
  }))

  // Manual data-change log entries (falls back to [] pre-migration)
  const { data: dataChanges } = await supabase
    .from('project_data_changes')
    .select('project_id, text, created_by, created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  const dataChangesContext = (dataChanges ?? []).map(d => ({
    project: nameById.get(d.project_id) ?? d.project_id,
    change: d.text,
    by: d.created_by,
    when: d.created_at,
  }))

  const today = new Date().toISOString().split('T')[0]
  const system = `${SYSTEM_PROMPT}\n\nToday's date: ${today}\n\nCurrent project data (JSON):\n${JSON.stringify(projects)}\n\nRecent logged activity (emails etc., newest first; full bodies are viewable in the app's Activity section):\n${JSON.stringify(activityContext)}\n\nStructured next steps (open and recently completed):\n${JSON.stringify(stepsContext)}\n\nData change log (manual data edits by engineers, newest first):\n${JSON.stringify(dataChangesContext)}`

  const anthropic = new Anthropic({ apiKey })

  const stream = anthropic.messages.stream({
    model: 'claude-opus-4-8',
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system,
    messages: messages.map((m: { role: string; content: string }) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: String(m.content),
    })),
  })

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(encoder.encode(event.delta.text))
          }
        }
      } catch (err) {
        let msg = 'Sorry, something went wrong. Please try again.'
        if (err instanceof Anthropic.AuthenticationError) {
          msg =
            'The Anthropic API key was rejected. Double-check the value of ANTHROPIC_API_KEY in Vercel (Settings → Environment Variables) — make sure the full key was pasted with no spaces — then redeploy.'
        } else if (err instanceof Anthropic.PermissionDeniedError) {
          msg =
            "The API key works but doesn't have permission for this model. Ask your Anthropic admin to enable Claude model access for this key's workspace."
        } else if (err instanceof Anthropic.RateLimitError) {
          msg = 'Anthropic rate limit hit — wait a minute and try again.'
        } else if (err instanceof Anthropic.APIError) {
          msg = `Anthropic API error (${err.status}): ${err.message}`.slice(0, 300)
        }
        controller.enqueue(encoder.encode(`\n\n[${msg}]`))
        console.error('Assistant stream error:', err)
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  })
}
