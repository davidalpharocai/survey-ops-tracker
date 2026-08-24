import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

// Capabilities: additive per-user permissions that sit ALONGSIDE profiles.role
// rather than extending it. Everyone internal stays role = 'analyst', so the
// ~25 RLS policies and app gates that test `my_role() = 'analyst'` for exact
// equality keep passing untouched and a finance grant can never lock anyone out
// of the app. See supabase/migrations/079_capabilities.sql.
//
// ⚠️ NEVER fold a capability read into an auth gate's select. app/(app)/layout.tsx
// does `.from('profiles').select('role')` and redirect('/login') on ANY error
// from it. Migrations are applied by hand, hours or days after the code deploys,
// so there is a window in which profile_capabilities does not exist yet — a
// joined or widened gate select would fail for every request and sign the entire
// company out until the SQL runs. Everything here is therefore a SEPARATE query
// that swallows its own failure and answers "no capabilities": the worst case is
// that money is hidden from the three people who may see it for a few hours,
// never that anyone loses access to the tool.
//
// This is the general form of lib/utils/summaryPreview.ts (a hardcoded email
// allowlist, enforced in both the component and its API route). That file could
// be refactored onto this one once capabilities are wired up; deliberately not
// done yet.

/** The only capability so far: may see prices, margins and other money that is
 *  not the cost ceiling. Free text in the DB, so adding one here is enough. */
export const VIEW_FINANCIALS = 'view_financials'
export type Capability = typeof VIEW_FINANCIALS

/** Every capability held by the signed-in user (or `userId`, when the caller
 *  already has the user and doesn't need a second auth round-trip).
 *  Never throws: an empty set means "no capabilities", including when the table
 *  doesn't exist yet or the session can't be read. */
export async function getMyCapabilities(userId?: string): Promise<Set<Capability>> {
  try {
    const supabase = await createClient()
    const uid = userId ?? (await supabase.auth.getUser()).data.user?.id
    if (!uid) return new Set()

    // profile_capabilities isn't in the generated Database type yet (types are
    // regenerated in their own pass), so reach the table through an untyped
    // handle and narrow the rows the way the data hooks do.
    const db = supabase as unknown as SupabaseClient
    const { data, error } = await db
      .from('profile_capabilities')
      .select('capability')
      .eq('profile_id', uid)
    if (error || !data) return new Set()

    return new Set(
      (data as unknown as { capability: string }[]).map((r) => r.capability as Capability)
    )
  } catch {
    return new Set()
  }
}

/** True when the signed-in user may see financials. Defaults to false on any
 *  failure — the money stays hidden, the page still renders. */
export async function canViewFinancials(userId?: string): Promise<boolean> {
  return (await getMyCapabilities(userId)).has(VIEW_FINANCIALS)
}
