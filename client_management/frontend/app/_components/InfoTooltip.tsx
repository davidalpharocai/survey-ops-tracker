// A small "(i)" info marker that reveals an explanation on hover or
// keyboard focus. CSS-only (this app has no component library); styles
// live in globals.css under "Info tooltip". Use it next to any domain
// label whose meaning isn't obvious, to guide correct data entry.
//
// `align` controls which way the popup opens: "center" (default) centers
// it over the icon; use "left" for icons near the page's left edge and
// "right" for icons near the right edge, so the popup opens inward instead
// of off-screen.

export default function InfoTooltip({
  text,
  align = 'center',
}: {
  text: string;
  align?: 'center' | 'left' | 'right';
}) {
  const popClass =
    align === 'left'
      ? 'info-pop align-left'
      : align === 'right'
        ? 'info-pop align-right'
        : 'info-pop';
  return (
    <span className="info" tabIndex={0} role="note" aria-label={text}>
      <span className="info-dot" aria-hidden="true">i</span>
      <span className={popClass} role="tooltip">{text}</span>
    </span>
  );
}
