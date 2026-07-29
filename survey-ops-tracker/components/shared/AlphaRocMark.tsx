// The AlphaROC / Occam brand mark — an "o" (ring) with a line through it. Drawn
// in currentColor so it tints to its context: brand color in the top nav, the
// flag's tone on the Occam chip. This is a clean recreation of the logo swirl;
// drop in the brand's exact SVG (swap the two shapes) for a pixel-perfect match.
export function AlphaRocMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.5" />
      <line x1="6.8" y1="17.2" x2="17.2" y2="6.8" />
    </svg>
  )
}
