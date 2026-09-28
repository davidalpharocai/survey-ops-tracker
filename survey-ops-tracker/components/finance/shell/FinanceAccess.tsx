'use client'

import { createContext, useContext } from 'react'

/**
 * "The server checked, and this reader may see Finance."
 *
 * app/(app)/finance/layout.tsx decides access on the SERVER with
 * canViewFinancials() and only renders the page inside this provider when the
 * answer is yes. The page reads it back as its second lock: rendered anywhere
 * else — a future route that reuses the page, a test, a refactor that drops the
 * layout — it has no provider, reads `false`, and shows the limited-access page
 * instead of loading a single number.
 *
 * Why not the browser's own capability hook (useCanViewFinancials)? It is
 * false while it loads and false on any read error, so a finance holder's
 * first paint would compute every figure without prices and then recompute.
 * The server already answered; this carries that answer down.
 */
const FinanceAccessContext = createContext(false)

export function FinanceAccessProvider({ verified, children }: { verified: boolean; children: React.ReactNode }) {
  return <FinanceAccessContext.Provider value={verified}>{children}</FinanceAccessContext.Provider>
}

/** True only inside the server gate, and only when it said yes. */
export function useFinanceAccess(): boolean {
  return useContext(FinanceAccessContext)
}
