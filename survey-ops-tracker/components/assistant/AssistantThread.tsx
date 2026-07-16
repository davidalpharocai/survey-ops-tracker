'use client'
import type { ChatMessage, PendingAction } from '@/lib/hooks/useAssistantChat'

/**
 * Presentational render of a chat transcript for the ✦ Assistant. Shared by the
 * floating panel and the full-page view so the two surfaces render text bubbles,
 * the tool-activity line, and pending-action cards identically. All state lives
 * in useAssistantChat; this component only draws it and calls back on
 * Confirm / Cancel.
 */

/** Friendly present-tense label for a tool while it runs. */
const TOOL_VERB: Record<string, string> = {
  search_projects: 'Searching projects',
  get_project: 'Reading the project',
  get_project_history: 'Reading project history',
  pipeline_summary: 'Summarizing the pipeline',
  search_clients: 'Searching clients',
  get_client: 'Reading the client',
  get_client_history: 'Reading client history',
  list_activity: 'Reading activity',
  get_email: 'Reading the email',
  list_reminders: 'Checking reminders',
  decode_survey_id: 'Decoding the survey id',
  get_me: 'Looking you up',
}

function toolLabel(name: string): string {
  return TOOL_VERB[name] ?? name.replace(/_/g, ' ')
}

function ToolActivityLine({ names }: { names: string[] }) {
  if (names.length === 0) return null
  return (
    <div className="self-start flex items-center gap-2 text-xs text-muted-foreground pl-1">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" aria-hidden />
      <span>{names.map(toolLabel).join(', ')}…</span>
    </div>
  )
}

function statusStyles(status: PendingAction['status']): { border: string; label: string; tone: string } {
  switch (status) {
    case 'done':
      return { border: 'border-emerald-500/40', label: '✓ Done', tone: 'text-emerald-600 dark:text-emerald-400' }
    case 'blocked':
      return { border: 'border-amber-500/50', label: '⚠ Blocked', tone: 'text-amber-600 dark:text-amber-400' }
    case 'error':
      return { border: 'border-red-500/50', label: '✕ Failed', tone: 'text-red-600 dark:text-red-400' }
    case 'cancelled':
      return { border: 'border-border', label: 'Cancelled', tone: 'text-muted-foreground' }
    default:
      return { border: 'border-blue-500/40', label: '', tone: '' }
  }
}

function PendingCard({
  action,
  onConfirm,
  onCancel,
}: {
  action: PendingAction
  onConfirm: () => void
  onCancel: () => void
}) {
  const s = statusStyles(action.status)
  const isOpen = action.status === 'pending' || action.status === 'confirming'
  return (
    <div className={`self-start w-full max-w-full rounded-xl border ${s.border} bg-card px-3 py-2.5 flex flex-col gap-2`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-[10px] uppercase tracking-wide font-medium text-muted-foreground bg-muted rounded px-1.5 py-0.5 shrink-0">
          {action.tool.replace(/_/g, ' ')}
        </span>
        <p className="text-sm text-foreground flex-1 break-words">{action.summary}</p>
      </div>

      {isOpen ? (
        <div className="flex items-center gap-2">
          <button
            onClick={onConfirm}
            disabled={action.status === 'confirming'}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg px-3 py-1.5 transition-colors"
            aria-label={`Confirm: ${action.summary}`}
          >
            {action.status === 'confirming' ? 'Applying…' : 'Confirm'}
          </button>
          <button
            onClick={onCancel}
            disabled={action.status === 'confirming'}
            className="bg-muted hover:bg-accent disabled:opacity-50 text-foreground/80 text-xs rounded-lg px-3 py-1.5 transition-colors"
            aria-label={`Cancel: ${action.summary}`}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className={`text-xs font-medium ${s.tone}`}>
          {s.label}
          {action.message && action.status !== 'done' ? (
            <span className="font-normal text-muted-foreground"> — {action.message}</span>
          ) : null}
        </div>
      )}
    </div>
  )
}

export function AssistantThread({
  messages,
  busy,
  onConfirm,
  onCancel,
}: {
  messages: ChatMessage[]
  busy: boolean
  onConfirm: (msgId: string, pendingId: string) => void
  onCancel: (msgId: string, pendingId: string) => void
}) {
  return (
    <>
      {messages.map((m, i) => {
        if (m.role === 'user') {
          return (
            <div
              key={m.id}
              className="self-end max-w-[85%] bg-blue-600 text-white text-sm rounded-2xl rounded-br-sm px-3 py-2 whitespace-pre-wrap break-words"
            >
              {m.content}
            </div>
          )
        }

        const isLast = i === messages.length - 1
        const activeTools = m.tools.filter(t => !t.done).map(t => t.name)
        const showThinking = busy && isLast && !m.content && m.tools.length === 0 && m.pending.length === 0

        return (
          <div key={m.id} className="self-stretch flex flex-col gap-2">
            {m.content && (
              <div className="self-start max-w-[90%] bg-muted text-foreground text-sm rounded-2xl rounded-bl-sm px-3 py-2 whitespace-pre-wrap break-words">
                {m.content}
              </div>
            )}
            {showThinking && (
              <div className="self-start bg-muted text-muted-foreground text-sm rounded-2xl rounded-bl-sm px-3 py-2">
                …
              </div>
            )}
            {busy && isLast && <ToolActivityLine names={activeTools} />}
            {m.pending.map(p => (
              <PendingCard
                key={p.id}
                action={p}
                onConfirm={() => onConfirm(m.id, p.id)}
                onCancel={() => onCancel(m.id, p.id)}
              />
            ))}
          </div>
        )
      })}
    </>
  )
}
