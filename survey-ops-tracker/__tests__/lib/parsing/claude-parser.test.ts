import { describe, it, expect, vi } from 'vitest'
import { parseQuestionnaire, EXTRACTION_TOOL, SYSTEM_PROMPT } from '@/lib/parsing/claude-parser'

function mockAnthropicResponse(toolInput: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', name: 'record_questions', input: toolInput }],
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
    const client = mockAnthropicResponse({
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
    const client = {
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'sorry' }] }) },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await parseQuestionnaire({ kind: 'text', text: 'x' }, client as any)
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatch(/extract/i)
  })
})
