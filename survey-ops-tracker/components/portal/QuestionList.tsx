'use client'
import { useState } from 'react'

export type PortalQuestion = {
  id: string
  order_num: number
  text: string
  type: 'open_text' | 'single_select' | 'multi_select' | 'scale' | 'other'
  is_open_text: boolean
  is_ai_followup: boolean
  section: string | null
  answer_options: string[]
}

const TYPE_LABEL: Record<PortalQuestion['type'], string> = {
  open_text: 'Open-text',
  single_select: 'Single-select',
  multi_select: 'Multi-select',
  scale: 'Scale',
  other: 'Other',
}

export function QuestionList({ questions }: { questions: PortalQuestion[] }) {
  const [filter, setFilter] = useState<'all' | 'open'>('all')
  const openCount = questions.filter(q => q.is_open_text).length
  const visible = filter === 'all' ? questions : questions.filter(q => q.is_open_text)

  const toggleClass = (active: boolean) =>
    `text-xs px-3 py-1.5 rounded-lg border transition-colors ${
      active
        ? 'bg-blue-500/20 text-blue-400 border-blue-500/40'
        : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:border-slate-400 dark:hover:border-slate-500'
    }`

  let lastSection: string | null = null

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button aria-pressed={filter === 'all'} className={toggleClass(filter === 'all')} onClick={() => setFilter('all')}>
          All questions ({questions.length})
        </button>
        <button aria-pressed={filter === 'open'} className={toggleClass(filter === 'open')} onClick={() => setFilter('open')}>
          Open-text only ({openCount})
        </button>
      </div>
      <div className="flex flex-col">
        {visible.map(q => {
          const showSection = q.section !== null && q.section !== lastSection
          if (q.section !== null) lastSection = q.section
          return (
            <div key={q.id}>
              {showSection && (
                <p className="text-xs text-slate-500 dark:text-slate-500 uppercase tracking-widest mt-4 mb-2">
                  {q.section}
                </p>
              )}
              <div className="flex gap-3 py-3 border-b border-slate-200 dark:border-slate-800">
                <span className="text-xs text-slate-500 min-w-8 pt-0.5">Q{q.order_num}</span>
                <div className="flex-1">
                  <p className="text-sm text-slate-800 dark:text-slate-200">{q.text}</p>
                  {q.answer_options.length > 0 && (
                    <p className="text-xs text-slate-500 mt-1">
                      <span className="text-slate-400 dark:text-slate-600">Options:</span>{' '}
                      {q.answer_options.join(' · ')}
                    </p>
                  )}
                  <div className="flex gap-2 mt-1.5 flex-wrap">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        q.is_open_text
                          ? 'bg-violet-500/20 text-violet-400'
                          : 'bg-slate-200/80 dark:bg-slate-700/40 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {TYPE_LABEL[q.type]}
                    </span>
                    {q.is_ai_followup && (
                      <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                        AI follow-up
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
