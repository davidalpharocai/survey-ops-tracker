/**
 * Test helper: the bounding box of an SVG path the charts draw (M, L, H, V,
 * Q and Z commands, absolute coordinates — all that roundedBar emits), so a
 * test can check a mark's SIZE against its value, not just that it exists.
 * Only imported by *.test.tsx files.
 */

export interface BBox {
  x0: number
  x1: number
  y0: number
  y1: number
  w: number
  h: number
}

export function pathBox(d: string | null | undefined): BBox {
  const xs: number[] = []
  const ys: number[] = []
  let cx = 0
  let cy = 0
  for (const m of (d ?? '').matchAll(/([MLHVQZ])([^MLHVQZ]*)/gi)) {
    const nums = (m[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number)
    switch (m[1].toUpperCase()) {
      case 'M':
      case 'L':
        for (let i = 0; i + 1 < nums.length; i += 2) {
          cx = nums[i]
          cy = nums[i + 1]
          xs.push(cx)
          ys.push(cy)
        }
        break
      case 'H':
        for (const n of nums) xs.push((cx = n))
        ys.push(cy)
        break
      case 'V':
        for (const n of nums) ys.push((cy = n))
        xs.push(cx)
        break
      case 'Q':
        for (let i = 0; i + 3 < nums.length; i += 4) {
          xs.push(nums[i], nums[i + 2])
          ys.push(nums[i + 1], nums[i + 3])
          cx = nums[i + 2]
          cy = nums[i + 3]
        }
        break
    }
  }
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 }
}

/** Numeric attribute of an element (NaN when absent). */
export const num = (el: Element | null | undefined, attr: string): number => Number(el?.getAttribute(attr))
