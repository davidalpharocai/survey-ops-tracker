'use client'
import type { DraftQuestion, QuestionType } from '@/lib/parsing/validate'

const TYPES: { value: QuestionType; label: string }[] = [
  { value: 'open_text', label: 'Open-text' },
  { value: 'single_select', label: 'Single-select' },
  { value: 'multi_select', label: 'Multi-select' },
  { value: 'scale', label: 'Scale' },
  { value: 'other', label: 'Other' },
]

type Props = {
  questions: DraftQuestion[]
  onChange: (questions: DraftQuestion[]) => void
}

export function QuestionPreviewEditor({ questions, onChange }: Props) {
  function update(i: number, patch: Partial<DraftQuestion>) {
    const next = questions.map((q, idx) => {
      if (idx !== i) return q
      const merged = { ...q, ...patch }
      // Keep domain rules live in the editor too
      if (merged.is_ai_followup || merged.type === 'open_text') merged.is_open_text = true
      return merged
    })
    onChange(next)
  }

  function remove(i: number) {
    onChange(questions.filter((_, idx) => idx !== i).map((q, idx) => ({ ...q, order_num: idx + 1 })))
  }

  function add() {
    onChange([
      ...questions,
      {
        order_num: questions.length + 1,
        text: '',
        section: null,
        type: 'open_text',
        is_open_text: true,
        is_ai_followup: false,
        answer_options: [],
      },
    ])
  }

  return (
    <div className="flex flex-col gap-2 max-h-96 overflow-y-auto pr-1">
      {questions.map((q, i) => (
        <div key={i} className="bg-slate-800/60 rounded-lg p-3 flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <span className="text-xs text-slate-500 pt-2 min-w-7">Q{q.order_num}</span>
            <textarea
              value={q.text}
              onChange={e => update(i, { text: e.target.value })}
              rows={2}
              aria-label={`Question ${q.order_num} text`}
              className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-md px-2 py-1.5 resize-y"
              placeholder="Question text"
            />
            <button
              onClick={() => remove(i)}
              className="text-slate-600 hover:text-red-400 transition-colors pt-2"
              aria-label={`Remove question ${q.order_num}`}
            >
              ✕
            </button>
          </div>
          <div className="flex items-center gap-3 pl-9 flex-wrap">
            <select
              value={q.type}
              onChange={e => update(i, { type: e.target.value as QuestionType })}
              aria-label={`Question ${q.order_num} type`}
              className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-md px-2 py-1"
            >
              {TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <label
              className="flex items-center gap-1.5 text-xs text-slate-400"
              title="Check when the question captures any free-text answer — including closed questions with an 'Other (please specify)' box. This flag drives compliance's open-text filter. Locked on automatically for Open-text and AI follow-up questions."
            >
              <input
                type="checkbox"
                checked={q.is_open_text}
                disabled={q.is_ai_followup || q.type === 'open_text'}
                onChange={e => update(i, { is_open_text: e.target.checked })}
              />
              Contains open text
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={q.is_ai_followup}
                onChange={e => update(i, { is_ai_followup: e.target.checked })}
              />
              AI follow-up
            </label>
          </div>
        </div>
      ))}
      <button
        onClick={add}
        className="text-xs border border-dashed border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 rounded-lg py-2 transition-colors"
      >
        + Add question
      </button>
    </div>
  )
}
