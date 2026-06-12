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
      // Derive is_open_text when type or is_ai_followup changes
      if ('type' in patch || 'is_ai_followup' in patch) {
        merged.is_open_text = merged.type === 'open_text' || merged.is_ai_followup
      }
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
        <div key={i} className="bg-muted/50 rounded-lg p-3 flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <span className="text-xs text-muted-foreground pt-2 min-w-7">Q{q.order_num}</span>
            <textarea
              value={q.text}
              onChange={e => update(i, { text: e.target.value })}
              onBlur={() => {
                // Analysts often paste the question with its options on the
                // lines below — split them into the options field on click-out
                // so the preview matches what compliance will see. (The server
                // applies the same rule at submit as a backstop.)
                if (q.type !== 'open_text' && q.answer_options.length === 0 && q.text.includes('\n')) {
                  const lines = q.text.split('\n').map(l => l.trim()).filter(Boolean)
                  if (lines.length >= 2) {
                    update(i, { text: lines[0], answer_options: lines.slice(1) })
                  }
                }
              }}
              rows={2}
              aria-label={`Question ${q.order_num} text`}
              className="flex-1 bg-background border border-input text-foreground text-sm rounded-md px-2 py-1.5 resize-y"
              placeholder="Question text"
            />
            <button
              onClick={() => remove(i)}
              className="text-muted-foreground/50 hover:text-red-600 dark:hover:text-red-400 transition-colors pt-2"
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
              className="bg-background border border-input text-foreground text-xs rounded-md px-2 py-1"
            >
              {TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <label
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              title="Set automatically: open-text questions and AI follow-ups capture free-text answers. This drives compliance's open-text filter."
            >
              <input
                type="checkbox"
                checked={q.is_open_text}
                disabled
              />
              Contains open text
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={q.is_ai_followup}
                onChange={e => update(i, { is_ai_followup: e.target.checked })}
              />
              AI follow-up
            </label>
          </div>
          {q.type !== 'open_text' && (
            <div className="pl-9">
              {/* Uncontrolled + commit on blur: live parsing would eat commas as
                  the user types them. Key includes the options so the field
                  refreshes when a blur-split moves options out of the text. */}
              <input
                key={`opts-${i}-${questions.length}-${q.answer_options.join('|')}`}
                type="text"
                defaultValue={q.answer_options.join(', ')}
                onBlur={e =>
                  update(i, {
                    answer_options: e.target.value
                      .split(',')
                      .map(o => o.trim())
                      .filter(Boolean),
                  })
                }
                aria-label={`Question ${q.order_num} answer options`}
                placeholder="Answer options, comma-separated (e.g. Yes, No)"
                className="w-full bg-background border border-input text-foreground text-xs rounded-md px-2 py-1.5 placeholder:text-muted-foreground/60"
              />
            </div>
          )}
        </div>
      ))}
      <button
        onClick={add}
        className="text-xs border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 rounded-lg py-2 transition-colors"
      >
        + Add question
      </button>
    </div>
  )
}
