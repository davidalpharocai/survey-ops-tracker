import Link from 'next/link';

import { TableSkeleton } from '../../_components/Skeletons';

export default function Loading() {
  return (
    <>
      <Link className="back" href="/reports">← Reports</Link>
      <h1>Credits and dollars remaining by client</h1>
      <TableSkeleton cols={7} />
    </>
  );
}
