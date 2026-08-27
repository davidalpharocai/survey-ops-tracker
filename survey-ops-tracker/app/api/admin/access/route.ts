import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canManagePermissions } from '@/lib/auth/capabilities'

export const dynamic = 'force-dynamic'

// Access administration: who holds which role, and the only sanctioned way to
// change it from the app.
//
// THREE INDEPENDENT GATES, and the whole design assumes any one of them could be
// wrong on its own:
//
//  1. This route checks manage_permissions before doing anything (below).
//  2. Migration 085's grant_role/revoke_role/grant_capability/revoke_capability
//     have NO `authenticated` EXECUTE grant — only service_role. So even a forged
//     request that somehow reached PostgREST directly with a user's anon token
//     cannot call them.
//  3. Those functions refuse a self-grant of anything flagged is_sensitive, and
//     refuse to revoke the last admin, no matter who is asking. Guardrails that
//     hold even when the caller legitimately holds manage_permissions.
//
// profile_roles is also service-role-write-only at the RLS level, and `profiles`
// has no INSERT/UPDATE policy for `authenticated` at all (008 grants SELECT
// only), so there is no path from a browser to promoting anybody — including
// yourself.

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  // Deliberately NOT folded into one select with the profile gate — see the
  // warning in lib/auth/capabilities.ts. Pre-085 this answers false and the
  // panel is simply unavailable; it never signs anyone out.
  return (await canManagePermissions(user.id)) ? user : null
}

/** Everything the Access panel renders: each account with its tier, roles and
 *  direct grants, plus the catalogues so the UI can describe what a role does. */
export async function GET() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const [profiles, roles, permissions, bundles, assigned, direct, audit] = await Promise.all([
    admin.from('profiles').select('id, email, full_name, role').order('email'),
    admin.from('roles').select('name, description').order('name'),
    admin.from('permissions').select('name, description, is_sensitive').order('name'),
    admin.from('role_permissions').select('role, permission'),
    admin.from('profile_roles').select('profile_id, role, granted_by, granted_at'),
    admin.from('profile_capabilities').select('profile_id, capability, granted_by'),
    admin.from('permission_audit').select('at, actor, action, subject, target, reason').order('at', { ascending: false }).limit(50),
  ])

  // 085 not applied yet: the catalogues 404 and the panel should say so rather
  // than render an empty grid that looks like "nobody has any access".
  if (roles.error || assigned.error) {
    return NextResponse.json(
      { error: 'Roles need migration 085 in Supabase, then reload.', needsMigration: true },
      { status: 503 }
    )
  }

  const rolesByProfile = new Map<string, string[]>()
  for (const r of assigned.data ?? []) {
    rolesByProfile.set(r.profile_id, [...(rolesByProfile.get(r.profile_id) ?? []), r.role])
  }
  const directByProfile = new Map<string, string[]>()
  for (const c of direct.data ?? []) {
    directByProfile.set(c.profile_id, [...(directByProfile.get(c.profile_id) ?? []), c.capability])
  }

  return NextResponse.json({
    people: (profiles.data ?? []).map((p) => ({
      id: p.id,
      email: p.email,
      name: p.full_name,
      tier: p.role,
      roles: rolesByProfile.get(p.id) ?? [],
      direct: directByProfile.get(p.id) ?? [],
    })),
    roles: roles.data ?? [],
    permissions: permissions.data ?? [],
    bundles: bundles.data ?? [],
    audit: audit.data ?? [],
  })
}

const ACTIONS = ['grant_role', 'revoke_role', 'grant_capability', 'revoke_capability'] as const
type Action = (typeof ACTIONS)[number]

export async function POST(req: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { action?: string; subject_id?: string; target?: string; reason?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const action = body.action as Action
  const subjectId = (body.subject_id ?? '').trim()
  const target = (body.target ?? '').trim()
  const reason = (body.reason ?? '').trim() || null

  if (!ACTIONS.includes(action)) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  if (!subjectId) return NextResponse.json({ error: 'Who is this for?' }, { status: 400 })
  if (!target) return NextResponse.json({ error: 'Which role or permission?' }, { status: 400 })

  const admin = createAdminClient()

  // Validate the target against the catalogue so a typo is a clear 400 rather
  // than a row nobody will ever match. The RPCs check roles too; capabilities
  // are free text in the DB by 079's design, so this is the only place a
  // misspelled capability gets caught.
  const isRole = action === 'grant_role' || action === 'revoke_role'
  const { data: known } = isRole
    ? await admin.from('roles').select('name').eq('name', target).maybeSingle()
    : await admin.from('permissions').select('name').eq('name', target).maybeSingle()
  if (!known) {
    return NextResponse.json(
      { error: `${isRole ? 'Role' : 'Permission'} "${target}" doesn't exist.` },
      { status: 400 }
    )
  }

  // The actor's email is what lands in the audit log, so it has to be the
  // signed-in user's own address — never anything from the request body.
  const actor = user.email ?? user.id

  // Branched rather than built with a computed key, so each call is typed
  // against migration 085's real signature: the role functions take p_role and
  // the capability ones take p_capability, and a mismatch there would be a
  // silent no-op (PostgREST would report success for a function it never found
  // the named argument on).
  const common = { p_actor_id: user.id, p_actor: actor, p_subject_id: subjectId, p_reason: reason }
  const { error } =
    action === 'grant_role'
      ? await admin.rpc('grant_role', { ...common, p_role: target })
      : action === 'revoke_role'
        ? await admin.rpc('revoke_role', { ...common, p_role: target })
        : action === 'grant_capability'
          ? await admin.rpc('grant_capability', { ...common, p_capability: target })
          : await admin.rpc('revoke_capability', { ...common, p_capability: target })

  if (error) {
    // 085's guardrails (self-grant refused, last admin protected) come back as
    // exceptions. Their messages are written to be read by a person, so pass
    // them straight through rather than flattening to "something went wrong".
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
