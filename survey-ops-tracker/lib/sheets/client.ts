import 'server-only'
import { google } from 'googleapis'
import { getGoogleAuth } from '@/lib/drive/google'
import { SURVEYS_TAB, SHEET_WIDTH } from '@/lib/sheets/surveysMap'

const SHEET_ID = '1ZTTJ0PQZ7vj13tmZmsMvKAcEEf0Nc0s8dVbfaYJju7Q'

const lastCol = (() => {
  let s = ''
  let n = SHEET_WIDTH
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
})() // 'AN'

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

export async function appendRow(row: string[]): Promise<void> {
  await sheets().spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SURVEYS_TAB}!A:${lastCol}`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  })
}

export async function updateCells(data: { range: string; values: string[][] }[]): Promise<void> {
  await sheets().spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  })
}
