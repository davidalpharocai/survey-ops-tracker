// Canonical salesperson names (full names, per David June 2026).
// "Internal" marks projects with no external sales lead.
export const SALESPEOPLE = [
  'Alex Pinsky',
  'Jenna Shrove',
  'Steven Stubbs',
  'Vineet Kapur',
  'Internal',
] as const

/** Dropdown options: the canonical list, plus the current value if it's something else (legacy data). */
export function salespersonOptions(current: string | null | undefined): string[] {
  const list: string[] = [...SALESPEOPLE]
  if (current && !list.includes(current)) list.unshift(current)
  return list
}
