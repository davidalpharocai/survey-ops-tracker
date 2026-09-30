'use client'

/**
 * "Add as next step": puts a row's "What to do" on the survey's own next-step
 * list, so a decision taken on this page is not lost when the page is closed.
 *
 * ── THE SAME WRITE AS THE PROJECT PAGE ──────────────────────────────────────
 * It inserts into project_steps exactly as components/project/LatestNextSteps
 * does ({ project_id, text, created_by: the email prefix }), and invalidates the
 * same ['steps', id] query, so the step appears on the project page at once.
 * The connector's add_next_step writes the same row, so the page and Claude
 * stay at parity.
 *
 * ── CONFIRM, THEN VERIFY ────────────────────────────────────────────────────
 * Nothing is written until the reader confirms the exact text. The insert asks
 * for the new row back: a missing RLS policy fails SILENTLY (no error, no row),
 * so "no row came back" is reported as a failure rather than as success. An
 * identical open step already on the survey is reported instead of duplicated.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

type Stage = 'idle' | 'confirm' | 'saving' | 'done' | 'duplicate' | 'error'

export function AddNextStep({ projectId, code, text }: { projectId: string; code: string | null; text: string }) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const label = code ?? 'this study'

  const { data: user, isPending: userPending } = useQuery({
    queryKey: ['auth-user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      return user
    },
    staleTime: Infinity,
  })
  // The same display name the project page stamps (e.g. "david").
  const userName = user?.email?.split('@')[0] ?? null

  async function add() {
    if (!userName) {
      setError('You do not appear to be signed in')
      setStage('error')
      return
    }
    setStage('saving')
    setError(null)
    try {
      const { data: existing, error: readError } = await supabase
        .from('project_steps')
        .select('id')
        .eq('project_id', projectId)
        .eq('done', false)
        .eq('text', text)
        .limit(1)
      if (readError) throw readError
      if (existing && existing.length > 0) {
        setStage('duplicate')
        return
      }
      const { data, error: writeError } = await supabase
        .from('project_steps')
        .insert({ project_id: projectId, text, created_by: userName })
        .select('id')
      if (writeError) throw writeError
      if (!data || data.length === 0) {
        throw new Error('the database accepted the request but saved nothing (no permission to add steps)')
      }
      setStage('done')
      queryClient.invalidateQueries({ queryKey: ['steps', projectId] })
    } catch (e) {
      setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e))
      setStage('error')
    }
  }

  const button =
    'rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-muted ' +
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--chart-price)] disabled:opacity-50'

  if (stage === 'idle') {
    return (
      <button
        type="button"
        className={button}
        onClick={() => setStage('confirm')}
        title={`Adds "What to do" as an open next step on ${label} — the same list as its project page. You confirm the text first.`}
      >
        Add as next step
      </button>
    )
  }

  if (stage === 'confirm' || stage === 'saving') {
    return (
      <div role="group" aria-label={`Add a next step to ${label}`} className="mt-2 rounded-md border border-border bg-muted/40 p-2 text-xs">
        <p className="text-muted-foreground">Add this to {label}&rsquo;s next steps?</p>
        <p className="mt-1 text-foreground">&ldquo;{text}&rdquo;</p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className={button}
            onClick={add}
            disabled={stage === 'saving' || userPending}
            title="Writes the step now. It appears on the project page's Next Steps list."
          >
            {stage === 'saving' ? 'Adding…' : 'Add it'}
          </button>
          <button
            type="button"
            className={button}
            onClick={() => setStage('idle')}
            disabled={stage === 'saving'}
            title="Close without writing anything"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (stage === 'done' || stage === 'duplicate') {
    return (
      <p role="status" className="text-xs text-[var(--chart-keep)]">
        {stage === 'done' ? 'Added to ' : 'Already an open next step on '}
        <Link href={`/projects/${projectId}`} className="font-medium underline underline-offset-2">
          {label}
        </Link>
        {stage === 'done' ? '’s next steps.' : ' — nothing added.'}
      </p>
    )
  }

  return (
    <p role="alert" className="text-xs text-red-700 dark:text-red-400">
      Could not add it: {error}. Nothing was saved.{' '}
      <button type="button" className="underline underline-offset-2" onClick={() => setStage('confirm')}>
        Try again
      </button>
    </p>
  )
}
