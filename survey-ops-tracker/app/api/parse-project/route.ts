import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { isAllowedEmail } from '@/lib/utils/allowedDomain'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// All fields optional — the model only includes what the user actually mentioned
const FIELDS_SCHEMA = {
  type: 'object' as const,
  properties: {
    project_name: { type: 'string' },
    client: { type: 'string' },
    project_type: { type: 'string', enum: ['PS', 'B2B', 'Rerun'] },
    captain_name: {
      type: 'string',
      description: 'Must exactly match one of the provided team member names',
    },
    salesperson: {
      type: 'string',
      description:
        'Full name. Map first names to: Alex Pinsky, Jenna Strova, Steven Stubbs, Vineet Kapur. Use "Internal" when there is no external sales lead.',
    },
    n_target: { type: 'integer' },
    n_collected: { type: 'integer' },
    n_actual: { type: 'integer' },
    audience_size: { type: 'integer' },
    budget: { type: 'number' },
    actual_spend: { type: 'number' },
    submitted_date: { type: 'string', format: 'date' },
    launch_date: { type: 'string', format: 'date' },
    due_date: { type: 'string', format: 'date' },
    deliver_date: { type: 'string', format: 'date' },
    longitudinal: { type: 'boolean' },
    row_level_data: { type: 'boolean' },
    terminations: { type: 'boolean' },
    voter_survey_qa: { type: 'boolean' },
    citation_language_needed: { type: 'boolean' },
    survey_tool_id: { type: 'string', description: 'Comma separated survey IDs' },
    slack_channel_url: { type: 'string' },
    board_column: {
      type: 'string',
      enum: [
        'Submitted', 'Doc Programming', 'Survey Programming',
        'EdWin QA', 'Fielding', 'Data QA', 'Delivery',
      ],
    },
    scoping_stage: {
      type: 'string',
      enum: ['New Inquiry', 'Proposal Sent', 'Pricing Discussion', 'Awaiting Approval', 'Closed'],
    },
    status: { type: 'string', enum: ['Open', 'Closed'] },
    note: {
      type: 'string',
      description: 'Any free-text status update or next step the user mentioned, to append to the project log',
    },
  },
  additionalProperties: false as const,
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAllowedEmail(user.email)) return new Response('Unauthorized', { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey.startsWith('your-')) {
    return Response.json(
      { error: 'AI entry is not configured yet (missing API key).' },
      { status: 503 }
    )
  }

  const { description, mode, current } = await req.json()
  if (typeof description !== 'string' || !description.trim()) {
    return new Response('Bad request', { status: 400 })
  }

  const { data: members } = await supabase.from('team_members').select('name')
  const memberNames = (members ?? []).map(m => m.name)
  const today = new Date().toISOString().split('T')[0]

  const system = `You convert plain-English descriptions of survey research projects into structured fields for a project tracker.

Today's date: ${today} (resolve relative dates like "next Friday" or "in two weeks" to ISO dates).
Team members who can be project captain: ${memberNames.join(', ') || '(none)'}

Rules:
- Include ONLY fields the user explicitly mentioned or clearly implied. Never guess or fill defaults.
- Money amounts: plain numbers in dollars ("15k" → 15000).
- captain_name must exactly match one of the team member names; if the mentioned person doesn't match anyone, omit it.
- If the user describes a status update or next step in prose, put it in "note".
${mode === 'edit'
    ? `- This EDITS an existing project. Current values (JSON): ${JSON.stringify(current ?? {})}\n- Return only the fields that should CHANGE.`
    : '- This CREATES a new project. Extract everything mentioned.'}`

  const anthropic = new Anthropic({ apiKey })

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 16000,
      system,
      output_config: { format: { type: 'json_schema', schema: FIELDS_SCHEMA } },
      messages: [{ role: 'user', content: description }],
    })
    const text = response.content.find(b => b.type === 'text')?.text ?? '{}'
    return Response.json({ fields: JSON.parse(text) })
  } catch (err) {
    console.error('parse-project error:', err)
    let msg = 'Could not understand that description. Try rephrasing.'
    if (err instanceof Anthropic.AuthenticationError) {
      msg =
        'The Anthropic API key was rejected — check ANTHROPIC_API_KEY in Vercel and redeploy.'
    } else if (err instanceof Anthropic.PermissionDeniedError) {
      msg =
        "The API key doesn't have model access — ask your Anthropic admin to enable it."
    } else if (err instanceof Anthropic.RateLimitError) {
      msg = 'Anthropic rate limit hit — wait a minute and try again.'
    } else if (err instanceof Anthropic.APIError) {
      msg = `Anthropic API error (${err.status}): ${err.message}`.slice(0, 300)
    }
    return Response.json({ error: msg }, { status: 500 })
  }
}
