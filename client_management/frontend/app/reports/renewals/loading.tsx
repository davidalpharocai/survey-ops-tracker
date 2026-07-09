import Link from 'next/link';

import { TableSkeleton } from '../../_components/Skeletons';

export default function Loading() {
  return (
    <>
      <Link className="back" href="/reports">← Reports</Link>
      <h1>Renewal Radar</h1>
      <TableSkeleton cols={6} />
    </>
  );
}
