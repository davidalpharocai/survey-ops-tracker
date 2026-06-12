export type QuestionType = 'open_text' | 'single_select' | 'multi_select' | 'scale' | 'other'

export type DraftQuestion = {
  order_num: number
  text: string
  section: string | null
  type: QuestionType
  is_open_text: boolean
  is_ai_followup: boolean
  answer_options: string[]
}

/**
 * `ok: false` means at least one question failed validation (or extraction
 * was truncated). `questions` is still populated so human review/edit UIs
 * can show what was recovered — it MUST NOT be persisted without a
 * subsequent `ok: true` normalization pass.
 */
export type NormalizeResult = {
  ok: boolean
  questions: DraftQuestion[]
  errors: string[]
}

const VALID_TYPES: QuestionType[] = ['open_text', 'single_select', 'multi_select', 'scale', 'other']

export function normalizeQuestions(raw: DraftQuestion[]): NormalizeResult {
  const errors: string[] = []
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, questions: [], errors: ['No questions found'] }
  }

  const questions = raw.map((q, i) => {
    const text = typeof q.text === 'string' ? q.text.trim() : ''
    if (!text) errors.push(`Question ${i + 1}: empty text`)

    const type: QuestionType = VALID_TYPES.includes(q.type) ? q.type : 'other'
    const isAiFollowup = q.is_ai_followup === true
    // Domain rules: AI follow-ups are always open-text; open_text type implies the flag
    const isOpenText = isAiFollowup || type === 'open_text' || q.is_open_text === true

    return {
      order_num: i + 1,
      text,
      section: typeof q.section === 'string' && q.section.trim() ? q.section.trim() : null,
      type,
      is_open_text: isOpenText,
      is_ai_followup: isAiFollowup,
      answer_options: Array.isArray(q.answer_options)
        ? q.answer_options.filter(o => typeof o === 'string')
        : [],
    }
  })

  return { ok: errors.length === 0, questions, errors }
}
