'use client'
import { useCallback, useState, useRef } from 'react'

/**
 * Shared chat engine for the in-app ✦ Assistant — used by BOTH the floating
 * panel (components/assistant/AssistantPanel) and the full-page view
 * (app/(app)/assistant). It owns the whole client side of the agentic loop:
 *
 *  - POST the conversation to /api/assistant and parse its newline-delimited
 *    JSON event stream into message state (assistant text, tool-activity lines,
 *    and pending-action cards).
 *  - confirm() a pending write by POSTing its signed token to
 *    /api/assistant/act — the ONLY place a write ever commits — and reflect the
 *    result (done / compliance-blocked / error) back onto the card.
 *  - cancel() a pending write client-side (drop the token, no server call).
 *
 * Keeping this in one hook means the two surfaces never duplicate stream-parse
 * or confirm logic.
 */

export type PendingStatus =
  | 'pending' // awaiting the user's Confirm / Cancel
  | 'confirming' // Confirm clicked, /act in flight
  | 'done' // committed
  | 'blocked' // committed call returned a compliance-gate block
  | 'error' // /act failed
  | 'cancelled' // user cancelled

export interface PendingAction {
  id: string
  tool: string
  summary: string
  preview: unknown
  token: string
  status: PendingStatus
  /** Result/error detail to surface once terminal. */
  message?: string
}

export interface ToolActivity {
  key: string
  name: string
  done: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  tools: ToolActivity[]
  pending: PendingAction[]
}

/** Current-page context handed to the model so "this project" resolves. */
export interface PageContext {
  pr?: string
  cl?: string
}

type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; phase: 'start' | 'done' }
  | { type: 'pending'; id: string; tool: string; summary: string; preview: unknown; token: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Mark the most recent not-yet-done activity with this name as done. */
function markToolDone(tools: ToolActivity[], name: string): ToolActivity[] {
  for (let i = tools.length - 1; i >= 0; i--) {
    if (tools[i].name === name && !tools[i].done) {
      const next = tools.slice()
      next[i] = { ...next[i], done: true }
      return next
    }
  }
  return tools
}

/** Pull a short, safe human message out of a committed /act result. */
function resultMessage(result: unknown): string | undefined {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>
    if (typeof r.summary === 'string' && r.summary.trim()) return r.summary
    if (typeof r.message === 'string' && r.message.trim()) return r.message
  }
  return undefined
}

