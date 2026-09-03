'use client'
import { useState } from 'react'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { ViewAsButton } from './ViewAsButton'
import { useCanManagePermissions } from '@/lib/hooks/useCapabilities'
import {
  useAccessCatalogue,
  useChangeAccess,
  permissionsForRole,
  NeedsMigrationError,
  type AccessPerson,
} from '@/lib/hooks/useAccessAdmin'

const tile = 'bg-card border border-border shadow-sm rounded-xl p-4'
const heading =
  'text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center'

// Meaning-encoded, not decorative: money is amber, access administration is
// violet (the thing that can hand out the others), sales is blue, and the
// compliance tier keeps the slate it has everywhere else in the app.
const ROLE_STYLE: Record<string, string> = {
  finance: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  admin: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  sales: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
}
const roleStyle = (r: string) =>
  ROLE_STYLE[r] ?? 'bg-muted text-muted-foreground border-border'

// Offered only for the tiers the database makes read-only. Kept in sync with
// IMPERSONATABLE_ROLES in lib/auth/impersonation.ts, which is what the server
// actually enforces — this list only decides whether to draw the button.
const VIEW_AS_TIERS = new Set(['sales', 'compliance'])

const TIER_LABEL: Record<string, string> = {
  analyst: 'Internal',
  compliance: 'Client reviewer',
  sales: 'Sales',
}

/**
 * Who can do what, and the only place in the app that changes it.
 *
 * Renders nothing at all unless the viewer holds manage_permissions — but that
 * is a courtesy, not the gate. /api/admin/access checks the same permission
 * server-side, migration 085's RPCs have no `authenticated` EXECUTE grant, and
 * profile_roles is service-role-write-only. A hidden panel is not a permission
 * check and this component does not pretend otherwise.
 */
