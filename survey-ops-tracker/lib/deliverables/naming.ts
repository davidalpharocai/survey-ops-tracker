// lib/deliverables/naming.ts
export function sanitizeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
}

export function isoToDot(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '.')
}

// One-shot projects get a date-stamped folder. Reruns (longitudinal surveys) get ONE undated parent
// folder — `{name}_{code}` — so every weekly/monthly wave stacks inside it as its own dated file,
// instead of spawning a new dated folder per wave.
export function projectFolderName(projectName: string, projectCode: string, deliveredISO: string, isRerun = false): string {
  const base = `${sanitizeName(projectName)}_${projectCode}`
  return isRerun ? base : `${base}_${isoToDot(deliveredISO)}`
}

export function deliverableFileName(dateISO: string, originalName: string): string {
  return `${isoToDot(dateISO)} — ${sanitizeName(originalName)}`
}

// Prefer the original "Date:" inside a "Forwarded message" block; else the fallback (the message's own Date).
export function originalSendDate(body: string, fallbackISO: string): string {
  const m = body.match(/Forwarded message[\s\S]{0,400}?\n\s*Date:\s*(.+)/i)
  if (m) {
    // Gmail formats dates as "Mon, Jun 1, 2026 at 9:14 AM" — strip the "at HH:MM AM/PM" suffix before parsing.
    const cleaned = m[1].trim().replace(/\s+at\s+\d+:\d+\s*(AM|PM)?$/i, '').trim()
    const d = new Date(cleaned)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return fallbackISO
}
