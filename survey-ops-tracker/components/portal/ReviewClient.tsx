'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { QuestionList, type PortalQuestion } from './QuestionList'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type Props = {
  submissionId: string
  status: 'pending_review' | 'approved' | 'rejected'
  reviewNote: string | null
  questions: PortalQuestion[]
}

export function ReviewClient({ submissionId, status, reviewNote, questions }: Props) {
  const router = useRouter()
  const [confirming, setConfirming] = useState<'approved' | 'rejected' | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submitDecision() {
    if (!confirming) return
    if (confirming === 'rejected' && !note.trim()) {
      setError('Please explain why you are rejecting so AlphaRoc can revise.')
      return
    }
    setBusy(true)
    setError('')
    const res = await fetch(`/api/submissions/${submissionId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: confirming, note: note.trim() || undefined }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Something went wrong — please try again.')
      return
    }
    router.refresh()
  }

  if (status !== 'pending_review') {
    return (
      <div>
        <div
          className={`rounded-xl border px-4 py-3 mb-6 text-sm ${
            status === 'approved'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          You {status === 'approved' ? 'approved' : 'rejected'} this question list.
          {reviewNote && <span className="block mt-1 text-slate-400">Note: {reviewNote}</span>}
        </div>
        <QuestionList questions={questions} />
      </div>
    )
  }

  return (
    <div>
      <QuestionList questions={questions} />

      {confirming ? (
        <div className="sticky bottom-4 mt-6 bg-slate-900 border border-slate-700 rounded-xl p-4">
          <p className="text-sm text-white mb-2">
            {confirming === 'approved' ? 'Approve' : 'Reject'} all {questions.length} questions?
          </p>
          <Textarea
            placeholder={confirming === 'rejected' ? 'What needs to change? (required)' : 'Optional note'}
            value={note}
            onChange={e => setNote(e.target.value)}
            className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 mb-3"
          />
          {error && (
            <p className="text-red-400 text-sm bg-red-400/10 px-3 py-2 rounded-lg mb-3">{error}</p>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => { setConfirming(null); setError('') }} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitDecision} disabled={busy}>
              {busy ? 'Submitting...' : `Confirm ${confirming === 'approved' ? 'approval' : 'rejection'}`}
            </Button>
          </div>
        </div>
      ) : (
        <div className="sticky bottom-4 mt-6 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 flex items-center justify-between">
          <p className="text-xs text-slate-500">Your decision applies to all {questions.length} questions</p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirming('rejected')}
              className="text-xs border border-red-500/40 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg transition-colors"
            >
              ✕ Reject
            </button>
            <button
              onClick={() => setConfirming('approved')}
              className="text-xs border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 px-3 py-1.5 rounded-lg transition-colors"
            >
              ✓ Approve
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
