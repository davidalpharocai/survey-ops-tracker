import Link from 'next/link';

import { SkeletonBlock, TableSkeleton } from '../../_components/Skeletons';

export default function Loading() {
  return (
    <>
      <Link className="back" href="/reports">← Reports</Link>
      <h1>Contracts &amp; Surveys</h1>
      <div className="filterbar">
        <SkeletonBlock height="2.4rem" width="18rem" />
      </div>
      <TableSkeleton cols={9} />
    </>
  );
}
