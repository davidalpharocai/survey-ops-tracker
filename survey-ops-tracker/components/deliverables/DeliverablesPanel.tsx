'use client'
import { useRef, useState } from 'react'
import {
  useDeliverables,
  useUploadDeliverable,
  useRenameDeliverable,
  useRemoveDeliverable,
  type DeliverableRow,
} from '@/lib/hooks/useDeliverables'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/lib/utils/toast'

const driveUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`
const shownName = (d: DeliverableRow) => d.display_name ?? d.file_name ?? d.original_file_name ?? 'Untitled'

export function DeliverablesPanel({ projectId }: { projectId: string }) {
  const { data, isLoading } = useDeliverables(projectId)
  const upload = useUploadDeliverable(projectId)
  const rename = useRenameDeliverable(projectId)
  const remove = useRemoveDeliverable(projectId)
  const fileRef = useRef<HTMLInputElement>(null)
  const [link, setLink] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    upload.mutate(
      { file },
      {
        onSuccess: (r) =>
          toast(r.status === 'duplicate' ? 'Already filed — skipped' : 'Filed ✓', 'success'),
        onError: (err) => toast(String((err as Error).message)),
      }
    )
  }

  function onLink() {
    if (!link.trim()) return
    upload.mutate(
      { link: link.trim() },
      {
        onSuccess: (r) => {
          setLink('')
          toast(r.status === 'duplicate' ? 'Already filed — skipped' : 'Filed ✓', 'success')
        },
        onError: (err) => toast(String((err as Error).message)),
      }
    )
  }

  function startEdit(d: DeliverableRow) {
    setConfirmingId(null)
    setEditingId(d.id)
    setEditValue(shownName(d))
  }

  function saveEdit(id: string, value: string) {
    setEditingId(null)
    rename.mutate(
      { id, displayName: value },
      {
        onSuccess: () => toast('Renamed ✓', 'success'),
        onError: (err) => toast(String((err as Error).message)),
      }
    )
  }

  function resetName(id: string) {
    rename.mutate(
      { id, displayName: '' },
      {
        onSuccess: () => toast('Reset to auto name ✓', 'success'),
        onError: (err) => toast(String((err as Error).message)),
      }
    )
  }

  function confirmRemove(id: string) {
    setConfirmingId(null)
    remove.mutate(id, {
      onSuccess: () => toast('Removed ✓', 'success'),
      onError: (err) => toast(String((err as Error).message)),
    })
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="text-sm font-semibold flex items-center">
        Deliverables
        <InfoTooltip text="Final files/links sent to the client. Stored in the client's Shared Drive folder; this list is the index." />
      </h3>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={upload.isPending}
          className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
        >
          {upload.isPending ? 'Filing…' : '+ Attach deliverable'}
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={onFile} />
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="…or paste a deliverable link"
          className="text-xs px-2 py-1.5 rounded-lg border border-border flex-1 min-w-40 bg-background focus:outline-none focus:border-ring"
        />
        <button
          onClick={onLink}
          disabled={upload.isPending || !link.trim()}
          className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-40"
        >
          Add link
        </button>
      </div>

      <ul className="mt-3 space-y-1.5">
        {isLoading && <li className="text-xs text-muted-foreground">Loading…</li>}
        {!isLoading && (data?.length ?? 0) === 0 && (
          <li className="text-xs text-muted-foreground">No deliverables filed yet.</li>
        )}
        {data?.map((d: DeliverableRow) => {
          const name = shownName(d)

          if (editingId === d.id) {
            return (
              <li key={d.id} className="flex items-center gap-2 text-sm">
                <span>{d.kind === 'link' ? '🔗' : '📄'}</span>
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit(d.id, editValue)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="flex-1 text-sm px-2 py-1 rounded-lg border border-border bg-background focus:outline-none focus:border-ring"
                />
                <button onClick={() => saveEdit(d.id, editValue)} className="text-xs px-2 py-1 rounded-lg border border-border hover:bg-muted">
                  Save
                </button>
                <button onClick={() => setEditingId(null)} className="text-xs px-2 py-1 rounded-lg border border-border hover:bg-muted">
                  Cancel
                </button>
              </li>
            )
          }

          if (confirmingId === d.id) {
            return (
              <li key={d.id} className="flex items-center gap-2 text-sm bg-destructive/10 rounded-lg px-2 py-1.5">
                <span className="flex-1 text-xs text-destructive">
                  Remove <b>{name}</b>? The file stays in the client&apos;s Drive folder.
                </span>
                <button onClick={() => confirmRemove(d.id)} className="text-xs px-2 py-1 rounded-lg border border-destructive text-destructive hover:bg-destructive/10">
                  Remove
                </button>
                <button onClick={() => setConfirmingId(null)} className="text-xs px-2 py-1 rounded-lg border border-border hover:bg-muted">
                  Keep
                </button>
              </li>
            )
          }

          return (
            <li key={d.id} className="group flex items-center gap-2 text-sm">
              <span>{d.kind === 'link' ? '🔗' : '📄'}</span>
              <a
                className="flex-1 truncate hover:underline"
                href={d.source_url ?? (d.drive_file_id ? driveUrl(d.drive_file_id) : '#')}
                target="_blank"
                rel="noreferrer"
              >
                {name}
              </a>
              {d.display_name && (
                <button
                  onClick={() => resetName(d.id)}
                  className="text-[11px] text-muted-foreground hover:underline"
                >
                  reset to auto name
                </button>
              )}
              <Badge variant="secondary">{d.source}</Badge>
              {d.status !== 'filed' && <Badge variant="outline">{d.status}</Badge>}
              <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  aria-label="Rename"
                  onClick={() => startEdit(d)}
                  className="text-xs px-1.5 py-1 rounded hover:bg-muted"
                >
                  ✎
                </button>
                <button
                  aria-label="Remove deliverable"
                  onClick={() => setConfirmingId(d.id)}
                  className="text-xs px-1.5 py-1 rounded hover:bg-muted"
                >
                  ✕
                </button>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
