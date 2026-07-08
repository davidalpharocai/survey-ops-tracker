// Date helpers.

export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
