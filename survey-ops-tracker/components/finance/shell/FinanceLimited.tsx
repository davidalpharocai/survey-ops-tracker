import Link from 'next/link'

/**
 * What someone without the finance permission sees at /finance: a plain,
 * friendly page that says who it is for and gives them a way back. Never a
 * crash, never a blank page, and never one number.
 *
 * No hooks and no client code, so the server layout can render it without
 * shipping anything, and the page can render the same words as its second
 * lock.
 */
export function FinanceLimited() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-foreground">Finance</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Finance is limited to the finance team: David, Shanu and Vineet.
      </p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Your projects, their costs and the Insights dashboard are all still open to you.
      </p>
      <p className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
        <Link href="/" className="font-medium text-primary underline-offset-2 hover:underline">
          Back to the board
        </Link>
        <Link href="/insights" className="text-primary underline-offset-2 hover:underline">
          Open Insights
        </Link>
      </p>
    </div>
  )
}
