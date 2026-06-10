import { describe, it, expect, vi } from 'vitest'
import { parseQuestionnaire, EXTRACTION_TOOL, SYSTEM_PROMPT } from '@/lib/parsing/claude-parser'

function mockAnthropicClient(toolInput: unknown, stopReason = 'end_turn') {
  const finalMessage = {
    content: [{ type: 'tool_use', name: 'record_questions', input: toolInput }],
    stop_reason: stopReason,
  }
  return {
    messages: {
      stream: vi.fn().mockReturnValue({
        finalMessage: vi.fn().mockResolvedValue(finalMessage),
      }),
    },
  }
}

/** Kept for the "no tool_use block" test which still uses stream. */
function mockAnthropicClientNoTool() {
  const finalMessage = {
    content: [{ type: 'text', text: 'sorry' }],
    stop_reason: 'end_turn',
  }
  return {
    messages: {
      stream: vi.fn().mockReturnValue({
        finalMessage: vi.fn().mockResolvedValue(finalMessage),
      }),
    },
  }
}

describe('SYSTEM_PROMPT', () => {
  it('encodes the AI follow-up rule', () => {
    expect(SYSTEM_PROMPT).toMatch(/AI follow-up/i)
    expect(SYSTEM_PROMPT).toMatch(/open.?text/i)
  })
})

describe('EXTRACTION_TOOL', () => {
  it('requires the questions array with the right fields', () => {
    const props = EXTRACTION_TOOL.input_schema.properties.questions.items.properties
    for (const key of ['order_num', 'text', 'type', 'is_open_text', 'is_ai_followup', 'section', 'answer_options']) {
      expect(props).toHaveProperty(key)
    }
  })
})

describe('parseQuestionnaire', () => {
  it('returns normalized questions from a tool_use response', async () => {
    const client = mockAnthropicClient({
      questions: [{
        order_num: 1, text: 'Why?', section: null, type: 'other',
        is_open_text: false, is_ai_followup: true, answer_options: [],
      }],
    })
    const result = await parseQuestionnaire(
      { kind: 'text', text: 'Q1. Why? [AI follow-up]' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any
    )
    expect(result.ok).toBe(true)
    // AI follow-up forced open-text by normalization
    expect(result.questions[0].is_open_text).toBe(true)
  })

  it('fails cleanly when no tool_use block comes back', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await parseQuestionnaire({ kind: 'text', text: 'x' }, mockAnthropicClientNoTool() as any)
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatch(/extract/i)
  })

  it('returns ok:false with partial questions when stop_reason is max_tokens', async () => {
    const client = mockAnthropicClient(
      {
        questions: [{
          order_num: 1, text: 'Truncated Q?', section: null, type: 'open_text',
          is_open_text: true, is_ai_followup: false, answer_options: [],
        }],
      },
      'max_tokens',
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await parseQuestionnaire({ kind: 'text', text: 'long document...' }, client as any)
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatch(/truncat/i)
    expect(result.questions).toHaveLength(1)
  })
})
