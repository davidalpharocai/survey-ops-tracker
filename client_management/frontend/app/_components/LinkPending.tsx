'use client';

import { useLinkStatus } from 'next/link';

/**
 * A small spinner that shows while the enclosing <Link>'s navigation is
 * pending. Because the destination routes are dynamic (no cached shell
 * beyond the loading.tsx), useLinkStatus stays pending for the whole
 * server render, giving the clicked tile continuous "loading" feedback so
 * a click never feels ignored. Must be rendered as a child of a <Link>.
 */
export default function LinkPending() {
  const { pending } = useLinkStatus();
  return pending ? <span className="link-spinner" role="status" aria-label="Loading" /> : null;
}
