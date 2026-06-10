import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
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

If asked something unrelated to survey operations or the project data, politely steer back to the tracker. Never invent project data that isn't in the list below.`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
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

  const today = new Date().toISOString().split('T')[0]
  const system = `${SYSTEM_PROMPT}\n\nToday's date: ${today}\n\nCurrent project data (JSON):\n${JSON.stringify(projects)}`

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
        controller.enqueue(
          encoder.encode('\n\n[Sorry, something went wrong. Please try again.]')
        )
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
