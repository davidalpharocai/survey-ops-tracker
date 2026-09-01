/**
 * The "this number is calculated, you cannot type it" marker.
 *
 * WHY IT EXISTS: David, 2026-08-31 — "the financial fields: it's not clear which
 * fields i should edit vs which are calc fields". He was right, and the cause was
 * that the two states were only ever distinguished ON HOVER: an editable cell
 * reveals a pencil and tints its background, a calculated one does neither. At
 * rest "Total budget $6,000" and "Actual $ $2,825" render identically, so the
 * only way to learn which is which was to try.
 *
 * Structurally the app already had this right everywhere — every calculated
 * figure is a plain node and only typed fields get an editor. This is purely
 * about saying so on screen.
 *
 * A GLYPH, NOT A COLOUR. Calculated-ness is not good or bad news, so it must not
 * borrow the amber/red vocabulary that means "look at this". It also has to
 * survive being the only signal for a colour-blind reader.
 *
 * NOTE ON THE OTHER HALF: FieldCell's edit pencil is still hover-reveal
 * (opacity-0 / group-hover:opacity-100), so at rest a marked cell says
 * "calculated" and an unmarked one says nothing at all. That is the deliberate
 * choice — most fields are editable, so marking the exception carries the signal
 * and a pencil on every row would be noise — but it does mean the absence of a
 * mark is doing work, which is why the Money section carries a one-line legend
 * saying so outright. Do not describe the pencil as persistent; it is not.
 */
export function CalcMark({ from }: { from?: string }) {
  // The formula rides on the glyph's own `title`, NOT a second InfoTooltip.
  // Verified in the browser: an (i) here put TWO info icons on one label —
  // "COST (i) = (i)" — and a row with two explainers reads as though they
  // explain different things. Most of these rows already have an InfoTooltip
  // saying what the number means; this only has to say that it is computed.
  const explain = from
    ? `Calculated, not typed: ${from}`
    : 'Calculated by the app from the numbers above — there is nothing to type here.'

  return (
    <span
      title={explain}
      className="ml-1 cursor-help rounded bg-muted px-1 font-mono text-[10px] leading-[1.35] text-muted-foreground/80"
    >
      <span aria-hidden>=</span>
      <span className="sr-only">{explain}</span>
    </span>
  )
}
