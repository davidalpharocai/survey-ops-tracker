// Reusable loading-skeleton primitives for route-level loading.tsx files.
//
// These are server components (no client JS). A loading.tsx built from them
// paints an instant, layout-matched shimmer the moment a <Link> is clicked,
// so navigation never shows a frozen page while the server render runs.
// TableSkeleton reuses the real `.report` table classes and row height so
// the swap from skeleton to data is shift-free (no layout jump).

import type { CSSProperties } from 'react';

/** A single shimmering line; `width` accepts any CSS length/percentage. */
export function SkeletonLine({ width, style }: { width?: string; style?: CSSProperties }) {
  return <span className="skeleton-line" style={{ ...(width ? { width } : {}), ...style }} />;
}

/** A shimmering block (form fields, cards) of a given height/width. */
export function SkeletonBlock({ height = '2.5rem', width = '100%' }: { height?: string; width?: string }) {
  return <span className="skeleton-block" style={{ height, width }} />;
}

/**
 * A placeholder table matching the real `.report` tables. `cols` should
 * equal the destination table's column count so widths line up.
 */
export function TableSkeleton({ cols, rows = 8 }: { cols: number; rows?: number }) {
  const colIdx = Array.from({ length: cols }, (_, i) => i);
  const rowIdx = Array.from({ length: rows }, (_, i) => i);
  return (
    <table className="report skeleton-table" aria-hidden="true">
      <thead>
        <tr>
          {colIdx.map(c => (
            <th key={c}><SkeletonLine width="60%" /></th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rowIdx.map(r => (
          <tr key={r}>
            {colIdx.map(c => (
              <td key={c}><SkeletonLine width={c === 0 ? '80%' : '55%'} /></td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
