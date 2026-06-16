// Internal project type: workflow stages and category options.
export const INTERNAL_STAGES = ['Backlog', 'In Progress', 'Review', 'Done'] as const
export type InternalStage = (typeof INTERNAL_STAGES)[number]

export const INTERNAL_CATEGORIES = [
  'Product',
  'Hiring',
  'Tooling',
  'Marketing',
  'Ops',
  'Research',
  'Other',
] as const

export const INTERNAL_DEFAULT_CLIENT = 'AlphaROC'

export function isInternalStage(col: string): col is InternalStage {
  return (INTERNAL_STAGES as readonly string[]).includes(col)
}

/** Category dropdown options — the canonical list plus any legacy value still in use. */
export function categoryOptions(current: string | null | undefined): string[] {
  const list: string[] = [...INTERNAL_CATEGORIES]
  if (current && !list.includes(current)) list.unshift(current)
  return list
}
