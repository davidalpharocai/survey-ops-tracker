'use client'
import { useEffect, useRef, useState } from 'react'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  "What's due this week?",
  'Which projects are over budget?',
  'Summarize the pipeline',
]

export function AssistantPanel() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, open])

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    const next: ChatMessage[] = [...messages, { role: 'user', content: trimmed }]
    setMessages([...next, { role: 'assistant', content: '' }])
    setInput('')
    setBusy(true)
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      })
      if (!res.ok || !res.body) {
        const msg = res.status === 503
          ? await res.text()
          : 'Sorry, something went wrong. Please try again.'
        setMessages([...next, { role: 'assistant', content: msg }])
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        const current = acc
        setMessages([...next, { role: 'assistant', content: current }])
      }
      if (!acc) {
        setMessages([...next, { role: 'assistant', content: '(no response)' }])
      }
    } catch {
      setMessages([...next, { role: 'assistant', content: 'Connection error. Please try again.' }])
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium pl-3 pr-4 py-2.5 shadow-lg transition-colors"
        aria-label="Open assistant"
      >
        <span className="text-base">✦</span> Assistant
      </button>
    )
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col w-[380px] max-w-[calc(100vw-2.5rem)] h-[520px] max-h-[calc(100vh-5rem)] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <span className="text-blue-600 dark:text-blue-400">✦</span>
        <span className="text-sm font-semibold text-foreground">Survey Ops Assistant</span>
        <button
          onClick={() => setOpen(false)}
          className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
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
              Ask me anything about your survey projects.
            </p>
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-left text-xs bg-muted hover:bg-accent text-foreground/80 rounded-lg px-3 py-2 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === 'user'
                ? 'self-end max-w-[85%] bg-blue-600 text-white text-sm rounded-2xl rounded-br-sm px-3 py-2 whitespace-pre-wrap'
                : 'self-start max-w-[90%] bg-muted text-foreground text-sm rounded-2xl rounded-bl-sm px-3 py-2 whitespace-pre-wrap'
            }
          >
            {m.content || (busy && i === messages.length - 1 ? '…' : m.content)}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-border p-3 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send(input)}
          placeholder={busy ? 'Thinking…' : 'Ask about your projects…'}
          disabled={busy}
          className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring disabled:opacity-60"
        />
        <button
          onClick={() => send(input)}
          disabled={busy || !input.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm px-3.5 py-2 rounded-lg transition-colors"
        >
          ➤
        </button>
      </div>
    </div>
  )
}
