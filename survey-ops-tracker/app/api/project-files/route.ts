import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  ATTACHMENT_BUCKET, MAX_ATTACHMENT_BYTES, attachmentStoragePath, attachmentUrl, formatOf,
} from '@/lib/documents/attachments'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Upload and serve files attached to a survey record.
 *
 * POST  multipart {projectId, file}  -> { name, url, fmt, size }
 * GET   ?path=<storage path>         -> 302 to a short-lived signed url
 *
 * ── BOTH ENDS ARE ANALYST-GATED, AND THE BUCKET IS PRIVATE ──────────────────
 * The bytes are written and read with the service role, exactly as the
 * questionnaire upload does (app/api/parse-questionnaire/route.ts), so the
 * bucket needs no storage policies of its own and no client ever holds a
 * credential for it. The gate is the role check below, which is the same one
 * app/api/deliverables/upload/route.ts uses.
 *
 * A SALES OR COMPLIANCE SESSION IS REFUSED HERE, not merely unlinked. Those
 * tiers test `my_role()` as 'sales' and 'compliance' and both fail
 * `=== 'analyst'`, so neither can fetch an attachment even holding its exact
 * path. That is the whole reason these files are not in public.deliverables,
 * which migration 118 opened to the sales tier.
 *
 * The signed url is deliberately short-lived and generated per request. Storing
 * a signed url in linked_documents would leave a dead link behind an hour later
 * with nothing on screen to explain it.
 */

const SIGNED_URL_SECONDS = 60

async function requireAnalyst() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

export async function POST(req: Request) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    // A body over the platform limit dies before the route sees a field, so say
    // the likely reason rather than "malformed request".
    return NextResponse.json(
      { error: `Couldn't read the upload — is the file over ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB?` },
      { status: 413 },
    )
  }

  const projectId = form.get('projectId')
  const file = form.get('file')
  if (typeof projectId !== 'string' || !projectId || !(file instanceof File)) {
    return NextResponse.json({ error: 'projectId and a file are required' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'That file is empty.' }, { status: 400 })
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({
      error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit here is `
        + `${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB — put anything larger in Drive and paste the link.`,
    }, { status: 413 })
  }

  const admin = createAdminClient()

  // The project must exist and not be deleted. Checked rather than assumed: the
  // path is project-scoped, and an unchecked id would file bytes under a folder
  // that belongs to nothing and can never be found again.
  const { data: project, error: projectError } = await admin
    .from('survey_projects').select('id').eq('id', projectId).is('deleted_at', null).maybeSingle()
  if (projectError) return NextResponse.json({ error: 'Could not check the project.' }, { status: 500 })
  if (!project) return NextResponse.json({ error: 'No such project.' }, { status: 404 })

  const path = attachmentStoragePath(projectId, file.name, Date.now())
  const { error: uploadError } = await admin.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
  if (uploadError) {
    // The most likely cause by far is that the bucket has not been created yet,
    // so name it. A generic "upload failed" would send someone reading the
    // route rather than the one-line fix.
    return NextResponse.json({
      error: `Upload failed: ${uploadError.message}. If this says the bucket is missing, `
        + `the '${ATTACHMENT_BUCKET}' bucket has not been created yet — see migration 120.`,
    }, { status: 500 })
  }

  return NextResponse.json({
    name: file.name,
    url: attachmentUrl(path),
    fmt: formatOf(file.name),
    size: file.size,
  })
}

export async function GET(req: Request) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const path = new URL(req.url).searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'path is required' }, { status: 400 })
  // Belt and braces against a hand-edited entry: the writer already sanitises,
  // but this route will happily sign whatever it is handed otherwise.
  if (path.includes('..')) return NextResponse.json({ error: 'Bad path' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from(ATTACHMENT_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS)
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: 'That file is no longer available.' }, { status: 404 })
  }
  return NextResponse.redirect(data.signedUrl)
}
