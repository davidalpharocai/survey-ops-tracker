'use client'
import { useState, useEffect, useRef } from 'react'
import { useSubmissions, useInvalidateCompliance } from '@/lib/hooks/useSubmissions'
import { RecipientsManager } from './RecipientsManager'
import { SubmitQuestionsModal } from './SubmitQuestionsModal'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/utils/date'
import type { DraftQuestion } from '@/lib/parsing/validate'

const STATUS_BADGE: Record<string, string> = {
  pending_review: 'bg-amber-500/20 text-amber-400',
  approved: 'bg-emerald-500/20 text-emerald-400',
  rejected: 'bg-red-500/20 text-red-400',
}
const STATUS_LABEL: Record<string, string> = {
  pending_review: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
}

const RECALL_WINDOW_MS = 60_000

function useCountdown(submittedAt: string) {
  const [remaining, setRemaining] = useState(() => {
    const elapsed = Date.now() - new Date(submittedAt).getTime()
    return Math.max(0, RECALL_WINDOW_MS - elapsed)
  })

  useEffect(() => {
    if (remaining <= 0) return
    const interval = setInterval(() => {
      const elapsed = Date.now() - new Date(submittedAt).getTime()
      setRemaining(Math.max(0, RECALL_WINDOW_MS - elapsed))
    }, 1000)
    return () => clearInterval(interval)
  }, [submittedAt, remaining])

  return remaining
}

