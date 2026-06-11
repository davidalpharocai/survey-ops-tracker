// Extract the survey ID from an Edwin link's source= parameter.
// e.g. https://www.edwin.alpharoc.ai/survey?source=BFFIREDONOR202605&transaction_id=...
//      -> BFFIREDONOR202605
export function extractEdwinSurveyId(url: string): string | null {
  try {
    const u = new URL(url)
    if (!u.hostname.includes('edwin')) return null
    const source = u.searchParams.get('source')
    return source?.trim() || null
  } catch {
    return null
  }
}

// linked_documents entries are plain URLs or JSON {"name","url"}
export function findEdwinUrl(documents: string[] | null): string | null {
  for (const entry of documents ?? []) {
    let url = entry
    if (entry.startsWith('{')) {
      try {
        url = JSON.parse(entry).url ?? ''
      } catch {
        continue
      }
    }
    if (url.includes('edwin')) return url
  }
  return null
}
