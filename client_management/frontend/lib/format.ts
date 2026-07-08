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
