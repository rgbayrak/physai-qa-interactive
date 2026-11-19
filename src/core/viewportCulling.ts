import { bisector } from 'd3-array';

/**
 * Binary-search slice of sorted data to the visible x-domain + buffer.
 * O(log n) — for 1M points zoomed to 2 s at 2048 Hz, yields ~4100 points.
 */
export function cullToViewport<T>(
  data: T[],
  xDomain: [number, number],
  accessor: (d: T) => number,
  buffer = 1,
): T[] {
  if (data.length === 0) return data;

  const bis = bisector(accessor);
  const lo = Math.max(0, bis.left(data, xDomain[0]) - buffer);
  const hi = Math.min(data.length, bis.right(data, xDomain[1]) + buffer);

  return data.slice(lo, hi);
}

/**
 * Min/max downsampling for drawing a line. Splits the data into at most
 * `buckets` contiguous buckets and keeps each bucket's lowest and highest
 * point, in time order, so peaks, spikes and short dropouts survive (a uniform
 * stride can drop them, or alias a regular rhythm into a pattern that is not
 * there). The first missing value (not finite) in a bucket is kept too, so a
 * gap stays a gap. The first and last points are always kept. Returns the data
 * unchanged when it has at most two points per bucket.
 * Used for the context chart, which always shows the full signal.
 */
export function minMaxDownsample<T>(data: T[], buckets: number, value: (d: T) => number): T[] {
  const n = data.length;
  const b = Math.floor(buckets);
  if (b <= 0 || n <= 2 * b) return data;

  const keep: number[] = [0];
  for (let i = 0; i < b; i++) {
    const start = Math.floor((i * n) / b);
    const end = Math.floor(((i + 1) * n) / b);
    let lo = -1;
    let hi = -1;
    let gap = -1;
    for (let j = start; j < end; j++) {
      const v = value(data[j]);
      if (!Number.isFinite(v)) {
        if (gap < 0) gap = j;
        continue;
      }
      if (lo < 0 || v < value(data[lo])) lo = j;
      if (hi < 0 || v > value(data[hi])) hi = j;
    }
    for (const j of [lo, hi, gap].filter((j) => j >= 0).sort((a, c) => a - c)) {
      if (j !== keep[keep.length - 1]) keep.push(j);
    }
  }
  if (keep[keep.length - 1] !== n - 1) keep.push(n - 1);
  return keep.map((j) => data[j]);
}

/**
 * Uniform stride downsampling.  Keeps first and last points.
 * Can drop or flatten short peaks; for drawing a signal, prefer minMaxDownsample.
 */
export function downsample<T>(data: T[], maxPoints: number): T[] {
  if (data.length <= maxPoints) return data;

  const stride = (data.length - 1) / (maxPoints - 1);
  const result: T[] = [];

  for (let i = 0; i < maxPoints - 1; i++) {
    result.push(data[Math.round(i * stride)]);
  }
  result.push(data[data.length - 1]);

  return result;
}
