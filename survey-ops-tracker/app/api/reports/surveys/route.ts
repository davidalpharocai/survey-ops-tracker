import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import {
  EVENT_DATE, resolvePeriod, surveyRows, projectRow,
  countScopedPlaceholders, placeholderNote,
  REPORT_FIELD_KEYS, DEFAULT_REPORT_FIELDS,
  type SurveyEvent, type SurveyType,
} from '@/lib/mcp/reports'

export const dynamic = 'force-dynamic'

// Downloadable .xlsx survey report. The connector's survey_report tool returns a
// link here; the (already-signed-in) analyst clicks it in their browser and the
// spreadsheet downloads. Auth is the normal app session — never anonymous.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const sp = req.nextUrl.searchParams
  const event = sp.get('event') as SurveyEvent | null
  if (!event || !(event in EVENT_DATE)) {
    return NextResponse.json({ error: 'event must be submitted | launched | delivered' }, { status: 400 })
  }
  const period = resolvePeriod({
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    date: sp.get('date') ?? undefined,
    month: sp.get('month') ? Number(sp.get('month')) : undefined,
    year: sp.get('year') ? Number(sp.get('year')) : undefined,
  })
  if ('error' in period) return NextResponse.json({ error: period.error }, { status: 400 })

  const type = (sp.get('type') as SurveyType | null) ?? undefined
  const fieldsParam = sp.get('fields')
  const fields = fieldsParam
    ? fieldsParam.split(',').map(s => s.trim()).filter(k => REPORT_FIELD_KEYS.includes(k))
    : DEFAULT_REPORT_FIELDS
  const useFields = fields.length ? fields : DEFAULT_REPORT_FIELDS

  const rows = await surveyRows({ event, from: period.from, to: period.to, type })
  const json = rows.map(r => projectRow(r, useFields))

  const ws = json.length
    ? XLSX.utils.json_to_sheet(json)
    : XLSX.utils.aoa_to_sheet([useFields]) // headers-only when empty

  // Footnote: placeholder waves (pending data) are excluded from the rows above —
  // append the same note the connector surfaces so a downloaded report never
  // silently omits them. Two rows below the data (blank spacer + note).
  const placeholders_excluded = await countScopedPlaceholders({ event, from: period.from, to: period.to, type })
  const placeholderClause = placeholderNote(placeholders_excluded)
  if (placeholderClause) XLSX.utils.sheet_add_aoa(ws, [[], [placeholderClause]], { origin: -1 })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Surveys')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const safe = period.label.replace(/[^0-9A-Za-z]+/g, '_')
  const fname = `surveys-${event}${type ? '-' + type : ''}-${safe}.xlsx`
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Cache-Control': 'no-store',
    },
  })
}
