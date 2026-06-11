'use client'
import { useState } from 'react'
import { useUpdateProject } from '@/lib/hooks/useProjects'

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
  const [newName, setNewName] = useState('')
  const updateProject = useUpdateProject()

  function handleAdd() {
    const url = newUrl.trim()
    if (!url) return
    const name = newName.trim()
    const entry = name ? JSON.stringify({ name, url }) : url
    updateProject.mutate({
      id: projectId,
      updates: { linked_documents: [...documents, entry] },
    })
    setNewUrl('')
    setNewName('')
  }

  function handleRemove(index: number) {
    updateProject.mutate({
      id: projectId,
      updates: { linked_documents: documents.filter((_, i) => i !== index) },
    })
  }

  return (
    <div className="bg-card rounded-xl p-4">
      <h3 className="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium">
        Linked Documents
      </h3>
      <div className="flex flex-col gap-2 mb-3">
        {documents.map((entry, i) => {
          const { name, url } = parseDoc(entry)
          return (
            <div key={i} className="flex items-center gap-1 group">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center gap-2 bg-muted rounded-lg px-3 py-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-accent transition-colors min-w-0"
              >
                <span>📄</span>
                <span className="truncate">{name ?? fallbackName(url)}</span>
              </a>
              <button
                onClick={() => handleRemove(i)}
                title="Remove link"
                className="text-muted-foreground/50 hover:text-red-600 dark:hover:text-red-400 text-xs px-1.5 py-2 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>
          )
        })}
        {documents.length === 0 && (
          <p className="text-muted-foreground/50 text-xs">No documents linked yet</p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Name (e.g. Questionnaire v2)"
            className="w-2/5 bg-muted border border-dashed border-border rounded-lg px-3 py-2 text-sm text-foreground/80 placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-colors"
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <input
            value={newUrl}
            onChange={e => setNewUrl(e.target.value)}
            placeholder="Paste URL"
            className="flex-1 bg-muted border border-dashed border-border rounded-lg px-3 py-2 text-sm text-foreground/80 placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-colors"
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <button
            onClick={handleAdd}
            disabled={!newUrl.trim()}
            className="bg-muted hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed text-foreground text-xs px-3 py-2 rounded-lg transition-colors"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