export function useAssistantChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  // Latest messages, readable synchronously from event handlers (confirm) that
  // aren't in the messages-dependency closure — avoids reading state via a
  // setState-updater side-effect, which doesn't run synchronously.
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const updatePending = useCallback(
    (msgId: string, pendingId: string, fn: (p: PendingAction) => PendingAction) => {
      setMessages(prev =>
        prev.map(m =>
          m.id === msgId
            ? { ...m, pending: m.pending.map(p => (p.id === pendingId ? fn(p) : p)) }
            : m
        )
      )
    },
    []
  )

  const reset = useCallback(() => setMessages([]), [])

  const send = useCallback(
    async (text: string, context?: PageContext) => {
      const trimmed = text.trim()
      if (!trimmed || busy) return

      const userMsg: ChatMessage = { id: uid(), role: 'user', content: trimmed, tools: [], pending: [] }
      const asstId = uid()
      const asstMsg: ChatMessage = { id: asstId, role: 'assistant', content: '', tools: [], pending: [] }

      // Text-only history for the server (tool/pending state is UI-only).
      const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }))

      setMessages(prev => [...prev, userMsg, asstMsg])
      setBusy(true)

      const patch = (fn: (m: ChatMessage) => ChatMessage) =>
        setMessages(prev => prev.map(m => (m.id === asstId ? fn(m) : m)))

      const handle = (evt: StreamEvent) => {
        switch (evt.type) {
          case 'text':
            patch(m => ({ ...m, content: m.content + evt.delta }))
            break
          case 'tool':
            if (evt.phase === 'start') {
              patch(m => ({ ...m, tools: [...m.tools, { key: uid(), name: evt.name, done: false }] }))
            } else {
              patch(m => ({ ...m, tools: markToolDone(m.tools, evt.name) }))
            }
            break
          case 'pending':
            patch(m => ({
              ...m,
              pending: [
                ...m.pending,
                {
                  id: evt.id,
                  tool: evt.tool,
                  summary: evt.summary,
                  preview: evt.preview,
                  token: evt.token,
                  status: 'pending',
                },
              ],
            }))
            break
          case 'error':
            patch(m => ({ ...m, content: m.content ? `${m.content}\n\n${evt.message}` : evt.message }))
            break
          case 'done':
            break
        }
      }

      try {
        const res = await fetch('/api/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history, context }),
        })
        if (!res.ok || !res.body) {
          const msg =
            res.status === 503
              ? await res.text()
              : 'Sorry, something went wrong. Please try again.'
          patch(m => ({ ...m, content: msg }))
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let nl: number
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            if (!line) continue
            try {
              handle(JSON.parse(line) as StreamEvent)
            } catch {
              /* ignore a partial/garbled line */
            }
          }
        }
        // Flush a trailing line with no final newline.
        const tail = buf.trim()
        if (tail) {
          try {
            handle(JSON.parse(tail) as StreamEvent)
          } catch {
            /* ignore */
          }
        }

        patch(m =>
          m.content || m.pending.length > 0 ? m : { ...m, content: '(no response)' }
        )
      } catch {
        patch(m => ({
          ...m,
          content: m.content || 'Connection error. Please try again.',
        }))
      } finally {
        setBusy(false)
      }
    },
    [messages, busy]
  )

  const confirm = useCallback(
    (msgId: string, pendingId: string) => {
      // Read the token from the latest state (via ref) and guard BEFORE flipping
      // the card to "confirming" — so a not-pending/missing-token case never
      // leaves it stuck on "Applying…". (The old version read the token as a
      // side-effect inside a setState updater and checked it synchronously, but
      // React doesn't run the updater synchronously, so it always bailed out
      // after showing "Applying…" and never called the server.)
      const msg = messagesRef.current.find(m => m.id === msgId)
      const pa = msg?.pending.find(p => p.id === pendingId)
      if (!pa || pa.status !== 'pending' || !pa.token) return
      const capturedToken = pa.token
      updatePending(msgId, pendingId, p => ({ ...p, status: 'confirming' }))

      void (async () => {
        try {
          const res = await fetch('/api/assistant/act', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: capturedToken }),
          })
          const json = (await res.json().catch(() => null)) as
            | { result?: unknown; error?: string }
            | null

          if (!res.ok || (json && json.error)) {
            updatePending(msgId, pendingId, p => ({
              ...p,
              status: 'error',
              message: json?.error ?? 'That action could not be completed.',
            }))
            return
          }

          const result = json?.result
          const robj =
            result && typeof result === 'object' ? (result as Record<string, unknown>) : null

          if (robj?.blocked) {
            const reason = robj.reason
            updatePending(msgId, pendingId, p => ({
              ...p,
              status: 'blocked',
              message:
                typeof reason === 'string' && reason
                  ? reason
                  : 'Blocked by a compliance gate.',
            }))
            return
          }

          // Defensive: a handler that returned a structured failure should never
          // read as success (the /act endpoint already hoists these to json.error).
          if (robj && typeof robj.error === 'string') {
            updatePending(msgId, pendingId, p => ({ ...p, status: 'error', message: robj.error as string }))
            return
          }

          updatePending(msgId, pendingId, p => ({
            ...p,
            status: 'done',
            message: resultMessage(result),
          }))
        } catch {
          updatePending(msgId, pendingId, p => ({
            ...p,
            status: 'error',
            message: 'Connection error — please try again.',
          }))
        }
      })()
    },
    [updatePending]
  )

  const cancel = useCallback(
    (msgId: string, pendingId: string) => {
      updatePending(msgId, pendingId, p =>
        p.status === 'pending' ? { ...p, status: 'cancelled' } : p
      )
    },
    [updatePending]
  )

  return { messages, busy, send, confirm, cancel, reset }
}
