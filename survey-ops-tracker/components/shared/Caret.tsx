import { cn } from '@/lib/utils'

/**
 * Shared expand/collapse caret — a bold chevron that points right when closed
 * and rotates to point down when open. Larger and heavier (strokeWidth) than the
 * old thin ▸/▾ text glyphs, so the expand/collapse affordance is obvious. Draws
 * in currentColor; set a color via className (e.g. text-primary). Works in flex
 * rows (items-center) and inline next to text (align nudge).
 */
export function Caret({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn(
        'inline-block h-3.5 w-3.5 shrink-0 align-[-0.15em] transition-transform duration-150',
        open && 'rotate-90',
        className,
      )}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}
