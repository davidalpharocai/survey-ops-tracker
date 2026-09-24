import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { SalesIdentity } from '@/lib/sales/identity'

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
  return (await mySalesIdentity(supabase, email)).name
}

/** The name above, plus whose book this person works when it is not their own
 *  (121). See lib/sales/identity.ts for why the page needs to say so.
 *
 *  select('*') rather than naming sees_book_of: 121 is applied by hand, and
 *  PostgREST rejects a whole select when one named column does not exist yet,
 *  which would take the person's own name off every page along with it. Before
 *  121 the field is simply absent and bookOf is null, which is the truth. */
export async function mySalesIdentity(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string | null | undefined
): Promise<SalesIdentity> {
  if (!email) return { name: null, bookOf: null }
  const { data } = await supabase
    .from('salespeople')
    .select('*')
    .ilike('email', email)
    .eq('active', true)
    .maybeSingle()
  const row = data as { canonical_name?: string | null; sees_book_of?: string | null } | null
  return { name: row?.canonical_name ?? null, bookOf: row?.sees_book_of ?? null }
}
