'use client'
import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useUpdateProject } from '@/lib/hooks/useProjects'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'
import type { Tables, TablesUpdate } from '@/lib/supabase/types'

type Step = Tables<'project_steps'>

const DEFAULT_COMPLETED_SHOWN = 4

function useSteps(projectId: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['steps', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_steps')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as Step[]
    },
    staleTime: 30_000,
    // If the migration hasn't been applied the table doesn't exist —
    // fail once and show the fallback note instead of hammering retries.
    retry: false,
  })
}

// All step mutations update the UI instantly (optimistic) and reconcile
// with the database in the background; on failure the change rolls back.
function useStepMutations(projectId: string) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const key = ['steps', projectId]

  function optimistic(mutate: (steps: Step[]) => Step[]) {
    const previous = queryClient.getQueryData<Step[]>(key)
    queryClient.setQueryData<Step[]>(key, old => mutate(old ?? []))
    return previous
  }

  const add = useMutation({
    mutationFn: async ({ text, createdBy }: { text: string; createdBy: string }) => {
      const { error } = await supabase
        .from('project_steps')
        .insert({ project_id: projectId, text, created_by: createdBy })
      if (error) throw error
    },
    onMutate: async ({ text, createdBy }) => {
      await queryClient.cancelQueries({ queryKey: key })
      return optimistic(steps => [
        ...steps,
        {
          id: `optimistic-${Math.random().toString(36).slice(2)}`,
          project_id: projectId,
          text,
          done: false,
          created_by: createdBy,
          created_at: new Date().toISOString(),
          completed_at: null,
          completed_by: null,
        } as Step,
      ])
    },
    onError: (_e, _v, previous) => {
      queryClient.setQueryData(key, previous)
      toast("Couldn't add that step — it was removed.")
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  const update = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: TablesUpdate<'project_steps'> }) => {
      const { error } = await supabase.from('project_steps').update(updates).eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: key })
      return optimistic(steps =>
        steps.map(s => (s.id === id ? ({ ...s, ...updates } as Step) : s))
      )
    },
    onError: (_e, _v, previous) => {
      queryClient.setQueryData(key, previous)
      toast("Couldn't save that step — it was reverted.")
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_steps').delete().eq('id', id)
      if (error) throw error
    },
    onMutate: async id => {
      await queryClient.cancelQueries({ queryKey: key })
      return optimistic(steps => steps.filter(s => s.id !== id))
    },
    onError: (_e, _v, previous) => {
      queryClient.setQueryData(key, previous)
      toast("Couldn't delete that step — it was restored.")
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  return { add, update, remove }
}

function formatStepDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface LatestNextStepsProps {
  projectId: string
  notes: string | null
}

