'use client'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUpdateProject } from '@/lib/hooks/useProjects'
import { useTeamMembers } from '@/lib/hooks/useTeamMembers'
import { createClient } from '@/lib/supabase/client'
import { autoStamp } from '@/lib/utils/date'
import { FIELD_LABELS, formatFieldValue, fieldsToUpdates } from '@/lib/utils/quickFields'
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
            n_collected: project.n_collected,
            n_actual: project.n_actual,
            audience_size: project.audience_size,
            budget: project.budget,
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
      const entries = Object.entries(body.fields).filter(([, v]) => v != null)
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
    const updates = fieldsToUpdates(parsed, teamMembers)
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
        className="text-xs border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-ring px-3 py-1.5 rounded-lg transition-colors"
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
