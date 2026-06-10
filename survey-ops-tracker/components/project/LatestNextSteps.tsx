'use client'
import { useState } from 'react'
import { useAddProjectUpdate } from '@/lib/hooks/useProjects'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'

interface LatestNextStepsProps {
  projectId: string
  notes: string | null
}

export function LatestNextSteps({ projectId, notes }: LatestNextStepsProps) {
  const [newText, setNewText] = useState('')
  const addUpdate = useAddProjectUpdate()
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

  return (
    <div className="bg-card rounded-xl p-4">
      <h3 className="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium">
        Latest / Next Steps
      </h3>
      {notes && (
        <pre className="text-foreground/80 text-sm leading-relaxed whitespace-pre-wrap mb-4 font-sans">
          {notes}
        </pre>
      )}
      <div className="flex gap-2">
        <textarea
          value={newText}
          onChange={e => setNewText(e.target.value)}
          placeholder="Add update... (auto-stamps date + your name)"
          rows={2}
          className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-ring transition-colors"
          onKeyDown={e => {
            if (e.key === 'Enter' && e.metaKey) handleSave()
          }}
        />
        <button
          onClick={handleSave}
          disabled={!newText.trim()}
          className="self-end bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs px-4 py-2 rounded-lg transition-colors"
        >
          Save
        </button>
      </div>
      <p className="text-xs text-muted-foreground/50 mt-1">Cmd+Enter to save</p>
    </div>
  )
}