export function AccessControl() {
  const canManage = useCanManagePermissions()
  const { data, error, isLoading } = useAccessCatalogue(canManage)
  const change = useChangeAccess()
  const [showAudit, setShowAudit] = useState(false)

  if (!canManage) return null

  if (error instanceof NeedsMigrationError) {
    return (
      <div className={tile}>
        <h3 className={heading}>Access</h3>
        <p className="text-sm text-muted-foreground">
          Roles need migration <span className="font-mono">085</span> in Supabase, then reload this
          page.
        </p>
      </div>
    )
  }

  return (
    <div className={tile}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className={`${heading} mb-0`}>
          Access
          <InfoTooltip text="Who holds which role. A role is a bundle of permissions — granting someone 'finance' lets them see client pricing and margin. Tier (Internal / Client reviewer) decides which app someone lands in and is set when their account is created, not here. Every change is logged." />
        </h3>
        <button
          onClick={() => setShowAudit((s) => !s)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Every grant and revoke, most recent first."
        >
          {showAudit ? 'Hide history' : 'History'}
        </button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && !(error instanceof NeedsMigrationError) && (
        <p className="text-sm text-red-600 dark:text-red-400">{(error as Error).message}</p>
      )}

      {data && !showAudit && (
        <>
          {/* What each role actually grants, so an admin can see what they are
              handing over before they hand it over. */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 pb-3 border-b border-border/60">
            {data.roles.map((r) => {
              const perms = permissionsForRole(data.bundles, r.name)
              return (
                <span key={r.name} className="text-xs text-muted-foreground" title={r.description}>
                  <span className={`px-1.5 py-0.5 rounded border mr-1.5 ${roleStyle(r.name)}`}>
                    {r.name}
                  </span>
                  {perms.length ? perms.join(', ') : 'no permissions yet'}
                </span>
              )
            })}
          </div>

          <div className="max-h-[22rem] overflow-y-auto thin-scroll pr-1 -mx-1">
            {data.people.map((p) => (
              <PersonRow
                key={p.id}
                person={p}
                allRoles={data.roles.map((r) => r.name)}
                busy={change.isPending}
                onGrant={(role) =>
                  change.mutate({ action: 'grant_role', subjectId: p.id, target: role })
                }
                onRevoke={(role) =>
                  change.mutate({ action: 'revoke_role', subjectId: p.id, target: role })
                }
              />
            ))}
          </div>
        </>
      )}

      {data && showAudit && (
        <div className="max-h-[22rem] overflow-y-auto thin-scroll pr-1">
          {data.audit.length === 0 && (
            <p className="text-sm text-muted-foreground">No access changes recorded yet.</p>
          )}
          {data.audit.map((a, i) => (
            <div
              key={i}
              className="text-xs py-1.5 border-b border-border/40 last:border-0 flex items-baseline gap-2"
            >
              <span className="text-muted-foreground font-mono shrink-0">
                {new Date(a.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
              <span className="text-foreground">
                <span className={a.action.startsWith('grant') ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                  {a.action.startsWith('grant') ? 'granted' : 'removed'}
                </span>{' '}
                <span className={`px-1 rounded border ${roleStyle(a.target)}`}>{a.target}</span>
                {a.action.startsWith('grant') ? ' to ' : ' from '}
                <span className="font-medium">{a.subject}</span>
                <span className="text-muted-foreground"> — {a.actor}</span>
                {a.reason && <span className="text-muted-foreground"> ({a.reason})</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PersonRow({
  person,
  allRoles,
  busy,
  onGrant,
  onRevoke,
}: {
  person: AccessPerson
  allRoles: string[]
  busy: boolean
  onGrant: (role: string) => void
  onRevoke: (role: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const available = allRoles.filter((r) => !person.roles.includes(r))

  return (
    <div className="flex items-center justify-between gap-2 py-1.5 px-1 border-b border-border/40 last:border-0 group">
      <span className="min-w-0 flex-1">
        <span className="text-sm text-foreground truncate block">
          {person.name ?? person.email}
        </span>
        <span className="text-xs text-muted-foreground truncate block">
          {person.email}
          <span className="mx-1.5 opacity-40">·</span>
          {TIER_LABEL[person.tier] ?? person.tier}
        </span>
      </span>

      <span className="flex items-center gap-1 flex-wrap justify-end shrink-0">
        {VIEW_AS_TIERS.has(person.tier) && person.email && (
          <ViewAsButton email={person.email} tier={TIER_LABEL[person.tier] ?? person.tier} />
        )}
        {person.roles.map((r) => (
          <span
            key={r}
            className={`text-xs px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ${roleStyle(r)}`}
          >
            {r}
            <button
              onClick={() => onRevoke(r)}
              disabled={busy}
              title={`Remove ${r} from ${person.email}`}
              className="opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity disabled:opacity-30"
            >
              ✕
            </button>
          </span>
        ))}

        {/* Direct grants shown but NOT removable here. They are the deliberate
            one-off (079 granted all three finance holders one before roles
            existed), so removing one should be a conscious act in the SQL
            editor rather than a ✕ next to a role chip that looks the same. */}
        {person.direct.map((c) => (
          <span
            key={c}
            className="text-xs px-1.5 py-0.5 rounded border border-dashed border-border text-muted-foreground"
            title={`Granted directly to this person, not through a role. Remove it in the SQL editor.`}
          >
            {c}
          </span>
        ))}

        {available.length > 0 &&
          (adding ? (
            <select
              autoFocus
              defaultValue=""
              disabled={busy}
              onBlur={() => setAdding(false)}
              onChange={(e) => {
                if (e.target.value) onGrant(e.target.value)
                setAdding(false)
              }}
              className="bg-muted border border-border rounded px-1 py-0.5 text-xs text-foreground focus:outline-none focus:border-ring"
            >
              <option value="">Pick a role…</option>
              {available.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => setAdding(true)}
              disabled={busy}
              title={`Give ${person.email} another role`}
              className="text-xs text-muted-foreground/60 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-30"
            >
              ＋ role
            </button>
          ))}
      </span>
    </div>
  )
}
