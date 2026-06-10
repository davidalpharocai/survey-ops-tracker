'use client'
import { useState } from 'react'
import { useUpdateProject } from '@/lib/hooks/useProjects'

interface LinkedDocumentsProps {
  projectId: string
  documents: string[]
}

export function LinkedDocuments({ projectId, documents }: LinkedDocumentsProps) {
  const [newUrl, setNewUrl] = useState('')
  const updateProject = useUpdateProject()

  function handleAdd() {
    const trimmed = newUrl.trim()
    if (!trimmed) return
    updateProject.mutate({
      id: projectId,
      updates: { linked_documents: [...documents, trimmed] },
    })
    setNewUrl('')
  }

  function getDisplayName(url: string): string {
    try {
      const u = new URL(url)
      return u.pathname.split('/').filter(Boolean).pop() ?? u.hostname
    } catch {
      return url.length > 50 ? url.slice(0, 50) + '…' : url
    }
  }

  return (
    <div className="bg-card rounded-xl p-4">
      <h3 className="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium">
        Linked Documents
      </h3>
      <div className="flex flex-col gap-2 mb-3">
        {documents.map((url, i) => (
          <a
            key={i}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-accent transition-colors"
          >
            <span>📄</span>
            <span className="truncate">{getDisplayName(url)}</span>
          </a>
        ))}
        {documents.length === 0 && (
          <p className="text-muted-foreground/50 text-xs">No documents linked yet</p>
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
          disabled={!newUrl.trim()}
          className="bg-muted hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed text-foreground text-xs px-3 py-2 rounded-lg transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  )
}
