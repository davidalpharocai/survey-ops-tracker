import 'server-only'
import { google } from 'googleapis'
import { getGoogleAuth } from '@/lib/drive/google'
import { SURVEYS_TAB } from '@/lib/sheets/surveysMap'

const SHEET_ID = '1ZTTJ0PQZ7vj13tmZmsMvKAcEEf0Nc0s8dVbfaYJju7Q'

// The section divider new active-survey rows must be inserted ABOVE (rows below
// it are Scoping / On-Hold). Never bottom-append — that dumps new rows far below
// the working area (David's standing rule).
export const SCOPING_MARKER = 'SCOPING PHASE'

function sheets() {
  return google.sheets({ version: 'v4', auth: getGoogleAuth() })
}

export async function readHeader(): Promise<string[]> {
  const res = await sheets().spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${SURVEYS_TAB}!1:1` })
  return (res.data.values?.[0] ?? []) as string[]
}

/** Map of PR-code -> 1-based sheet row number (data starts at row 2). */
export async function readPrCodeRows(): Promise<Map<string, number>> {
  const res = await sheets().spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${SURVEYS_TAB}!AM2:AM` })
  const rows = res.data.values ?? []
  const map = new Map<string, number>()
  rows.forEach((r, i) => {
    const pr = String(r?.[0] ?? '').trim()
    if (pr) map.set(pr, i + 2)
  })
  return map
}

/** Numeric gridId of the Surveys tab — required by structural batchUpdate requests. */
export async function getSurveysSheetId(): Promise<number> {
  const res = await sheets().spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets(properties(sheetId,title))' })
  const s = (res.data.sheets ?? []).find((x) => x.properties?.title === SURVEYS_TAB)
  const id = s?.properties?.sheetId
  if (id == null) throw new Error(`Surveys tab (${SURVEYS_TAB}) not found`)
  return id
}

/** 1-based row of the "SCOPING PHASE / ON HOLD" divider in column A, or null if
 *  it can't be found. Callers MUST NOT fall back to a bottom append on null. */
export async function findScopingRow(): Promise<number | null> {
  const res = await sheets().spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${SURVEYS_TAB}!A1:A` })
  const col = res.data.values ?? []
  for (let i = 0; i < col.length; i++) {
    if (String(col[i]?.[0] ?? '').trim().toUpperCase().includes(SCOPING_MARKER)) return i + 1
  }
  return null
}

/** Insert `count` blank rows immediately ABOVE `rowNumber` (1-based), inheriting
 *  formatting from the row above so inserted active-survey rows match the section.
 *  Rows at/after `rowNumber` shift down by `count`. */
export async function insertRowsAbove(sheetId: number, rowNumber: number, count: number): Promise<void> {
  if (count <= 0) return
  await sheets().spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          insertDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber - 1 + count },
            inheritFromBefore: true,
          },
        },
      ],
    },
  })
}

export async function updateCells(data: { range: string; values: string[][] }[]): Promise<void> {
  await sheets().spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  })
}
