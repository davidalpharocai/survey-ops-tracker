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
    <div className="bg-slate-900 rounded-xl p-4">
      <h3 className="text-xs text-slate-400 uppercase tracking-widest mb-3 font-medium">
        Linked Documents
      </h3>
      <div className="flex flex-col gap-2 mb-3">
        {documents.map((url, i) => (
          <a
            key={i}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2 text-sm text-blue-400 hover:text-blue-300 hover:bg-slate-700 transition-colors"
          >
            <span>📄</span>
            <span className="truncate">{getDisplayName(url)}</span>
          </a>
        ))}
        {documents.length === 0 && (
          <p className="text-slate-600 text-xs">No documents linked yet</p>
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={newUrl}
          onChange={e => setNewUrl(e.target.value)}
          placeholder="Paste Google Doc URL"
          className="flex-1 bg-slate-800 border border-dashed border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-slate-400 transition-colors"
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <button
          onClick={handleAdd}
          disabled={!newUrl.trim()}
          className="bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 text-xs px-3 py-2 rounded-lg transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  )
}
