'use client';

// Route-level error boundary. Renders when a server component or
// server action throws (typically a backend `ApiError` propagating up).

import Link from 'next/link';
import { useEffect } from 'react';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Route error:', error);
  }, [error]);

  return (
    <div className="card">
      <h1>Something went wrong</h1>
      <p className="muted">{error.message || 'Unexpected error.'}</p>
      {error.digest && <p className="muted small">Ref: {error.digest}</p>}
      <div className="actions">
        <button type="button" onClick={() => reset()}>Try again</button>
        <Link className="btn" href="/">Back to home</Link>
      </div>
    </div>
  );
}
