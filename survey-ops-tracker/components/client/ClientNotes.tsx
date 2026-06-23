'use client'
import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { useClientNotes, useClientNoteMutations } from '@/lib/hooks/useClientNotes'

function formatNoteDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function ClientNotes({ clientId }: { clientId: string }) {
  const supabase = createClient()
  const { data: notes = [], isError } = useClientNotes(clientId)
  const { add, update, remove } = useClientNoteMutations(clientId)
  const [newText, setNewText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // Escape must cancel an edit, but it unmounts the textarea, whose blur would
  // otherwise fire saveEdit and commit the draft. This flag makes that blur no-op.
  const cancelEditRef = useRef(false)

  const { data: user } = useQuery({
    queryKey: ['auth-user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      return user
    },
    staleTime: Infinity,
  })
  // Email prefix as display name (e.g. "david" from "david@alpharoc.ai"), same
  // as the project Latest/Next Steps log.
  const userName = user?.email?.split('@')[0] ?? 'Unknown'

  function handleAdd() {
    if (!newText.trim() || !user) return
    add.mutate({ body: newText.trim(), createdBy: userName })
    setNewText('')
  }
  function saveEdit() {
    if (cancelEditRef.current) {
      cancelEditRef.current = false
      setEditingId(null)
      return
    }
    if (editingId && draft.trim()) update.mutate({ id: editingId, body: draft.trim() })
    setEditingId(null)
  }
  function cancelEdit() {
    cancelEditRef.current = true
    setEditingId(null)
  }

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col gap-3">
      <h3 className="text-xs text-muted-foreground uppercase tracking-widest font-medium flex items-center">
        Notes
        <InfoTooltip text="Free-text notes about this client — context, preferences, account history. Each note is dated and tagged with who added it. Newest first; hover a note to edit or remove it." />
      </h3>

      {isError ? (
        <p className="text-xs text-muted-foreground/70">Notes need the latest database migration.</p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">No notes yet — add context about this client below.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {notes.map(n => (
            <li key={n.id} className="group flex items-start gap-2 text-sm">
              <span className="text-muted-foreground/50 mt-0.5 shrink-0">•</span>
              {editingId === n.id ? (
                <textarea
                  autoFocus
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  rows={2}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveEdit()
                    if (e.key === 'Escape') cancelEdit()
                  }}
                  onBlur={saveEdit}
                  className="flex-1 bg-muted border border-border rounded px-2 py-1 text-sm text-foreground resize-y focus:outline-none focus:border-ring"
                />
              ) : (
                <>
                  <span className="flex-1 text-foreground/90 leading-snug whitespace-pre-wrap">
                    {n.body}
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {' '}· {formatNoteDate(n.created_at)}
                      {n.created_by ? ` · ${n.created_by}` : ''}
                    </span>
                  </span>
                  <button
                    onClick={() => {
                      setEditingId(n.id)
                      setDraft(n.body)
                    }}
                    className="opacity-0 group-hover:opacity-100 text-xs text-muted-foreground hover:text-foreground transition-opacity shrink-0"
                    title="Edit note"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => remove.mutate(n.id)}
                    className="opacity-0 group-hover:opacity-100 text-xs text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-opacity shrink-0"
                    title="Delete note"
                  >
                    ✕
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {!isError && (
        <div>
          <div className="flex gap-2">
            <textarea
              value={newText}
              onChange={e => setNewText(e.target.value)}
              placeholder="Add a note…"
              rows={2}
              className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-ring transition-colors"
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAdd()
              }}
            />
            <button
              onClick={handleAdd}
              disabled={!newText.trim() || add.isPending}
              className="self-end bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs px-4 py-2 rounded-lg transition-colors"
            >
              Save
            </button>
          </div>
          <p className="text-xs text-muted-foreground/50 mt-1">Ctrl+Enter to save</p>
        </div>
      )}
    </div>
  )
}
