// lib/deliverables/display-name.ts
export function normalizeDisplayName(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = raw.replace(/\s+/g, ' ').trim()
  if (trimmed === '') return null
  return trimmed.slice(0, 200)
}
