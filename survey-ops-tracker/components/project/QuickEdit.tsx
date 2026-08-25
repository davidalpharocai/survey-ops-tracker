'use client'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUpdateProject } from '@/lib/hooks/useProjects'
import { useTeamMembers } from '@/lib/hooks/useTeamMembers'
import { createClient } from '@/lib/supabase/client'
import { autoStamp } from '@/lib/utils/date'
import { useCanViewFinancials } from '@/lib/hooks/useCapabilities'
import {
  FIELD_LABELS, RESTRICTED_FIELDS, formatFieldValue, fieldsToUpdates, nRangeComplaint,
} from '@/lib/utils/quickFields'
import type { SurveyProject } from '@/lib/hooks/useProjects'

interface QuickEditProps {
  project: SurveyProject
}

export function QuickEdit({ project }: QuickEditProps) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<Record<string, unknown> | null>(null)
  const { data: teamMembers = [] } = useTeamMembers()
  // False until the check settles true, so a restricted figure can never be sent
  // to the model or painted in the preview while the answer is in flight.
  const canViewFinancials = useCanViewFinancials()
  const updateProject = useUpdateProject()
  const queryClient = useQueryClient()
  const supabase = createClient()

  async function parse() {
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/parse-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: text,
          mode: 'edit',
          current: {
            project_name: project.project_name,
            client: project.client,
            project_type: project.project_type,
            salesperson: project.salesperson,
            n_target: project.n_target,
            n_target_max: project.n_target_max,
            n_collected: project.n_collected,
            n_actual: project.n_actual,
            audience_size: project.audience_size,
            // The budget is a cost ceiling and restricted, so for a non-holder it
            // is left out of the context entirely — it used to be posted for every
            // user on every parse, which handed the ceiling to the model whatever
            // their capabilities. Actual spend is cost to run, public, and stays.
            // (The route scrubs this again on its side and drops `budget` from the
            // schema, so it can't come back either.)
            ...(canViewFinancials ? { budget: project.budget } : {}),
            actual_spend: project.actual_spend,
            due_date: project.due_date,
            launch_date: project.launch_date,
            board_column: project.board_column,
            scoping_stage: project.scoping_stage,
            phase: project.phase,
            status: project.status,
          },
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.fields) {
        setError(body?.error ?? 'Something went wrong. Please try again.')
        return
      }
      // Belt to the route's braces: never render a restricted field even if one
      // arrives (stale deploy, capability lost between parse and render).
      const entries = Object.entries(body.fields).filter(
        ([k, v]) => v != null && (canViewFinancials || !RESTRICTED_FIELDS.has(k))
      )
      if (entries.length === 0) {
        setError("I couldn't find any project details in that. Try being more specific.")
        return
      }
      setParsed(Object.fromEntries(entries))
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function approve() {
    if (!parsed) return
    // Pass the stored N range so a one-ended change ("bump N to 2,500") goes out
    // as a PAIR — migration 078's trigger only sees the columns the PATCH carries
    // and raises when the new min lands above the stored max.
    const updates = fieldsToUpdates(parsed, teamMembers, {
      n_target: project.n_target,
      n_target_max: project.n_target_max,
    })
    // A transposed range ("N target 2,500 to 2,000") is caught here, in the panel
    // that produced it, rather than coming back as a failed save — and nothing
    // else in this approval runs, so the note isn't logged against a change that
    // never happened.
    const complaint = nRangeComplaint(updates)
    if (complaint) {
      setError(complaint)
      return
    }
    if (typeof parsed.note === 'string' && parsed.note.trim()) {
      const { error } = await supabase.from('project_steps').insert({
        project_id: project.id,
        text: parsed.note.trim(),
        created_by: 'Quick edit',
      })
      if (error) {
        // Table missing (migration not applied yet) — fall back to the
        // legacy freeform notes so the note isn't lost.
        updates.latest_next_steps = autoStamp(
          'Quick edit',
          project.latest_next_steps,
          parsed.note.trim()
        )
      } else {
        queryClient.invalidateQueries({ queryKey: ['steps', project.id] })
      }
    }
    if (Object.keys(updates).length > 0) {
      updateProject.mutate({ id: project.id, updates })
    }
    reset()
  }

  function reset() {
    setParsed(null)
    setText('')
    setOpen(false)
    setError(null)
  }

  function currentValue(key: string): string {
    if (key === 'captain_name') return project.captain?.name ?? '—'
    if (key === 'note') return ''
    return formatFieldValue(key, (project as unknown as Record<string, unknown>)[key])
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left text-xs border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-ring px-3 py-1.5 rounded-lg transition-colors"
        title="Describe changes in plain English and review before saving"
      >
        ✦ Edit by description
      </button>
    )
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3 w-full">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium">
          ✦ Edit by description
        </span>
        <button onClick={reset} className="text-muted-foreground hover:text-foreground text-xs">
          ✕
        </button>
      </div>

      {!parsed && (
        <>
          <textarea
            autoFocus
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={'e.g. "collected is now 180, we\'ve spent 12.5k, due date pushed to July 20"'}
            rows={3}
            className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring resize-none"
          />
          <div className="flex justify-end">
            <button
              onClick={parse}
              disabled={busy || !text.trim()}
              className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg transition-colors"
            >
              {busy ? 'Reading…' : 'Preview changes'}
            </button>
          </div>
        </>
      )}

      {parsed && (
        <>
          <div className="flex flex-col gap-1.5">
            {Object.entries(parsed).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground w-32 shrink-0">
                  {FIELD_LABELS[key] ?? key}
                </span>
                {key === 'note' ? (
                  <span className="text-foreground/80 italic">&ldquo;{String(value)}&rdquo;</span>
                ) : (
                  <>
                    <span className="text-muted-foreground/60 line-through">
                      {currentValue(key)}
                    </span>
                    <span className="text-muted-foreground">→</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      {formatFieldValue(key, value)}
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setParsed(null)}
              className="text-xs text-muted-foreground hover:text-foreground px-3 py-2"
            >
              Back
            </button>
            <button
              onClick={approve}
              className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg transition-colors"
            >
              ✓ Approve changes
            </button>
          </div>
        </>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
