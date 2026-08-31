import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

/**
 * Gate for the sales tier, mirroring requirePortalUser (lib/portal-auth.ts).
 *
 * Returns the USER'S OWN Supabase client, deliberately — not the admin client.
 * Migration 093 scopes survey_projects for the sales tier to
 * `salesperson = my_salesperson_name()`, so a query made through this handle
 * physically cannot return another salesperson's projects. Reaching for
 * createAdminClient() here would bypass RLS and put the whole boundary back into
 * app code, which is the soft gate David explicitly moved away from.
 *
 * Redirects, never throws: an unauthenticated visitor goes to login carrying
 * their intended path, and anyone who is not a salesperson is sent to `/` where
 * their own tier's layout will place them correctly.
 */
export async function requireSalesUser(nextPath: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`)

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  // Any failure sends them to the root rather than showing an empty pipeline. An
  // empty list is indistinguishable from "you have no projects", and a
  // salesperson who cannot tell those apart will assume the tool is lying.
  if (error || !profile) redirect('/')
  if (profile.role !== 'sales') redirect('/')

  return { supabase, user }
}

/** The signed-in salesperson's canonical name, read from the same
 *  `salespeople` table RLS uses (093) rather than from the TypeScript constant
 *  in lib/utils/salespeople.ts.
 *
 *  One source of truth on purpose: if the display name here and the name RLS
 *  filters on could disagree, the page would say "Alex Pinsky" while showing
 *  rows scoped to something else. Null when the account is not an active
 *  salesperson — which the gate above has already ruled out, so it is a
 *  belt-and-braces read rather than an expected branch. */
export async function mySalespersonName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string | null | undefined
): Promise<string | null> {
  if (!email) return null
  const { data } = await supabase
    .from('salespeople')
    .select('canonical_name')
    .ilike('email', email)
    .eq('active', true)
    .maybeSingle()
  return data?.canonical_name ?? null
}
