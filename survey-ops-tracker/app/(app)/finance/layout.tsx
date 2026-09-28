import { financeAccess } from '@/lib/auth/capabilities'
import { FinanceAccessProvider } from '@/components/finance/shell/FinanceAccess'
import { FinanceLimited } from '@/components/finance/shell/FinanceLimited'
import { FinanceUnavailable } from '@/components/finance/shell/FinanceUnavailable'

// Decided per request, from the session. Never cached: a grant or a removal
// must take effect on the next visit, not the next deploy.
export const dynamic = 'force-dynamic'

/**
 * The finance gate, enforced on the SERVER (David, 2026-09-24: /finance is for
 * view_financials holders only — David, Shanu and Vineet).
 *
 * Before this, /finance was open to every analyst and each tile carried its
 * own `canFinance` branch, so one forgotten branch printed a budget to the
 * whole fielding team (finance spec, defect 10). Now the question is answered
 * once, here, before the page is sent: without the permission the children are
 * never rendered, so none of the page's code runs and none of its data is read.
 *
 * FAILS CLOSED, and says which kind of "not yes" it is. `financeAccess()`
 * answers 'yes', a definite 'no', or 'unknown' — the read itself did not come
 * back. Only 'yes' renders the page, so every other answer hides the money
 * exactly as before; the difference is the words. A definite no reads "Finance
 * is limited to the finance team", which names three people and is a fact about
 * the reader. A failed read must never say that: a finance holder whose query
 * hiccuped would be told something untrue about their own account with nothing
 * to try, which is the "a failed read is not $0 and not none" rule applied to
 * the gate itself. The try/catch covers a failure financeAccess cannot see — a
 * thrown import, a broken session helper — and lands in the same honest place,
 * because a gate that threw did not decide anything about this person either.
 *
 * The sales and compliance tiers never reach this layout: app/(app)/layout.tsx
 * sends them to their own surfaces first. "View as" hands the admin the
 * target's real session, so the check below answers for the person being
 * viewed, exactly as it should.
 */
export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  let answer: string
  try {
    answer = await financeAccess()
  } catch {
    answer = 'unknown'
  }
  if (answer === 'yes') return <FinanceAccessProvider verified>{children}</FinanceAccessProvider>
  // Anything that is not a clear 'no' — including a value this code does not
  // recognise — is treated as "we could not tell", never as a refusal.
  return answer === 'no' ? <FinanceLimited /> : <FinanceUnavailable />
}
