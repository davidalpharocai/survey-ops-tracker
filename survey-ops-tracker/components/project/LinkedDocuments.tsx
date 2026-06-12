'use client'
import { useState } from 'react'
import { useUpdateProject } from '@/lib/hooks/useProjects'
import { InfoTooltip } from '@/components/shared/InfoTooltip'

interface LinkedDocumentsProps {
  projectId: string
  documents: string[]
}

// Entries are either a plain URL (legacy) or JSON {"name": "...", "url": "..."}
function parseDoc(entry: string): { name: string | null; url: string } {
  if (entry.startsWith('{')) {
    try {
      const d = JSON.parse(entry)
      if (d.url) return { name: d.name ?? null, url: d.url }
    } catch { /* fall through */ }
  }
  return { name: null, url: entry }
}

function fallbackName(url: string): string {
  try {
    const u = new URL(url)
    if (u.hostname === 'docs.google.com') {
      if (u.pathname.startsWith('/document')) return 'Google Doc'
      if (u.pathname.startsWith('/spreadsheets')) return 'Google Sheet'
      if (u.pathname.startsWith('/presentation')) return 'Google Slides'
      if (u.pathname.startsWith('/forms')) return 'Google Form'
    }
    if (u.hostname.includes('drive.google.com')) return 'Drive file'
    const seg = u.pathname.split('/').filter(s => s && !['edit', 'view', 'preview'].includes(s)).pop()
    return seg ?? u.hostname
  } catch {
    return url.length > 50 ? url.slice(0, 50) + '…' : url
  }
}

export function LinkedDocuments({ projectId, documents }: LinkedDocumentsProps) {
  const [newUrl, setNewUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<number | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const updateProject = useUpdateProject()

  async function handleAdd() {
    const url = newUrl.trim()
    if (!url || adding) return
    setAdding(true)
    let name: string | null = null
    try {
      const res = await fetch(`/api/doc-title?url=${encodeURIComponent(url)}`)
      if (res.ok) name = (await res.json()).title ?? null
    } catch { /* title lookup is best-effort */ }
    const entry = name ? JSON.stringify({ name, url }) : url
    updateProject.mutate({
      id: projectId,
      updates: { linked_documents: [...documents, entry] },
    })
    setNewUrl('')
    setAdding(false)
  }

  function handleRemove(index: number) {
    updateProject.mutate({
      id: projectId,
      updates: { linked_documents: documents.filter((_, i) => i !== index) },
    })
  }

  function saveRename(index: number) {
    const { url } = parseDoc(documents[index])
    const name = renameDraft.trim()
    const entry = name ? JSON.stringify({ name, url }) : url
    updateProject.mutate({
      id: projectId,
      updates: { linked_documents: documents.map((d, i) => (i === index ? entry : d)) },
    })
    setRenaming(null)
  }

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-4">
      <h3 className="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center">
        Linked Documents
        <InfoTooltip text="Links to this project's docs (questionnaire, data files, etc.). Titles are fetched automatically when you add a link; hover a link to rename or remove it." />
      </h3>
      <div className="grid grid-cols-2 gap-2 mb-3">
        {documents.map((entry, i) => {
          const { name, url } = parseDoc(entry)
          if (renaming === i) {
            return (
              <div key={i} className="col-span-2 flex items-center gap-2">
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={e => setRenameDraft(e.target.value)}
                  placeholder="Document name"
                  className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring"
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveRename(i)
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                />
                <button
                  onClick={() => saveRename(i)}
                  className="text-xs bg-muted hover:bg-accent text-foreground px-3 py-2 rounded-lg transition-colors"
                >
                  Save
                </button>
              </div>
            )
          }
          return (
            <div key={i} className="relative group min-w-0">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-accent transition-colors min-w-0"
              >
                <span>📄</span>
                <span className="truncate">{name ?? fallbackName(url)}</span>
              </a>
              <span className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center bg-muted rounded opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => {
                    setRenameDraft(name ?? '')
                    setRenaming(i)
                  }}
                  title="Rename"
                  className="text-muted-foreground/50 hover:text-foreground text-xs px-1 py-1"
                >
                  ✎
                </button>
                <button
                  onClick={() => handleRemove(i)}
                  title="Remove link"
                  className="text-muted-foreground/50 hover:text-red-600 dark:hover:text-red-400 text-xs px-1 py-1"
                >
                  ✕
                </button>
              </span>
            </div>
          )
        })}
        {documents.length === 0 && (
          <p className="col-span-2 text-muted-foreground/50 text-xs">No documents linked yet</p>
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={newUrl}
          onChange={e => setNewUrl(e.target.value)}
          placeholder="Paste Google Doc URL"
          className="flex-1 bg-muted border border-dashed border-border rounded-lg px-3 py-2 text-sm text-foreground/80 placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-colors"
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <button
          onClick={handleAdd}
          disabled={!newUrl.trim() || adding}
          className="bg-muted hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed text-foreground text-xs px-3 py-2 rounded-lg transition-colors"
        >
          {adding ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  )
}
