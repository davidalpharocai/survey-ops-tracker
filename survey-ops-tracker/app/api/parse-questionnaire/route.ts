import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractText, kindFromFilename } from '@/lib/parsing/extract-text'
import { parseQuestionnaire, type ParseInput } from '@/lib/parsing/claude-parser'

export const maxDuration = 120 // Claude parsing of long questionnaires takes time

const MAX_FILE_BYTES = 10 * 1024 * 1024 // Anthropic caps requests at 32MB; stay well under

async function requireAnalyst() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

export async function POST(request: Request) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const projectId = formData.get('projectId') as string | null
  if (!file || !projectId) {
    return NextResponse.json({ error: 'file and projectId are required' }, { status: 400 })
  }

  const kind = kindFromFilename(file.name)
  if (kind === 'unsupported') {
    return NextResponse.json(
      { error: 'Unsupported file type. Use .docx, .xlsx, .csv, or .pdf (export Google Docs first; re-save legacy .doc as .docx).' },
      { status: 400 }
    )
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: 'File is too large (max 10 MB). Split the questionnaire or export a smaller version.' },
      { status: 400 }
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  // Store the source file (service role; bucket is private)
  const admin = createAdminClient()
  const path = `${projectId}/${Date.now()}-${file.name.replace(/[^\w.\- ]/g, '_')}`
  const { error: uploadError } = await admin.storage
    .from('questionnaires')
    .upload(path, buffer, { contentType: file.type || 'application/octet-stream' })
  if (uploadError) {
    return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 })
  }

  // Extract + parse
  try {
    const input: ParseInput =
      kind === 'pdf'
        ? { kind: 'pdf', base64: buffer.toString('base64') }
        : { kind: 'text', text: await extractText(buffer, file.name) }

    const result = await parseQuestionnaire(input)
    if (!result.ok && result.questions.length === 0) {
      return NextResponse.json(
        { error: result.errors.join('; '), sourceFilePath: path, sourceFileName: file.name },
        { status: 422 }
      )
    }
    return NextResponse.json({
      questions: result.questions,
      warnings: result.errors,
      sourceFilePath: path,
      sourceFileName: file.name,
    })
  } catch (e) {
    // Don't leak SDK/internal error strings to the UI for unexpected failures;
    // extraction errors (extractText) carry user-actionable messages.
    const message =
      e instanceof Error && /unsupported file type/i.test(e.message)
        ? e.message
        : 'Could not parse the document. You can retry, or enter the questions manually.'
    return NextResponse.json(
      { error: message, sourceFilePath: path, sourceFileName: file.name },
      { status: 422 }
    )
  }
}
