// Display helpers for templates.

type Numeric = number | string | { toNumber(): number } | null | undefined;

function toNum(v: Numeric): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  if (typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber();
  return Number(v);
}

export function dollars(v: Numeric): string {
  const n = toNum(v);
  if (n == null) return '—';
  return '$' + Math.round(n).toLocaleString('en-US');
}

export function dollarsSigned(v: Numeric): string {
  const n = toNum(v);
  if (n == null || n === 0) return '';
  const sign = n > 0 ? '+' : '-';
  return sign + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
}

export function credits(v: Numeric): string {
  const n = toNum(v);
  if (n == null) return '—';
  return Math.round(n).toLocaleString('en-US');
}

export function creditsSigned(v: Numeric): string {
  const n = toNum(v);
  if (n == null || n === 0) return '';
  const sign = n > 0 ? '+' : '';
  return sign + Math.round(n).toLocaleString('en-US');
}

// Current-year contract value, showing whichever currency the client
// actually contracted in: credits, dollars, both, or "—". Credit-only
// clients previously read "$0"; now they read their credit value.
export function contractValue(cyCredits: Numeric, cyDollars: Numeric): string {
  const cr = toNum(cyCredits) ?? 0;
  const dl = toNum(cyDollars) ?? 0;
  const parts: string[] = [];
  if (cr > 0) parts.push(`${credits(cr)} cr`);
  if (dl > 0) parts.push(dollars(dl));
  return parts.length ? parts.join(' · ') : '—';
}

export function isoDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '';
  if (typeof d === 'string') d = new Date(d);
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}
