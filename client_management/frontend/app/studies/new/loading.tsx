import Link from 'next/link';

import { SkeletonBlock } from '../../_components/Skeletons';

export default function Loading() {
  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Record a Study</h1>
      <p className="muted">Each study can be attributed to multiple contacts.</p>
      <div className="filterbar">
        <SkeletonBlock height="2.4rem" width="18rem" />
      </div>
      <SkeletonBlock height="18rem" />
    </>
  );
}
