// Decide what the Survey IDs field should be after a sheet sync.
//
// Rules (per workflow design):
// 1. If the field is blank, fill it from the sheet.
// 2. If the sheet's IDs changed since the last sync, the sheet wins.
// 3. Otherwise keep the current value (preserves manual edits).

function norm(v: string | null | undefined): string {
  return (v ?? '').trim()
}

export function resolveSurveyIds(
  current: string | null,
  lastSheetValue: string | null,
  incomingSheetValue: string | null
): { next: string | null; changed: boolean } {
  const incoming = norm(incomingSheetValue)
  const cur = norm(current)
  const last = norm(lastSheetValue)

  if (!incoming) return { next: current, changed: false }
  if (!cur) return { next: incoming, changed: true }
  if (incoming !== last) return { next: incoming, changed: incoming !== cur }
  return { next: current, changed: false }
}
