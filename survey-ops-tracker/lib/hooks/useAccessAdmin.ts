import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/utils/toast'

// The Access panel's data. Everything goes through /api/admin/access rather than
// PostgREST, for one reason: profile_roles is service-role-write-only (085), so
// the browser CANNOT write it directly — by design. Reads could technically come
// straight from the DB for an analyst, but routing both through the same gated
// endpoint means there is exactly one place that decides who may administer
// access, instead of a policy and a route that can drift apart.

export interface AccessPerson {
  id: string
  email: string
  name: string | null
  /** profiles.role — the TIER (which app you land in), not a permission set. */
  tier: string
  roles: string[]
  /** Capabilities granted directly to this person rather than via a role. */
  direct: string[]
}

export interface AccessCatalogue {
  people: AccessPerson[]
  roles: { name: string; description: string }[]
  permissions: { name: string; description: string; is_sensitive: boolean }[]
  bundles: { role: string; permission: string }[]
  audit: {
    at: string
    actor: string
    action: string
    subject: string
    target: string
    reason: string | null
  }[]
}

export class NeedsMigrationError extends Error {}

export function useAccessCatalogue(enabled: boolean) {
  return useQuery({
    queryKey: ['access-catalogue'],
    enabled,
    queryFn: async (): Promise<AccessCatalogue> => {
      const res = await fetch('/api/admin/access')
      const body = await res.json().catch(() => ({}))
      if (res.status === 503 && body?.needsMigration) throw new NeedsMigrationError(body.error)
      if (!res.ok) throw new Error(body?.error ?? 'Could not read access.')
      return body as AccessCatalogue
    },
    retry: false,
  })
}

type Action = 'grant_role' | 'revoke_role' | 'grant_capability' | 'revoke_capability'

export function useChangeAccess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { action: Action; subjectId: string; target: string; reason?: string }) => {
      const res = await fetch('/api/admin/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: v.action,
          subject_id: v.subjectId,
          target: v.target,
          reason: v.reason,
        }),
      })
      const body = await res.json().catch(() => ({}))
      // 085's guardrails surface as readable sentences ("Refusing self-grant…",
      // "Refusing to revoke the last admin…"). Show them verbatim — they explain
      // the rule, which a generic failure message would throw away.
      if (!res.ok) throw new Error(body?.error ?? 'Could not change access.')
      return body
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['access-catalogue'] })
      // The person doing the granting may have changed their OWN access (they
      // can revoke their own finance role, just not grant it), so refresh what
      // this session believes it holds too.
      qc.invalidateQueries({ queryKey: ['my-access'] })
      const verb = v.action.startsWith('grant') ? 'Granted' : 'Removed'
      toast(`${verb} ${v.target}`, 'success')
    },
    onError: (e: Error) => toast(e.message),
  })
}

/** Which permissions a role bundles — used to show "finance → view_financials"
 *  so an admin can see what they are handing over before they hand it over. */
export function permissionsForRole(bundles: AccessCatalogue['bundles'], role: string): string[] {
  return bundles.filter((b) => b.role === role).map((b) => b.permission)
}
