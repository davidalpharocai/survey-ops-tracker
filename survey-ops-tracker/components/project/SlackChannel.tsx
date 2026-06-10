'use client'
import { useState } from 'react'
import { useUpdateProject } from '@/lib/hooks/useProjects'

interface SlackChannelProps {
  projectId: string
  url: string | null
}

export function SlackChannel({ projectId, url }: SlackChannelProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const updateProject = useUpdateProject()

  function handleSave() {
    const trimmed = draft.trim()
    updateProject.mutate({
      id: projectId,
      updates: { slack_channel_url: trimmed || null },
    })
    setDraft('')
    setEditing(false)
  }

  const showInput = editing || !url

  return (
    <div className="bg-card rounded-xl p-4">
      <h3 className="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium">
        Slack Channel
      </h3>
      {url && !editing && (
        <div className="flex items-center gap-2">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-1 items-center gap-2 bg-muted rounded-lg px-3 py-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-accent transition-colors"
          >
            <span>💬</span>
            <span className="truncate">Open Slack channel</span>
          </a>
          <button
            onClick={() => {
              setDraft(url)
              setEditing(true)
            }}
            className="text-muted-foreground hover:text-foreground text-xs px-2 py-2 transition-colors"
            title="Change link"
          >
            ✎
          </button>
        </div>
      )}
      {showInput && (
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Paste Slack channel URL"
            className="flex-1 bg-muted border border-dashed border-border rounded-lg px-3 py-2 text-sm text-foreground/80 placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-colors"
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
          <button
            onClick={handleSave}
            disabled={!editing && !draft.trim()}
            className="bg-muted hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed text-foreground text-xs px-3 py-2 rounded-lg transition-colors"
          >
            Save
          </button>
        </div>
      )}
    </div>
  )
}
