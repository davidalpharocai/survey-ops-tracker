/**
 * What someone sees at /finance when the permission read did not answer.
 *
 * Not the same page as FinanceLimited, on purpose. "Finance is limited to the
 * finance team: David, Shanu and Vineet" is a definite refusal that names three
 * people; printing it because a query timed out tells a finance holder
 * something untrue about their own account, with no reason and nothing to try.
 * A failed read is not a "no" — the same rule the rest of this page follows for
 * money (a table that did not load is "Blocked", never $0).
 *
 * Access is unchanged: the children are never rendered here either. Only the
 * words and the way out differ.
 *
 * RELOAD IS A PLAIN <a>, ON PURPOSE: a client-side navigation to the same route
 * would not necessarily re-ask, and a full request re-runs the server gate.
 * "Back to the board" is a different journey and uses <Link>, which is also
 * what `@next/next/no-html-link-for-pages` requires — a bare <a href="/"> fails
 * the production build, which is how this was found. Link still renders a real
 * <a href> in the DOM, so right-click, middle-click and copy-link all work.
 */
import Link from 'next/link'

export function FinanceUnavailable() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-foreground">Finance</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        We could not check your access just now.
      </p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Nothing is wrong with your account and nothing was changed. Reload to try again; if it keeps
        failing, check your connection and try again in a few minutes.
      </p>
      <p className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
        <a href="/finance" className="font-medium text-primary underline-offset-2 hover:underline">
          Reload
        </a>
        <Link href="/" className="text-primary underline-offset-2 hover:underline">
          Back to the board
        </Link>
      </p>
    </div>
  )
}
