// Naming for auto-spawned longitudinal rerun waves.

/** 1→"1st", 2→"2nd", 3→"3rd", 11→"11th", 21→"21st", … */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/** Strip a trailing " - Nth Rerun" so wave names never compound. */
export function baseRerunName(name: string): string {
  return name.replace(/\s*-\s*\d+(st|nd|rd|th)\s+Rerun\s*$/i, '').trim()
}

/** Name for the next wave: "[base] - Nth Rerun". */
export function nextRerunName(name: string, nextNumber: number): string {
  return `${baseRerunName(name)} - ${ordinal(nextNumber)} Rerun`
}
