// Best-effort mimic of the Occam logo — an "o" (ring) with a line through it,
// drawn in currentColor so it takes the flag chip's tone (sky when on, muted
// when off). (The AlphaROC nav logo is the real alpharoc-logo.png, separate.)
export function OccamMark({ className }: { className?: string }) {
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
