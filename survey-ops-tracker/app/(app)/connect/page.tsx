import { createClient } from '@/lib/supabase/server'
import { listUserTokens, getClient } from '@/lib/oauth/store'
import { formatDate } from '@/lib/utils/date'
import { CopyBox, RevokeButton } from './ConnectClient'
import { revokeConnectionAction } from './actions'

export const dynamic = 'force-dynamic'

const CONNECTOR_URL = 'https://survey-ops-tracker.vercel.app/api/mcp'

const card = 'bg-card border border-border shadow-sm rounded-xl p-4'
const heading = 'text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium'

type Connection = {
  id: string
  clientName: string
  created_at: string
  last_used_at: string | null
}

async function loadConnections(userId: string): Promise<Connection[]> {
  try {
    const tokens = await listUserTokens(userId)
    const connections = await Promise.all(
      tokens.map(async t => {
        const client = await getClient(t.client_id)
        return {
          id: t.id,
          clientName: client?.name ?? 'Claude',
          created_at: t.created_at,
          last_used_at: t.last_used_at,
        }
      })
    )
    return connections
    // Degrade gracefully: if the oauth tables don't exist yet (migration 045
    // not applied), fall back to the empty state instead of crashing the page.
  } catch {
    return []
  }
}

export default async function ConnectPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const connections = user ? await loadConnections(user.id) : []

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Connect your Claude</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Link Survey Ops to Claude (claude.ai, Claude Desktop, or Claude Code) so you can ask
          about your projects and set reminders right from a chat — &quot;what&apos;s due this
          week?&quot;, &quot;remind me Friday to chase the deliverable&quot;. It logs in as you,
          reads the same data you can already see, and reminders arrive by email the morning
          they&apos;re due.
        </p>
      </div>

      <div className={card}>
        <h3 className={heading}>Connector URL</h3>
        <CopyBox value={CONNECTOR_URL} />
      </div>

      <div className={card}>
        <h3 className={heading}>Set it up</h3>

        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 rounded-lg px-3 py-2 mb-3 text-sm">
          <p className="text-amber-700 dark:text-amber-400">
            <strong>Sign in with your @alpharoc.ai analyst account.</strong> Wrong account?
            Click &quot;Sign in with a different account&quot; on the consent screen. If your
            browser keeps autofilling the wrong one, open an incognito/private window and sign
            in fresh there.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <details className="border border-border/60 rounded-lg p-3 group">
            <summary className="text-sm font-medium text-foreground cursor-pointer">
              claude.ai (web &amp; mobile)
            </summary>
            <div className="mt-2 text-sm text-muted-foreground leading-relaxed">
              <ol className="list-decimal list-inside space-y-1">
                <li>Go to Settings → Connectors</li>
                <li>Click &quot;Add custom connector&quot;</li>
                <li>Paste the connector URL above</li>
                <li>Click &quot;Log in&quot; and sign in with your @alpharoc.ai account when prompted</li>
                <li>Click &quot;Allow&quot; on the consent screen</li>
              </ol>
              <p className="mt-2 text-xs text-muted-foreground/80">
                Note: custom connectors require a paid Claude plan. On a Team or Enterprise
                plan, an admin may need to add the connector organization-wide before you can
                use it.
              </p>
            </div>
          </details>

          <details className="border border-border/60 rounded-lg p-3 group">
            <summary className="text-sm font-medium text-foreground cursor-pointer">
              Claude Desktop
            </summary>
            <div className="mt-2 text-sm text-muted-foreground leading-relaxed">
              <ol className="list-decimal list-inside space-y-1">
                <li>Go to Settings → Connectors</li>
                <li>Click &quot;Add custom connector&quot;</li>
                <li>Paste the connector URL above</li>
                <li>Click &quot;Log in&quot; and sign in with your @alpharoc.ai account when prompted</li>
                <li>Click &quot;Allow&quot; on the consent screen</li>
              </ol>
            </div>
          </details>

          <details className="border border-border/60 rounded-lg p-3 group">
            <summary className="text-sm font-medium text-foreground cursor-pointer">
              Claude Code
            </summary>
            <div className="mt-2 text-sm text-muted-foreground leading-relaxed">
              <p className="mb-2">Run this from a terminal:</p>
              <code className="block bg-muted border border-border rounded-lg px-3 py-2 text-xs overflow-x-auto whitespace-pre">
                claude mcp add --transport http survey-ops {CONNECTOR_URL}
              </code>
            </div>
          </details>
        </div>
      </div>

      <div className={card}>
        <h3 className={heading}>What you can ask</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Do:</strong> &quot;Log a 500-count blast on
          PR00123&quot; · &quot;Push PR00119&apos;s due date to next Friday&quot; · &quot;Create
          a B2B project for Coatue, 500 responses, due July 20&quot;. Every change or new record
          gets previewed before anything writes — nothing changes silently, and it can&apos;t
          bypass a compliance gate, touch internal projects, delete, or merge.
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed mt-2">
          <strong className="text-foreground">Recall:</strong> &quot;What did we do last time
          for Coatue?&quot; · &quot;What&apos;s overdue for me?&quot; Corrections to a logged
          blast or bid happen in the app, not here.
        </p>
      </div>

      <div className={card}>
        <h3 className={heading}>Active connections</h3>
        {connections.length === 0 ? (
          <p className="text-xs text-muted-foreground/50">No Claudes connected yet.</p>
        ) : (
          <div className="flex flex-col">
            {connections.map(c => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 py-2 border-b border-border/40 last:border-0"
              >
                <span className="min-w-0">
                  <span className="text-sm text-foreground truncate block">{c.clientName}</span>
                  <span className="block text-xs text-muted-foreground truncate">
                    Connected {formatDate(c.created_at)}
                    {' · '}
                    Last used {c.last_used_at ? formatDate(c.last_used_at) : 'never'}
                  </span>
                </span>
                <span className="shrink-0">
                  <RevokeButton id={c.id} revoke={revokeConnectionAction} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground/60">
        Available to analysts only. Revoking a connection here signs that Claude out immediately
        — it will need to log in again to reconnect.
      </p>
    </div>
  )
}
