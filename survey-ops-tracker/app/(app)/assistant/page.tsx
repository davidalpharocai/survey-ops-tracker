'use client'
import { useEffect, useRef, useState } from 'react'
import { useAssistantChat } from '@/lib/hooks/useAssistantChat'
import { AssistantThread } from '@/components/assistant/AssistantThread'

const SUGGESTIONS = [
  "What's due this week?",
  'Which projects are over budget?',
  'Summarize the pipeline',
  "What did we do last time for a repeat client?",
]

// Full-page ✦ Assistant — the same engine (useAssistantChat) as the floating
// panel, given more room. Reads and writes over the whole tracker with
// preview-then-confirm; every write is a card you Confirm here.
export default function AssistantPage() {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { messages, busy, send, confirm, cancel } = useAssistantChat()

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function submit(text: string) {
    if (!text.trim() || busy) return
    setInput('')
    void send(text)
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] w-full max-w-3xl flex-col">
      <header className="flex items-center gap-2 pb-3">
        <span className="text-lg text-blue-600 dark:text-blue-400">✦</span>
        <h1 className="text-lg font-semibold text-foreground">Assistant</h1>
        <span className="text-xs text-muted-foreground ml-1">
          Ask about projects and clients, or ask me to make a change — I preview every write for you to confirm.
        </span>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto rounded-xl border border-border bg-background/50 px-4 py-4 flex flex-col gap-3"
      >
        {messages.length === 0 && (
          <div className="flex flex-col gap-2 items-start max-w-md">
            <p className="text-sm text-muted-foreground">Try one of these to start:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="text-left text-sm bg-muted hover:bg-accent text-foreground/80 rounded-lg px-3 py-2 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        <AssistantThread messages={messages} busy={busy} onConfirm={confirm} onCancel={cancel} />
      </div>

      <div className="mt-3 flex gap-2">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit(input)}
          placeholder={busy ? 'Thinking…' : 'Ask or tell me to change something…'}
          disabled={busy}
          aria-label="Message the assistant"
          className="flex-1 bg-muted border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring disabled:opacity-60"
        />
        <button
          onClick={() => submit(input)}
          disabled={busy || !input.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
          aria-label="Send message"
        >
          Send
        </button>
      </div>
    </div>
  )
}
