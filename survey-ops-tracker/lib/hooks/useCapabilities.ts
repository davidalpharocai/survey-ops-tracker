import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { VIEW_FINANCIALS, type Capability } from '@/lib/auth/capabilityNames'

// Browser-side twin of lib/auth/capabilities.ts (which is server-only and can't
// be imported here). Reads the caller's OWN rows — migration 079's "read own
// capabilities" policy is `profile_id = auth.uid()`, so this query is safe from
// the browser and returns nothing for anyone else.
//
// ⚠️ This is a SEPARATE query on purpose, and it must stay that way. Never fold
// a capability read into app/(app)/layout.tsx's profile gate: that gate does
// redirect('/login') on ANY select error, and migrations are applied by hand
// hours or days after the code deploys, so a widened gate select would sign the
// entire company out until the SQL ran. Here, the same failure just means "no
// capabilities" — money stays hidden, the app keeps working.

/** Every capability held by the signed-in user. Resolves to an empty set on any
 *  failure (missing table, no session, RLS), never rejects — so consumers can
 *  treat "don't know" and "not allowed" as the same, safe answer. */
export function useCapabilities() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['my-capabilities'],
    queryFn: async (): Promise<Set<Capability>> => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return new Set()
        const { data, error } = await supabase
          .from('profile_capabilities')
          .select('capability')
          .eq('profile_id', user.id)
        if (error || !data) return new Set()
        return new Set(data.map((r) => r.capability as Capability))
      } catch {
        return new Set()
      }
    },
    // Grants change roughly never (they're a deliberate SQL act), and every
    // money surface on the page calls this, so hold the answer for the session
    // rather than re-querying per mount.
    staleTime: 10 * 60_000,
  })
}

/**
 * True only when we KNOW the user holds `view_financials`.
 *
 * Fails closed by construction: `undefined` while the query is in flight and
 * on error alike, so this returns false until proven otherwise. That matters
 * more than it looks — a single render where a restricted number is painted
 * before the check resolves is exactly the leak the gate exists to prevent, and
 * a flicker in the other direction (money appearing a beat late for the three
 * people entitled to it) costs nothing.
 *
 * Reminder for callers: this is a SOFT gate. It hides numbers from the UI, the
 * CSV, the connector and the digest; it is not a security boundary, because any
 * analyst still has SELECT on the underlying columns. Don't describe it as one.
 */
export function useCanViewFinancials(): boolean {
  const { data } = useCapabilities()
  return data?.has(VIEW_FINANCIALS) ?? false
}
