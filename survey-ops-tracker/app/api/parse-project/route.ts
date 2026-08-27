import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { canViewFinancials } from '@/lib/auth/capabilities'
import { isAllowedEmail } from '@/lib/utils/allowedDomain'
import { RESTRICTED_FIELDS } from '@/lib/utils/quickFields'
import { getAiBudget, logAiUsage } from '@/lib/server/observability'
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
        'Full name. Map first names to: Alex Pinsky, Jenna Shrove, Steven Stubbs, Vineet Kapur. Use "Internal" when there is no external sales lead.',
    },
    n_target: {
      type: 'integer',
      description:
        'The MINIMUM of the agreed N range (migration 078) — the N we commit to collecting.',
    },
    n_target_max: {
      type: 'integer',
      description:
        'The TOP of the agreed N range. When the user gives a single N, set this to the same value as n_target.',
    },
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
    status: { type: 'string', enum: ['Open', 'Closed', 'Hold'] },
    note: {
      type: 'string',
      description: 'Any free-text status update or next step the user mentioned, to append to the project log',
    },
  },
  additionalProperties: false as const,
}

// Belt-and-suspenders validation of the model output before it reaches the UI
// (the schema already constrains it, but never trust generated data near the DB).
const ENUMS: Record<string, string[]> = {
  project_type: ['PS', 'B2B', 'Rerun'],
  status: ['Open', 'Closed', 'Hold'],
  board_column: ['Submitted', 'Doc Programming', 'Survey Programming', 'EdWin QA', 'Fielding', 'Data QA', 'Delivery'],
  scoping_stage: ['New Inquiry', 'Proposal Sent', 'Pricing Discussion', 'Awaiting Approval', 'Closed'],
}
const NON_NEGATIVE = ['n_target', 'n_target_max', 'n_collected', 'n_actual', 'audience_size', 'budget', 'actual_spend']

function sanitizeFields(
  fields: Record<string, unknown>,
  canSeeMoney: boolean
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) {
    if (v == null) continue
    // Second line of defence behind schemaFor(): the schema already omits these
    // for a non-holder, but a restricted field must never leave this route for
    // someone who may not set it, whatever the model returned.
    if (!canSeeMoney && RESTRICTED_FIELDS.has(k)) continue
    if (k in ENUMS && !ENUMS[k].includes(String(v))) continue // drop invalid enum values
    if (NON_NEGATIVE.includes(k) && typeof v === 'number' && v < 0) continue // drop negatives
    out[k] = v
  }
  // A project is either in the scoping funnel or on the pipeline — never both
  if (out.scoping_stage && out.board_column) delete out.board_column
  return out
}

// The finance gate reaches the MODEL, not just the screen. `budget` is a cost
// ceiling and restricted, so for a caller without view_financials it is stripped
// out of the schema entirely: the model is never told the field exists, can't
// return it, and a non-holder therefore can't WRITE the ceiling by describing it
// — not merely fail to see it afterwards. Soft gate, as everywhere: this shapes
// what the route accepts, it doesn't stop anyone who has SELECT on the column.
function schemaFor(canSeeMoney: boolean) {
  if (canSeeMoney) return FIELDS_SCHEMA
  return {
    ...FIELDS_SCHEMA,
    properties: Object.fromEntries(
      Object.entries(FIELDS_SCHEMA.properties).filter(([k]) => !RESTRICTED_FIELDS.has(k))
    ),
  }
}

// Same gate on the way IN. QuickEdit already leaves the budget out of the
// current-values context it posts, so this only matters for a stale or patched
// bundle — but the model must not be handed a ceiling it could echo back in
// prose either.
function scrubCurrent(current: unknown, canSeeMoney: boolean): unknown {
  if (canSeeMoney || current == null || typeof current !== 'object') return current
  return Object.fromEntries(
    Object.entries(current as Record<string, unknown>).filter(([k]) => !RESTRICTED_FIELDS.has(k))
  )
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

  const budget = await getAiBudget()
  if (budget.blocked) {
    return Response.json(
      { error: `AI entry is paused for this month — the usage budget ($${budget.cap.toFixed(0)}) has been reached. An admin can raise it in Admin → AI usage.` },
      { status: 503 }
    )
  }

  const { description, mode, current } = await req.json()
  if (typeof description !== 'string' || !description.trim()) {
    return new Response('Bad request', { status: 400 })
  }

  // Own query, own failure: canViewFinancials() answers false when the
  // capability table isn't there yet, which just means the budget is out of
  // scope for this parse — every other field still works.
  const canSeeMoney = await canViewFinancials(user.id)

  const { data: members } = await supabase.from('team_members').select('name')
  const memberNames = (members ?? []).map(m => m.name)
  const today = new Date().toISOString().split('T')[0]

  const system = `You convert plain-English descriptions of survey research projects into structured fields for a project tracker.

Today's date: ${today} (resolve relative dates like "next Friday" or "in two weeks" to ISO dates).
Team members who can be project captain: ${memberNames.join(', ') || '(none)'}

Rules:
- Include ONLY fields the user explicitly mentioned or clearly implied. Never guess or fill defaults.
- Money amounts: plain numbers in dollars ("15k" → 15000).
- N target is a RANGE: n_target is the MINIMUM N we commit to collecting, n_target_max the top of it. A single N ("N of 2500") sets BOTH to that number; "1000 to 1200" sets n_target 1000 and n_target_max 1200. Only move one end when the user changed only that end.
- captain_name must exactly match one of the team member names; if the mentioned person doesn't match anyone, omit it.
- If the user describes a status update or next step in prose, put it in "note".
${mode === 'edit'
    ? `- This EDITS an existing project. Current values (JSON): ${JSON.stringify(scrubCurrent(current, canSeeMoney) ?? {})}\n- Return only the fields that should CHANGE.`
    : '- This CREATES a new project. Extract everything mentioned.'}`

  const anthropic = new Anthropic({ apiKey })

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 16000,
      system,
      output_config: { format: { type: 'json_schema', schema: schemaFor(canSeeMoney) } },
      messages: [{ role: 'user', content: description }],
    })
    void logAiUsage({
      endpoint: 'parse-project',
      userEmail: user.email,
      model: 'claude-opus-4-8',
      usage: response.usage,
    })
    if (response.stop_reason === 'refusal') {
      return Response.json({ error: 'The request was declined. Try rephrasing without sensitive content.' }, { status: 400 })
    }
    if (response.stop_reason === 'max_tokens') {
      return Response.json({ error: 'That description was too long to process — try shortening it.' }, { status: 400 })
    }
    const text = response.content.find(b => b.type === 'text')?.text ?? '{}'
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(text)
    } catch {
      return Response.json({ error: 'Could not read the AI response — please try again.' }, { status: 502 })
    }
    return Response.json({ fields: sanitizeFields(parsed, canSeeMoney) })
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