function CountdownRow({
  submissionId,
  submittedAt,
  projectId,
  onRecalled,
}: {
  submissionId: string
  submittedAt: string
  projectId: string
  onRecalled: (questions: DraftQuestion[], sourceFileName: string, sourceFilePath: string) => void
}) {
  const remaining = useCountdown(submittedAt)
  const invalidate = useInvalidateCompliance(projectId)
  const dispatchFiredRef = useRef(false)
  const [dispatchError, setDispatchError] = useState('')
  const [recalling, setRecalling] = useState(false)
  const [recallError, setRecallError] = useState('')

  // Auto-dispatch when countdown hits zero
  useEffect(() => {
    if (remaining <= 0 && !dispatchFiredRef.current) {
      dispatchFiredRef.current = true
      dispatch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining])

  async function dispatch() {
    setDispatchError('')
    try {
      const res = await fetch(`/api/submissions/${submissionId}/dispatch`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setDispatchError(body.error ?? 'Failed to send to compliance')
      }
      // Whether ok or alreadyDispatched, invalidate so panel refreshes
      invalidate()
    } catch {
      setDispatchError('Network error — click "Send now" to retry')
    }
  }

  async function handleRecall() {
    setRecalling(true)
    setRecallError('')
    try {
      const res = await fetch(`/api/submissions/${submissionId}/recall`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (res.status === 409) {
        setRecallError(body.error ?? 'Recall window has passed')
        invalidate()
        setRecalling(false)
        return
      }
      if (!res.ok) {
        setRecallError(body.error ?? 'Recall failed')
        setRecalling(false)
        return
      }
      // Pass recalled data back up so parent can open the modal pre-filled
      onRecalled(body.questions, body.sourceFileName, body.sourceFilePath)
      invalidate()
    } catch {
      setRecallError('Network error during recall')
      setRecalling(false)
    }
  }

  const secs = Math.ceil(remaining / 1000)
  const display = `0:${String(secs).padStart(2, '0')}`

  return (
    <div className="flex flex-col gap-2 mb-4">
      <div className="flex items-center justify-between text-xs bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
        {remaining > 0 ? (
          <span className="text-amber-400">Sending to compliance in {display}</span>
        ) : (
          <span className="text-amber-400">Sending to compliance…</span>
        )}
        {remaining > 0 && (
          <button
            onClick={handleRecall}
            disabled={recalling}
            className="text-xs border border-red-500/40 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {recalling ? 'Recalling…' : 'Recall'}
          </button>
        )}
      </div>
      {dispatchError && (
        <div className="flex items-center gap-2">
          <p className="text-xs text-red-400 flex-1">{dispatchError}</p>
          <button
            onClick={() => { dispatchFiredRef.current = false; dispatch() }}
            className="text-xs border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 px-2 py-1 rounded transition-colors"
          >
            Send now
          </button>
        </div>
      )}
      {recallError && (
        <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{recallError}</p>
      )}
    </div>
  )
}

export function CompliancePanel({ projectId }: { projectId: string }) {
  const { data: submissions = [] } = useSubmissions(projectId)
  const invalidate = useInvalidateCompliance(projectId)
  const [modalOpen, setModalOpen] = useState(false)
  const [recallData, setRecallData] = useState<{
    questions: DraftQuestion[]
    sourceFileName: string
    sourceFilePath: string
  } | null>(null)

  const latest = submissions[0]
  const latestIsUndispatched = latest?.dispatched_at === null

  function handleRecalled(questions: DraftQuestion[], sourceFileName: string, sourceFilePath: string) {
    setRecallData({ questions, sourceFileName, sourceFilePath })
    setModalOpen(true)
    invalidate()
  }

  return (
    <div className="bg-slate-900 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs text-slate-400 uppercase tracking-widest font-medium flex items-center">
          Compliance Review
          <InfoTooltip text="Submit the survey's question list for the client's compliance team to review and approve before launch. After you hit send there's a 60-second window to recall and edit before anything is visible to the client. Reviewers get an email with a one-click review link; you'll be notified when they approve or reject." />
        </h3>
        {latest && (
          <span className={`text-xs px-2 py-1 rounded ${latestIsUndispatched ? 'bg-amber-500/20 text-amber-400' : STATUS_BADGE[latest.status]}`}>
            {latestIsUndispatched
              ? `v${latest.version} · Sending…`
              : `v${latest.version} · ${STATUS_LABEL[latest.status]}`}
          </span>
        )}
      </div>

      {latestIsUndispatched && (
        <CountdownRow
          submissionId={latest.id}
          submittedAt={latest.submitted_at}
          projectId={projectId}
          onRecalled={handleRecalled}
        />
      )}

      {submissions.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-4">
          {submissions.map(s => {
            // Skip the undispatched latest from the history list — it's shown above
            if (s.id === latest?.id && latestIsUndispatched) return null
            return (
              <div key={s.id} className="flex items-center justify-between text-xs bg-slate-800/50 rounded-lg px-3 py-2">
                <span className="text-slate-300">
                  Version {s.version} · {formatDate(s.submitted_at)}
                  {s.submitter_name && <span className="text-slate-500"> · {s.submitter_name}</span>}
                </span>
                <span className={`px-2 py-0.5 rounded ${STATUS_BADGE[s.status]}`}>
                  {STATUS_LABEL[s.status]}
                </span>
              </div>
            )
          })}
          {latest?.status === 'rejected' && latest.review_note && !latestIsUndispatched && (
            <p className="text-xs text-red-400/80 bg-red-400/10 rounded-lg px-3 py-2">
              Reviewer note: {latest.review_note}
            </p>
          )}
        </div>
      )}

      <Button
        onClick={() => {
          if (latest?.status === 'approved' &&
              !window.confirm('This project already has an approved question list. Submitting a new version will supersede the approval and require compliance to review again. Continue?')) {
            return
          }
          setRecallData(null)
          setModalOpen(true)
        }}
        disabled={latest?.status === 'pending_review' || latestIsUndispatched}
        className="w-full text-xs mb-4"
      >
        {latest?.status === 'pending_review'
          ? 'Awaiting compliance review'
          : latestIsUndispatched
            ? 'Sending to compliance…'
            : latest
              ? 'Submit revised questions'
              : 'Submit questions for review'}
      </Button>

      <div className="border-t border-slate-800 pt-3">
        <RecipientsManager projectId={projectId} />
      </div>

      {modalOpen && (
        <SubmitQuestionsModal
          projectId={projectId}
          onClose={() => { setModalOpen(false); setRecallData(null) }}
          initialQuestions={recallData?.questions}
          initialSourceFileName={recallData?.sourceFileName}
          initialSourceFilePath={recallData?.sourceFilePath}
        />
      )}
    </div>
  )
}
