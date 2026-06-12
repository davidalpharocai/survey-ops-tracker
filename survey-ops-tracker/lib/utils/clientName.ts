/**
 * Normalize a project's free-text client field ("FIRM - Contact").
 * The contact part gets each word's first letter capitalized so "jared khoo"
 * becomes "Jared Khoo"; everything already typed with intent (DeSantis,
 * "L. Valentina", "IC MainFrame") is left alone. The firm part is never
 * touched — firm names come from the approved client list.
 */
export function normalizeClientText(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  const idx = trimmed.indexOf(' - ')
  if (idx === -1) return trimmed
  const firm = trimmed.slice(0, idx)
  const contact = trimmed
    .slice(idx + 3)
    .replace(/(^|[\s./&(-])([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase())
  return `${firm} - ${contact}`
}
