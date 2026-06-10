import { describe, it, expect } from 'vitest'
import { normalizeQuestions, type DraftQuestion } from '@/lib/parsing/validate'

const valid: DraftQuestion = {
  order_num: 1,
  text: 'What is your role?',
  section: 'Screener',
  type: 'single_select',
  is_open_text: false,
  is_ai_followup: false,
  answer_options: ['IC', 'Manager'],
}

describe('normalizeQuestions', () => {
  it('passes through valid questions', () => {
    const result = normalizeQuestions([valid])
    expect(result.ok).toBe(true)
    expect(result.questions).toHaveLength(1)
  })

  it('forces is_open_text=true when is_ai_followup=true', () => {
    const result = normalizeQuestions([
      { ...valid, type: 'other', is_open_text: false, is_ai_followup: true },
    ])
    expect(result.questions[0].is_open_text).toBe(true)
  })

  it('forces is_open_text=true when type is open_text', () => {
    const result = normalizeQuestions([
      { ...valid, type: 'open_text', is_open_text: false },
    ])
    expect(result.questions[0].is_open_text).toBe(true)
  })

  it('rejects empty question text', () => {
    const result = normalizeQuestions([{ ...valid, text: '   ' }])
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatch(/text/i)
  })

  it('rejects an empty list', () => {
    const result = normalizeQuestions([])
    expect(result.ok).toBe(false)
  })

  it('coerces unknown type to other', () => {
    const result = normalizeQuestions([
      { ...valid, type: 'weird' as DraftQuestion['type'] },
    ])
    expect(result.questions[0].type).toBe('other')
  })

  it('renumbers order_num sequentially from 1', () => {
    const result = normalizeQuestions([
      { ...valid, order_num: 5 },
      { ...valid, order_num: 9, text: 'Second?' },
    ])
    expect(result.questions.map(q => q.order_num)).toEqual([1, 2])
  })

  it('defaults missing answer_options to empty array', () => {
    const q = { ...valid } as Partial<DraftQuestion>
    delete q.answer_options
    const result = normalizeQuestions([q as DraftQuestion])
    expect(result.questions[0].answer_options).toEqual([])
  })
})
