export function evalSum(s: string): number | null {
  const t = String(s).trim()
  if (t[0] !== '=') return null
  const expr = t.slice(1).replace(/,/g, '').replace(/\s+/g, '')
  if (!/^[-+]?\d*\.?\d+([-+]\d*\.?\d+)*$/.test(expr)) return null
  const m = expr.match(/[+-]?\d*\.?\d+/g)
  if (!m) return null
  return m.reduce((a, x) => a + parseFloat(x), 0)
}

export function commitNumber(raw: string): string {
  const s = String(raw).trim()
  if (s === '' || s === '—') return '—'
  if (s[0] === '=') { const r = evalSum(s); return r == null ? s : Math.round(r).toLocaleString() }
  const n = s.replace(/,/g, '')
  return /^-?\d+(\.\d+)?$/.test(n) ? Math.round(parseFloat(n)).toLocaleString() : raw
}
