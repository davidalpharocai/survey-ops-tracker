// A small "(i)" info marker that reveals an explanation on hover or
// keyboard focus. CSS-only (this app has no component library); styles
// live in globals.css under "Info tooltip". Use it next to any domain
// label whose meaning isn't obvious, to guide correct data entry.

export default function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="info" tabIndex={0} role="note" aria-label={text}>
      <span className="info-dot" aria-hidden="true">i</span>
      <span className="info-pop" role="tooltip">{text}</span>
    </span>
  );
}
