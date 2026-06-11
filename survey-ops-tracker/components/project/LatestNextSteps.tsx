'use client'
import { useState } from 'react'
import { useAddProjectUpdate, useUpdateProject } from '@/lib/hooks/useProjects'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'

interface LatestNextStepsProps {
  projectId: string
  notes: string | null
}

export function LatestNextSteps({ projectId, notes }: LatestNextStepsProps) {
  const [newText, setNewText] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const addUpdate = useAddProjectUpdate()
  const updateProject = useUpdateProject()
  const supabase = createClient()

  const { data: user } = useQuery({
    queryKey: ['auth-user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      return user
    },
    staleTime: Infinity,
  })

  function handleSave() {
    if (!newText.trim() || !user) return
    // Use email prefix as display name (e.g. "david" from "david@alpharoc.ai")
    const userName = user.email?.split('@')[0] ?? 'Unknown'
    addUpdate(projectId, notes, newText.trim(), userName)
    setNewText('')
  }

  function startEdit() {
    setDraft(notes ?? '')
    setEditing(true)
  }

  function saveEdit() {
    updateProject.mutate({
      id: projectId,
      updates: { latest_next_steps: draft.trim() || null },
    })
    setEditing(false)
  }

  const saveOnCtrlEnter = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) fn()
    if (e.key === 'Escape' && editing) setEditing(false)
  }

  return (
    <div className="bg-card rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs text-muted-foreground uppercase tracking-widest font-medium">
          Latest / Next Steps
        </h3>
        {notes && !editing && (
          <button
            onClick={startEdit}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            title="Edit the saved notes"
          >
            ✎ Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2 mb-4">
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={Math.min(14, Math.max(4, draft.split('\n').length + 1))}
            className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground resize-y focus:outline-none focus:border-ring transition-colors"
            onKeyDown={saveOnCtrlEnter(saveEdit)}
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={saveEdit}
              className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-lg transition-colors"
            >
              Save changes
            </button>
          </div>
        </div>
      ) : (
        notes && (
          <pre className="text-foreground/80 text-sm leading-relaxed whitespace-pre-wrap mb-4 font-sans">
            {notes}
          </pre>
        )
      )}

      <div className="flex gap-2">
        <textarea
          value={newText}
          onChange={e => setNewText(e.target.value)}
          placeholder="Add update... (auto-stamps date + your name)"
          rows={2}
          className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-ring transition-colors"
          onKeyDown={saveOnCtrlEnter(handleSave)}
        />
        <button
          onClick={handleSave}
          disabled={!newText.trim()}
          className="self-end bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs px-4 py-2 rounded-lg transition-colors"
        >
          Save
        </button>
      </div>
      <p className="text-xs text-muted-foreground/50 mt-1">Ctrl+Enter to save</p>
    </div>
  )
}
