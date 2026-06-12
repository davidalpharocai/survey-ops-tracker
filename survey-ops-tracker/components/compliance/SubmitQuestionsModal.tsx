'use client'
import { useState } from 'react'
import type { DraftQuestion } from '@/lib/parsing/validate'
import { QuestionPreviewEditor } from './QuestionPreviewEditor'
import { useInvalidateCompliance } from '@/lib/hooks/useSubmissions'
import { Button } from '@/components/ui/button'

type Stage = 'upload' | 'parsing' | 'preview' | 'submitting'

export function SubmitQuestionsModal({
  projectId,
  onClose,
  initialQuestions,
  initialSourceFileName,
  initialSourceFilePath,
  initialMessage,
}: {
  projectId: string
  onClose: () => void
  initialQuestions?: DraftQuestion[]
  initialSourceFileName?: string
  initialSourceFilePath?: string
  initialMessage?: string
}) {
  // If initial data provided (e.g. from recall), start in preview with that state
  const [stage, setStage] = useState<Stage>(() =>
    initialQuestions && initialQuestions.length > 0 ? 'preview' : 'upload'
  )
  const [questions, setQuestions] = useState<DraftQuestion[]>(() => initialQuestions ?? [])
  const [sourceFileName, setSourceFileName] = useState(() => initialSourceFileName ?? '')
  const [sourceFilePath, setSourceFilePath] = useState(() => initialSourceFilePath ?? '')
  const [message, setMessage] = useState(() => initialMessage ?? '')
  const [error, setError] = useState('')
  const invalidate = useInvalidateCompliance(projectId)

  async function handleFile(file: File) {
    setStage('parsing')
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('projectId', projectId)
      const res = await fetch('/api/parse-questionnaire', { method: 'POST', body: formData })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Parse failed but file may be stored — allow manual entry fallback
        if (body.sourceFilePath) {
          setSourceFileName(body.sourceFileName)
          setSourceFilePath(body.sourceFilePath)
          setQuestions([])
          setError(`${body.error ?? 'Parse failed'} — you can enter questions manually below.`)
          setStage('preview')
        } else {
          setError(body.error ?? 'Upload failed')
          setStage('upload')
        }
        return
      }
      setQuestions(body.questions)
      setSourceFileName(body.sourceFileName)
      setSourceFilePath(body.sourceFilePath)
      if (Array.isArray(body.warnings) && body.warnings.length > 0) {
        setError(`Heads up: ${body.warnings.join('; ')}`)
      }
      setStage('preview')
    } catch {
      setError('Network error during upload — please try again.')
      setStage('upload')
    }
  }

  async function handleSubmit() {
    if (questions.length === 0 || questions.some(q => !q.text.trim())) {
      setError('Every question needs text, and at least one question is required.')
      return
    }
    setStage('submitting')
    setError('')
    try {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, sourceFileName, sourceFilePath, questions, message: message.trim() || undefined }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Submission failed')
        setStage('preview')
        return
      }
      // Submission created — close and let the panel countdown row appear
      invalidate()
      onClose()
    } catch {
      setError('Network error — the submission may not have been created. Please check before retrying.')
      setStage('preview')
    }
  }

  const openCount = questions.filter(q => q.is_open_text).length

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div role="dialog" aria-modal="true" aria-label="Submit questions for compliance review" className="bg-card border border-border rounded-xl p-5 w-full max-w-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-foreground">Submit questions for compliance review</h3>
          <button onClick={onClose} disabled={stage === 'submitting' || stage === 'parsing'} className="text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed" aria-label="Close">✕</button>
        </div>

        {stage === 'upload' && (
          <div>
            <label className="block border border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-muted-foreground/50 transition-colors">
              <input
                type="file"
                accept=".docx,.xlsx,.xls,.csv,.pdf"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) handleFile(file)
                }}
              />
              <p className="text-sm text-foreground">Upload the questionnaire</p>
              <p className="text-xs text-muted-foreground mt-1">.docx, .xlsx, .csv, or .pdf — Google Docs: export first; legacy .doc: re-save as .docx</p>
            </label>
            {error && <p role="alert" className="text-red-600 dark:text-red-400 text-sm mt-3">{error}</p>}
          </div>
        )}

        {stage === 'parsing' && (
          <p className="text-sm text-muted-foreground py-10 text-center">
            Extracting questions with AI… this can take up to a minute for long questionnaires.
          </p>
        )}

        {(stage === 'preview' || stage === 'submitting') && (
          <div>
            <p className="text-xs text-muted-foreground mb-3">
              {questions.length} questions · {openCount} open-text — check the AI&apos;s work, especially
              open-text flags, then send to compliance.
            </p>
            <QuestionPreviewEditor questions={questions} onChange={setQuestions} />
            <div className="mt-4">
              <label className="block text-xs text-muted-foreground mb-1.5">
                Message to compliance <span className="text-muted-foreground/70">(optional)</span>
              </label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="e.g. Hi team — wave 3 of the cruise study, two new questions since the approved wave 2 list."
                maxLength={2000}
                rows={2}
                disabled={stage === 'submitting'}
                className="w-full bg-background border border-input text-foreground text-sm rounded-md px-3 py-2 resize-y placeholder:text-muted-foreground/60 focus:outline-none focus:border-blue-500 disabled:opacity-50"
              />
            </div>
            {error && <p role="alert" className="text-amber-600 dark:text-amber-400 text-sm mt-3">{error}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={onClose} disabled={stage === 'submitting'}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={stage === 'submitting'}>
                {stage === 'submitting' ? 'Sending…' : 'Send to compliance'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
