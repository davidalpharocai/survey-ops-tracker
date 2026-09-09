'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { SalesSearch } from './SalesSearch'

/**
 * The sales tier's navigation ribbon.
 *
 * WRITTEN FRESH RATHER THAN REUSING TopNav, and that is not laziness in reverse.
 * components/shared/TopNav.tsx fires three live queries — email_inbox,
 * deliverables and rerun_series_status — to drive its unread badges. None of
 * those has a sales policy, so for a salesperson two would be denied reads and
 * the third resolves to zero rows: three silent zeros and two errors on every
 * page load, to render badges for surfaces they cannot open. Forking the
 * component would mean carrying that.
 *
 * Four destinations, which is few enough for a horizontal ribbon and is exactly
 * what David named. Order is deliberate: Surveys first because it is the reason
 * they open the tool, Accounts and Contacts as the two ways of slicing the same
 * book, and What's new last because it is read once a week, not once an hour.
 *
 * No Home/dashboard tab. A digest page is the right idea eventually, but a fifth
 * tab that duplicates the first is worse than none — and until credits are
 * populated there is nothing for a digest to say that the Surveys list does not
 * already show.
 */

const TABS = [
  { href: '/sales/surveys', label: 'Surveys' },
  { href: '/sales/accounts', label: 'Accounts' },
  { href: '/sales/contacts', label: 'Contacts' },
  { href: '/sales/whats-new', label: "What's new" },
] as const

export function SalesNav({ name }: { name: string | null }) {
  const pathname = usePathname()

  return (
    <nav className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-6xl items-center gap-1 px-6 py-2">
        <Link href="/sales/surveys" className="mr-3 shrink-0 text-sm font-bold hover:opacity-80">
          AlphaROC
        </Link>

        {TABS.map(t => {
          // startsWith, so a survey or account detail page keeps its parent tab
          // lit rather than leaving the ribbon looking like nowhere is selected.
          const active = pathname === t.href || pathname.startsWith(t.href + '/')
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                active
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {t.label}
            </Link>
          )
        })}

        <div className="ml-auto flex items-center gap-2">
          <SalesSearch />
          <ThemeToggle />
          {/* Whose book this is. Small, but a scoped tool that never says whose
              scope it is showing reads as a tool that is missing data. */}
          {name && (
            <span className="hidden shrink-0 pl-1 text-xs text-muted-foreground sm:inline">{name}</span>
          )}
        </div>
      </div>
    </nav>
  )
}