export function LatestNextSteps({ projectId, notes }: LatestNextStepsProps) {
  const supabase = createClient()
  const { data: steps, isError } = useSteps(projectId)
  const { add: addStep, update: updateStep, remove: deleteStep } = useStepMutations(projectId)
  const updateProject = useUpdateProject()

  const [newText, setNewText] = useState('')
  const [editingStepId, setEditingStepId] = useState<string | null>(null)
  const [stepDraft, setStepDraft] = useState('')
  // Escape must cancel a step edit, but it unmounts the input, whose blur would
  // otherwise fire saveStepEdit and commit the draft. This flag makes that blur no-op.
  const cancelEditRef = useRef(false)
  const [showAllCompleted, setShowAllCompleted] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')

  const { data: user } = useQuery({
    queryKey: ['auth-user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      return user
    },
    staleTime: Infinity,
  })
  // Use email prefix as display name (e.g. "david" from "david@alpharoc.ai")
  const userName = user?.email?.split('@')[0] ?? 'Unknown'

  const openSteps = (steps ?? []).filter(s => !s.done)
  const completedSteps = (steps ?? [])
    .filter(s => s.done)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
  const visibleCompleted = showAllCompleted
    ? completedSteps
    : completedSteps.slice(0, DEFAULT_COMPLETED_SHOWN)

  function handleAdd() {
    if (!newText.trim() || !user) return
    // optimistic — the item appears instantly, so clear the box right away
    addStep.mutate({ text: newText.trim(), createdBy: userName })
    setNewText('')
  }

  function toggleStep(step: Step) {
    updateStep.mutate({
      id: step.id,
      updates: step.done
        ? { done: false, completed_at: null, completed_by: null }
        : { done: true, completed_at: new Date().toISOString(), completed_by: userName },
    })
  }

  function startStepEdit(step: Step) {
    setEditingStepId(step.id)
    setStepDraft(step.text)
  }

  function saveStepEdit() {
    if (cancelEditRef.current) {
      cancelEditRef.current = false
      setEditingStepId(null)
      return
    }
    if (!editingStepId) return
    if (stepDraft.trim()) {
      updateStep.mutate({ id: editingStepId, updates: { text: stepDraft.trim() } })
    }
    setEditingStepId(null)
  }
  function cancelStepEdit() {
    cancelEditRef.current = true
    setEditingStepId(null)
  }

  function startNotesEdit() {
    setNotesDraft(notes ?? '')
    setEditingNotes(true)
  }

  function saveNotesEdit() {
    updateProject.mutate({
      id: projectId,
      updates: { latest_next_steps: notesDraft.trim() || null },
    })
    setEditingNotes(false)
  }

  const saveOnCtrlEnter = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) fn()
    if (e.key === 'Escape' && editingNotes) setEditingNotes(false)
  }

  const historyLines = notes ? notes.split('\n').length : 0

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-4">
      <div className="mb-3">
        <h3 className="text-xs text-muted-foreground uppercase tracking-widest font-medium">
          Latest / Next Steps
        </h3>
      </div>

      {isError ? (
        <p className="text-xs text-muted-foreground/70 mb-4">
          Next steps need the latest database migration.
        </p>
      ) : (
        <>
          {/* Open items */}
          {openSteps.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-muted-foreground/70 mb-1.5 flex items-center">
                Next Steps
                <InfoTooltip text="Open to-dos. The date shows when the item was added, and by whom." />
              </p>
              <div className="flex flex-col gap-1">
                {openSteps.map(step => (
                  <div key={step.id} className="group flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => toggleStep(step)}
                      className="mt-0.5 accent-blue-600 cursor-pointer shrink-0"
                      title="Mark done"
                    />
                    {editingStepId === step.id ? (
                      <input
                        autoFocus
                        value={stepDraft}
                        onChange={e => setStepDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveStepEdit()
                          if (e.key === 'Escape') cancelStepEdit()
                        }}
                        onBlur={saveStepEdit}
                        className="flex-1 bg-muted border border-border rounded px-2 py-0.5 text-sm text-foreground focus:outline-none focus:border-ring"
                      />
                    ) : (
                      <>
                        <span className="flex-1 text-sm text-foreground/90 leading-snug">
                          {step.text}{' '}
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            · {formatStepDate(step.created_at)}
                            {step.created_by ? ` · ${step.created_by}` : ''}
                          </span>
                        </span>
                        <button
                          onClick={() => startStepEdit(step)}
                          className="opacity-0 group-hover:opacity-100 text-xs text-muted-foreground hover:text-foreground transition-opacity shrink-0"
                          title="Edit step"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => deleteStep.mutate(step.id)}
                          className="opacity-0 group-hover:opacity-100 text-xs text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-opacity shrink-0"
                          title="Delete step"
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Completed log */}
          {completedSteps.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-muted-foreground/70 mb-1.5 flex items-center">
                Latest
                <InfoTooltip text="Completed items. The date shows when the item was checked off, and by whom." />
              </p>
              <div className="flex flex-col gap-1">
                {visibleCompleted.map(step => (
                  <div key={step.id} className="group flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked
                      onChange={() => toggleStep(step)}
                      className="mt-0.5 accent-blue-600 cursor-pointer shrink-0 opacity-50"
                      title="Move back to Next Steps"
                    />
                    <span className="flex-1 text-sm text-muted-foreground leading-snug">
                      ✓ {step.text}
                      <span className="text-xs text-muted-foreground/60">
                        {' '}
                        {step.completed_at && <>{formatStepDate(step.completed_at)}</>}
                        {step.completed_by && <> · {step.completed_by}</>}
                      </span>
                    </span>
                  </div>
                ))}
                {completedSteps.length > DEFAULT_COMPLETED_SHOWN && (
                  <button
                    onClick={() => setShowAllCompleted(s => !s)}
                    className="text-xs text-muted-foreground hover:text-foreground self-start transition-colors"
                  >
                    {showAllCompleted ? 'Show less' : `Show all ${completedSteps.length}`}
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Legacy freeform notes */}
      {notes && (
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setHistoryOpen(o => !o)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {historyOpen || isError ? '▾' : '▸'} History ({historyLines} {historyLines === 1 ? 'line' : 'lines'})
            </button>
            {(historyOpen || isError) && !editingNotes && (
              <button
                onClick={startNotesEdit}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                title="Edit the saved notes"
              >
                ✎ Edit
              </button>
            )}
          </div>
          {(historyOpen || isError) &&
            (editingNotes ? (
              <div className="flex flex-col gap-2 mt-2">
                <textarea
                  autoFocus
                  value={notesDraft}
                  onChange={e => setNotesDraft(e.target.value)}
                  rows={Math.min(14, Math.max(4, notesDraft.split('\n').length + 1))}
                  className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground resize-y focus:outline-none focus:border-ring transition-colors"
                  onKeyDown={saveOnCtrlEnter(saveNotesEdit)}
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setEditingNotes(false)}
                    className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveNotesEdit}
                    className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-lg transition-colors"
                  >
                    Save changes
                  </button>
                </div>
              </div>
            ) : (
              <pre className="text-foreground/90 text-sm leading-relaxed whitespace-pre-wrap mt-2 font-sans">
                {notes}
              </pre>
            ))}
        </div>
      )}

      {/* Add box */}
      {!isError && (
        <>
          <div className="flex gap-2">
            <textarea
              value={newText}
              onChange={e => setNewText(e.target.value)}
              placeholder="Add next step…"
              rows={2}
              className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-ring transition-colors"
              onKeyDown={saveOnCtrlEnter(handleAdd)}
            />
            <button
              onClick={handleAdd}
              disabled={!newText.trim() || addStep.isPending}
              className="self-end bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs px-4 py-2 rounded-lg transition-colors"
            >
              Save
            </button>
          </div>
          <p className="text-xs text-muted-foreground/50 mt-1">Ctrl+Enter to save</p>
        </>
      )}
    </div>
  )
}
