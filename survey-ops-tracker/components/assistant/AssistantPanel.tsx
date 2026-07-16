'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useAssistantChat, type PageContext } from '@/lib/hooks/useAssistantChat'
import { AssistantThread } from '@/components/assistant/AssistantThread'

const SUGGESTIONS = [
  "What's due this week?",
  'Which projects are over budget?',
  'Summarize the pipeline',
]

/**
 * Resolve the current page's PR/Cl code from the react-query cache (no extra
 * fetch — best effort). Called at send-time so it reads the freshest cache.
 */
function useReadPageContext(): () => PageContext | undefined {
  const pathname = usePathname()
  const qc = useQueryClient()
  return useCallback(() => {
    const proj = pathname.match(/^\/projects\/([^/]+)/)
    if (proj) {
      const id = proj[1]
      const detail = qc.getQueryData(['project', id]) as { project_code?: string | null } | undefined
      let code = detail?.project_code ?? undefined
      if (!code) {
        const list = qc.getQueryData(['projects']) as { id: string; project_code?: string | null }[] | undefined
        code = list?.find(p => p.id === id)?.project_code ?? undefined
      }
      return code ? { pr: code } : undefined
    }
    const client = pathname.match(/^\/clients\/([^/]+)/)
    if (client) {
      const id = client[1]
      const detail = qc.getQueryData(['client', id]) as { code?: string | null } | undefined
      let code = detail?.code ?? undefined
      if (!code) {
        const list = qc.getQueryData(['clients']) as { id: string; code?: string | null }[] | undefined
        code = list?.find(c => c.id === id)?.code ?? undefined
      }
      return code ? { cl: code } : undefined
    }
    return undefined
  }, [pathname, qc])
}

export function AssistantPanel() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { messages, busy, send, confirm, cancel } = useAssistantChat()
  const readContext = useReadPageContext()

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, open])

  // ⌘/Ctrl-K opens the panel and focuses the input, from anywhere in the app.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
        requestAnimationFrame(() => inputRef.current?.focus())
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function submit(text: string) {
    if (!text.trim() || busy) return
    setInput('')
    void send(text, readContext())
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true)
          requestAnimationFrame(() => inputRef.current?.focus())
        }}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium pl-3 pr-4 py-2.5 shadow-lg transition-colors"
        aria-label="Open assistant"
        aria-keyshortcuts="Control+K Meta+K"
      >
        <span className="text-base">✦</span> Assistant
      </button>
    )
  }

  return (
    <div
      className="fixed bottom-5 right-5 z-50 flex flex-col w-[380px] max-w-[calc(100vw-2.5rem)] h-[520px] max-h-[calc(100vh-5rem)] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
      role="dialog"
      aria-label="Survey Ops Assistant"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <span className="text-blue-600 dark:text-blue-400">✦</span>
        <span className="text-sm font-semibold text-foreground">Survey Ops Assistant</span>
        <Link
          href="/assistant"
          onClick={() => setOpen(false)}
          className="ml-auto text-muted-foreground hover:text-foreground transition-colors text-xs"
          title="Open the full-page assistant"
          aria-label="Open the full-page assistant"
        >
          ⤢
        </Link>
        <button
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close assistant"
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="flex flex-col gap-2 mt-2">
            <p className="text-xs text-muted-foreground">
              Ask about your projects, or ask me to make a change — I&apos;ll show a preview to confirm.
            </p>
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => submit(s)}
                className="text-left text-xs bg-muted hover:bg-accent text-foreground/80 rounded-lg px-3 py-2 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <AssistantThread messages={messages} busy={busy} onConfirm={confirm} onCancel={cancel} />
      </div>

      {/* Input */}
      <div className="border-t border-border p-3 flex gap-2">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit(input)}
          placeholder={busy ? 'Thinking…' : 'Ask or tell me to change something…'}
          disabled={busy}
          aria-label="Message the assistant"
          className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring disabled:opacity-60"
        />
        <button
          onClick={() => submit(input)}
          disabled={busy || !input.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm px-3.5 py-2 rounded-lg transition-colors"
          aria-label="Send message"
        >
          ➤
        </button>
      </div>
    </div>
  )
}
