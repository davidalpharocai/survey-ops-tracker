import Link from 'next/link';

import { SkeletonLine } from '../_components/Skeletons';

// Instant shell for the Manage Client List route: mirrors the real
// two-pane layout so the click paints immediately, then data fills in.
export default function Loading() {
  const rows = Array.from({ length: 9 }, (_, i) => i);
  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Manage Client List</h1>
      <p className="muted">Pick a client on the left to see and edit their full record.</p>

      <div className="two-pane">
        <aside className="pane-list">
          <div className="pane-list-header">
            <strong>Clients</strong>
          </div>
          <ul className="client-list">
            {rows.map(r => (
              <li key={r}>
                <a>
                  <SkeletonLine width="70%" />
                  <SkeletonLine width="40%" style={{ height: '0.65rem' }} />
                </a>
              </li>
            ))}
          </ul>
        </aside>
        <section className="pane-detail">
          <div className="empty-pane muted">
            <SkeletonLine width="40%" />
          </div>
        </section>
      </div>
    </>
  );
}
