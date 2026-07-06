'use client'
import { useRef, useState } from 'react'
import { useRenameClient } from '@/lib/hooks/useClients'

// The client-page title, click-to-edit. Renaming updates the client record and
// (via the hook) the denormalized name on the client's projects.
export function ClientNameHeading({ id, name }: { id: string; name: string }) {
  const rename = useRenameClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  // Escape must cancel, but it unmounts the input, whose blur would otherwise
  // fire save and commit the draft. This flag makes that blur no-op.
  const cancelRef = useRef(false)

  function start() {
    setDraft(name)
    setEditing(true)
  }
  function save() {
    if (cancelRef.current) {
      cancelRef.current = false
      setEditing(false)
      return
    }
    setEditing(false)
    const next = draft.trim()
    if (next && next !== name) rename.mutate({ id, name: next })
  }
  function cancel() {
    cancelRef.current = true
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') cancel()
        }}
        aria-label="Client name"
        className="text-2xl font-bold text-foreground bg-muted border border-border rounded px-2 py-0.5 w-72 max-w-full focus:outline-none focus:border-ring"
      />
    )
  }

  return (
    <h1 className="text-2xl font-bold text-foreground group flex items-center gap-2">
      {name}
      <button
        onClick={start}
        title="Rename client"
        aria-label="Rename client"
        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        ✎
      </button>
    </h1>
  )
}
