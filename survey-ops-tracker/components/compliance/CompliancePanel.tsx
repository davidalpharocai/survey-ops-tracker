'use client'
import { useState } from 'react'
import { useSubmissions } from '@/lib/hooks/useSubmissions'
import { RecipientsManager } from './RecipientsManager'
import { SubmitQuestionsModal } from './SubmitQuestionsModal'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/utils/date'

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

export function CompliancePanel({ projectId }: { projectId: string }) {
  const { data: submissions = [] } = useSubmissions(projectId)
  const [modalOpen, setModalOpen] = useState(false)
  const latest = submissions[0]

  return (
    <div className="bg-slate-900 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs text-slate-400 uppercase tracking-widest font-medium">
          Compliance Review
        </h3>
        {latest && (
          <span className={`text-xs px-2 py-1 rounded ${STATUS_BADGE[latest.status]}`}>
            v{latest.version} · {STATUS_LABEL[latest.status]}
          </span>
        )}
      </div>

      {submissions.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-4">
          {submissions.map(s => (
            <div key={s.id} className="flex items-center justify-between text-xs bg-slate-800/50 rounded-lg px-3 py-2">
              <span className="text-slate-300">
                Version {s.version} · {formatDate(s.submitted_at)}
                {s.submitter_name && <span className="text-slate-500"> · {s.submitter_name}</span>}
              </span>
              <span className={`px-2 py-0.5 rounded ${STATUS_BADGE[s.status]}`}>
                {STATUS_LABEL[s.status]}
              </span>
            </div>
          ))}
          {latest?.status === 'rejected' && latest.review_note && (
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
          setModalOpen(true)
        }}
        disabled={latest?.status === 'pending_review'}
        className="w-full text-xs mb-4"
      >
        {latest?.status === 'pending_review'
          ? 'Awaiting compliance review'
          : latest
            ? 'Submit revised questions'
            : 'Submit questions for review'}
      </Button>

      <div className="border-t border-slate-800 pt-3">
        <RecipientsManager projectId={projectId} />
      </div>

      {modalOpen && <SubmitQuestionsModal projectId={projectId} onClose={() => setModalOpen(false)} />}
    </div>
  )
}
