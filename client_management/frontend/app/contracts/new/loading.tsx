import Link from 'next/link';

import { SkeletonBlock } from '../../_components/Skeletons';

export default function Loading() {
  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Add a Contract</h1>
      <p className="muted">Contracts top up a client&apos;s available credits and/or dollars.</p>
      <div className="filterbar">
        <SkeletonBlock height="2.4rem" width="18rem" />
      </div>
      <SkeletonBlock height="15rem" />
    </>
  );
}
