import Anthropic from '@anthropic-ai/sdk'
import { normalizeQuestions, type NormalizeResult, type DraftQuestion } from './validate'

export const SYSTEM_PROMPT = `You extract survey questions from questionnaire documents for compliance review.

Extract EVERY question in document order. For each question determine:
- type: open_text (free-form written answer), single_select, multi_select, scale (rating/numeric scale), or other
- is_open_text: true for any question answered in the respondent's own words. Questionnaires often call these out explicitly: "open end", "open-end", "OE", "verbatim", "open text", "free response".
- is_ai_followup: true if the question is flagged as an AI follow-up / AI probe / dynamic follow-up. RULE: every AI follow-up question is ALWAYS is_open_text=true as well.
- section: the section heading the question appears under, if any
- answer_options: the list of answer choices for closed questions; [] for open-text

Do not invent questions. Do not skip questions. Preserve exact question wording.`

export const EXTRACTION_TOOL = {
  name: 'record_questions',
  description: 'Record the structured list of survey questions extracted from the document.',
  input_schema: {
    type: 'object' as const,
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            order_num: { type: 'integer' },
            text: { type: 'string' },
            section: { type: ['string', 'null'] },
            type: { type: 'string', enum: ['open_text', 'single_select', 'multi_select', 'scale', 'other'] },
            is_open_text: { type: 'boolean' },
            is_ai_followup: { type: 'boolean' },
            answer_options: { type: 'array', items: { type: 'string' } },
          },
          required: ['order_num', 'text', 'type', 'is_open_text', 'is_ai_followup'],
        },
      },
    },
    required: ['questions'],
  },
} satisfies Anthropic.Tool

export type ParseInput =
  | { kind: 'text'; text: string }
  | { kind: 'pdf'; base64: string }

export async function parseQuestionnaire(
  input: ParseInput,
  client: Anthropic = new Anthropic()
): Promise<NormalizeResult> {
  const userContent =
    input.kind === 'pdf'
      ? [
          { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: input.base64 } },
          { type: 'text' as const, text: 'Extract all survey questions from this questionnaire.' },
        ]
      : [{ type: 'text' as const, text: `Extract all survey questions from this questionnaire:\n\n${input.text}` }]

  const stream = client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 32000,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: 'tool', name: EXTRACTION_TOOL.name },
    messages: [{ role: 'user', content: userContent as Anthropic.MessageParam['content'] }],
  })
  const response = await stream.finalMessage()

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!toolUse) {
    return { ok: false, questions: [], errors: ['Could not extract questions from the document'] }
  }

  const raw = (toolUse.input as { questions?: DraftQuestion[] }).questions ?? []
  const result = normalizeQuestions(raw)
  if (response.stop_reason === 'max_tokens') {
    return {
      ok: false,
      questions: result.questions,
      errors: [
        'Extraction was truncated — the document may contain more questions than were returned',
        ...result.errors,
      ],
    }
  }
  return result
}
