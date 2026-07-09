import Link from 'next/link';

import { SkeletonBlock, TableSkeleton } from '../_components/Skeletons';

// Instant shell for Client Contacts (search + flat contact table).
export default function Loading() {
  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Client Contacts</h1>
      <div className="filterbar">
        <SkeletonBlock height="2.4rem" width="18rem" />
      </div>
      <TableSkeleton cols={4} />
    </>
  );
}
