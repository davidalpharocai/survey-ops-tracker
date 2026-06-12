'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { toast } from '@/lib/utils/toast'

interface DataChange {
  id: string
  project_id: string
  text: string
  created_by: string | null
  created_at: string
  edited_at: string | null
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Optimistic mutations — entries appear/update/disappear instantly,
// reconcile with the database in the background, roll back on failure
function useDataChanges(projectId: string) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const key = ['data-changes', projectId]

  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_data_changes')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as DataChange[]
    },
    staleTime: 30_000,
    retry: false,
  })

  function optimistic(mutate: (rows: DataChange[]) => DataChange[]) {
    const previous = queryClient.getQueryData<DataChange[]>(key)
    queryClient.setQueryData<DataChange[]>(key, old => mutate(old ?? []))
    return previous
  }

  const add = useMutation({
    mutationFn: async ({ text, createdBy }: { text: string; createdBy: string }) => {
      const { error } = await supabase
        .from('project_data_changes')
        .insert({ project_id: projectId, text, created_by: createdBy })
      if (error) throw error
    },
    onMutate: async ({ text, createdBy }) => {
      await queryClient.cancelQueries({ queryKey: key })
      return optimistic(rows => [
        {
          id: `optimistic-${Math.random().toString(36).slice(2)}`,
          project_id: projectId,
          text,
          created_by: createdBy,
          created_at: new Date().toISOString(),
          edited_at: null,
        },
        ...rows,
      ])
    },
    onError: (_e, _v, prev) => {
      queryClient.setQueryData(key, prev)
      toast("Couldn't log that change — it was removed.")
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  const update = useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      const { error } = await supabase
        .from('project_data_changes')
        .update({ text, edited_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, text }) => {
      await queryClient.cancelQueries({ queryKey: key })
      return optimistic(rows =>
        rows.map(r => (r.id === id ? { ...r, text, edited_at: new Date().toISOString() } : r))
      )
    },
    onError: (_e, _v, prev) => {
      queryClient.setQueryData(key, prev)
      toast("Couldn't save that edit — it was reverted.")
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_data_changes').delete().eq('id', id)
      if (error) throw error
    },
    onMutate: async id => {
      await queryClient.cancelQueries({ queryKey: key })
      return optimistic(rows => rows.filter(r => r.id !== id))
    },
    onError: (_e, _v, prev) => {
      queryClient.setQueryData(key, prev)
      toast("Couldn't delete that entry — it was restored.")
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  return { query, add, update, remove }
}

export function DataChangeLog({ projectId }: { projectId: string }) {
  const supabase = createClient()
  const { query, add, update, remove } = useDataChanges(projectId)
  const [newText, setNewText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const { data: user } = useQuery({
    queryKey: ['auth-user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      return user
    },
    staleTime: Infinity,
  })
  const userName = user?.email?.split('@')[0] ?? 'Unknown'

  function handleAdd() {
    if (!newText.trim() || !user) return
    add.mutate({ text: newText.trim(), createdBy: userName })
    setNewText('')
  }

  function saveEdit() {
    if (!editingId || !draft.trim()) {
      setEditingId(null)
      return
    }
    update.mutate({ id: editingId, text: draft.trim() })
    setEditingId(null)
  }

  const changes = query.data ?? []

  return (
    <div className="bg-card rounded-xl p-4">
      <h3 className="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center">
        Data Change Log
        <InfoTooltip text="A record of manual data changes made to this project's survey data — log what you changed so the team has a paper trail. Stamped with date and author." />
      </h3>

      {query.isError ? (
        <p className="text-xs text-muted-foreground/70 mb-3">
          The data change log needs the latest database migration.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5 mb-3">
          {changes.length === 0 && (
            <p className="text-xs text-muted-foreground/50">No data changes logged yet.</p>
          )}
          {changes.map(c =>
            editingId === c.id ? (
              <div key={c.id} className="flex gap-2">
                <input
                  autoFocus
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveEdit()
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="flex-1 bg-muted border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-ring"
                />
                <button
                  onClick={saveEdit}
                  className="text-xs bg-muted hover:bg-accent text-foreground px-2 py-1 rounded transition-colors"
                >
                  Save
                </button>
              </div>
            ) : confirmingId === c.id ? (
              <div key={c.id} className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
                <span className="text-xs text-red-700 dark:text-red-400 flex-1">
                  Delete this entry? This can&apos;t be undone.
                </span>
                <button
                  onClick={() => {
                    remove.mutate(c.id)
                    setConfirmingId(null)
                  }}
                  className="text-xs bg-red-600 hover:bg-red-500 text-white px-2 py-0.5 rounded transition-colors"
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirmingId(null)}
                  className="text-xs text-muted-foreground hover:text-foreground px-1"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div key={c.id} className="flex items-start gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 w-28 pt-0.5">
                  {formatWhen(c.created_at)}
                  {c.created_by ? ` · ${c.created_by}` : ''}
                </span>
                <span className="flex-1 text-sm text-foreground/90 leading-snug min-w-0">
                  {c.text}
                  {c.edited_at ? (
                    <span className="text-xs text-muted-foreground"> · edited</span>
                  ) : null}
                </span>
                <button
                  onClick={() => {
                    setDraft(c.text)
                    setEditingId(c.id)
                  }}
                  title="Edit entry"
                  className="text-muted-foreground/50 hover:text-foreground text-xs shrink-0"
                >
                  ✎
                </button>
                <button
                  onClick={() => setConfirmingId(c.id)}
                  title="Delete entry"
                  className="text-muted-foreground/50 hover:text-red-600 dark:hover:text-red-400 text-xs shrink-0"
                >
                  ✕
                </button>
              </div>
            )
          )}
        </div>
      )}

      {!query.isError && (
        <>
          <div className="flex gap-2">
            <textarea
              value={newText}
              onChange={e => setNewText(e.target.value)}
              placeholder="Log a data change… (e.g. removed 4 speeders from SV-2201)"
              rows={2}
              className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-ring transition-colors"
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAdd()
              }}
            />
            <button
              onClick={handleAdd}
              disabled={!newText.trim()}
              className="self-end bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs px-4 py-2 rounded-lg transition-colors"
            >
              Log
            </button>
          </div>
          <p className="text-xs text-muted-foreground/50 mt-1">Ctrl+Enter to save · stamps date + your name</p>
        </>
      )}
    </div>
  )
}
