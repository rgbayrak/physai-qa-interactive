import { describe, it, expect } from 'vitest';
import { downsample, minMaxDownsample } from '../viewportCulling';

interface P {
  time: number;
  value: number;
}

const val = (d: P) => d.value;
const series = (values: number[]): P[] => values.map((value, time) => ({ time, value }));

describe('min/max downsampling for the context chart', () => {
  it('returns short data unchanged (at most two points per bucket)', () => {
    const data = series([1, 2, 3, 4]);
    expect(minMaxDownsample(data, 2, val)).toBe(data);
  });

  it('keeps a one-sample spike that a uniform stride drops', () => {
    const values = new Array(1000).fill(0);
    values[503] = 10;
    const data = series(values);
    expect(downsample(data, 20).some((d) => d.value === 10)).toBe(false);
    expect(minMaxDownsample(data, 10, val).some((d) => d.value === 10)).toBe(true);
  });

  it('keeps a one-sample dropout', () => {
    const values = new Array(1000).fill(5);
    values[250] = -5;
    expect(minMaxDownsample(series(values), 10, val).some((d) => d.value === -5)).toBe(true);
  });

  it('keeps points in time order, with the first and last points', () => {
    const data = series(Array.from({ length: 1000 }, (_, i) => Math.sin(i / 7)));
    const out = minMaxDownsample(data, 50, val);
    const times = out.map((d) => d.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
    expect(out[0]).toBe(data[0]);
    expect(out[out.length - 1]).toBe(data[data.length - 1]);
  });

  it('keeps a missing value so a gap is not bridged', () => {
    const values = new Array(1000).fill(1);
    values[600] = NaN;
    expect(minMaxDownsample(series(values), 10, val).some((d) => Number.isNaN(d.value))).toBe(true);
  });

  it('keeps at most three points per bucket, plus the first and last points', () => {
    const data = series(Array.from({ length: 10000 }, (_, i) => (i % 13 === 0 ? NaN : Math.sin(i))));
    expect(minMaxDownsample(data, 100, val).length).toBeLessThanOrEqual(3 * 100 + 2);
  });
});
