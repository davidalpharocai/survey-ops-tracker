/**
 * Small teal-outline chip marking the Rerun DIMENSION — a repeat wave of an
 * earlier study. Deliberately distinct from the solid PS=blue / B2B=violet
 * type badges (Rerun is not a type) and from the emerald compliance chip
 * (outline + icon differentiates it at a glance).
 */
export function RerunChip({ className = '' }: { className?: string }) {
  return (
    <span
      title="Rerun — a repeat wave of an earlier study. The PS/B2B badge is its base survey type."
      className={`inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded border border-teal-500/60 text-teal-700 dark:text-teal-300 bg-transparent whitespace-nowrap ${className}`}
    >
      ↻ Rerun
    </span>
  )
}
