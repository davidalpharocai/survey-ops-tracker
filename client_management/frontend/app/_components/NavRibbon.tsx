'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Persistent primary navigation in the top bar. Kept as a client
// component so it can highlight the active section via usePathname.

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

interface NavItem {
  href: string;
  label: string;
  exact?: boolean;
}

const LINKS: NavItem[] = [
  { href: '/', label: 'Home', exact: true },
  { href: '/studies', label: 'Studies' },
  { href: '/contracts', label: 'Contracts' },
  { href: '/clients', label: 'Clients' },
  { href: '/users', label: 'Contacts' },
  { href: '/reports', label: 'Reports' },
];

const ADMIN_LINK: NavItem = { href: '/admin', label: 'Admin' };
const APPROVALS_LINK: NavItem = { href: '/approvals', label: 'Approvals' };

export default function NavRibbon({ isAdmin, isApprover }: { isAdmin: boolean; isApprover?: boolean }) {
  // usePathname() normally excludes basePath, but strip it defensively so
  // active-state works regardless of how the host reports the path.
  const raw = usePathname() || '/';
  const path = BASE && raw.startsWith(BASE) ? raw.slice(BASE.length) || '/' : raw;

  const links = [
    ...LINKS,
    ...(isApprover ? [APPROVALS_LINK] : []),
    ...(isAdmin ? [ADMIN_LINK] : []),
  ];

  const isActive = (item: NavItem): boolean =>
    item.exact ? path === item.href : path === item.href || path.startsWith(item.href + '/');

  return (
    <nav className="nav-ribbon" aria-label="Primary">
      {links.map(item => {
        const active = isActive(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? 'is-active' : ''}
            aria-current={active ? 'page' : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
