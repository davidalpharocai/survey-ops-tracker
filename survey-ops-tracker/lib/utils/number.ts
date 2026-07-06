/** Format a count/quantity with thousands separators, e.g. 3000 -> "3,000". */
export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return n.toLocaleString('en-US')
}
