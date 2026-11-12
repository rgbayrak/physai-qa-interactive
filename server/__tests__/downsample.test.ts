import { describe, it, expect } from 'vitest';
import {
  downsampleFactor,
  cutoffHz,
  lowpassKernel,
  decimateLowpass,
  decimateMax,
  downsampleChannels,
} from '../downsample';
import { parsePhysioTsv } from '../bids-layout';

const sine = (fs: number, hz: number, seconds: number, amp = 1) =>
  Array.from({ length: Math.round(fs * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / fs));

/** Root mean square, leaving out `edge` samples at each end */
const rms = (x: number[], edge = 0) => {
  const y = x.slice(edge, x.length - edge);
  return Math.sqrt(y.reduce((s, v) => s + v * v, 0) / y.length);
};

describe('downsampleFactor', () => {
  it('brings high rates down to at least 1000 Hz by a whole-number factor', () => {
    expect(downsampleFactor(10000)).toBe(10);
    expect(downsampleFactor(5000)).toBe(5);
    expect(downsampleFactor(2500)).toBe(2);
    expect(downsampleFactor(2000)).toBe(2);
  });

  it('leaves rates under 2000 Hz alone', () => {
    for (const fs of [1999, 1500, 1000, 500, 50, 0, NaN]) expect(downsampleFactor(fs)).toBe(1);
  });

  it('cuts off at 0.8 of the new Nyquist frequency', () => {
    expect(cutoffHz(10000, 10)).toBe(400);
  });
});

describe('lowpassKernel', () => {
  it('is odd-length, symmetric (no time shift) and sums to 1', () => {
    const h = lowpassKernel(10);
    expect(h.length).toBe(201);
    for (let i = 0; i < h.length; i++) expect(h[i]).toBeCloseTo(h[h.length - 1 - i], 12);
    expect(h.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
  });
});

describe('decimateLowpass (10 kHz → 1 kHz)', () => {
  const FS = 10000;
  const F = 10;

  it('keeps samples on the original grid: sample k is original sample k * factor', () => {
    const x = Array.from({ length: 1001 }, (_, i) => i); // a ramp passes a unit-gain symmetric filter unchanged
    const y = decimateLowpass(x, F);
    expect(y.length).toBe(101);
    for (let k = 10; k < 90; k++) expect(y[k]).toBeCloseTo(k * F, 9);
  });

  it('passes a 10 Hz signal almost unchanged, with no time shift', () => {
    const x = sine(FS, 10, 2);
    const y = decimateLowpass(x, F);
    for (let k = 20; k < y.length - 20; k++) expect(y[k]).toBeCloseTo(x[k * F], 3);
  });

  it('removes a 4.8 kHz tone instead of folding it back to 200 Hz', () => {
    const y = decimateLowpass(sine(FS, 4800, 2), F);
    // Plain decimation would alias it to a full-size 200 Hz tone (rms ≈ 0.7)
    expect(rms(y, 20)).toBeLessThan(0.01);
  });

  it('removes a 550 Hz tone, just above the new Nyquist frequency, instead of folding it back to 450 Hz', () => {
    const y = decimateLowpass(sine(FS, 550, 2), F);
    expect(rms(y, 20) / Math.SQRT1_2).toBeLessThan(0.01);
  });

  it('keeps missing samples missing and skips missing neighbours', () => {
    const x = Array.from({ length: 200 }, () => 1);
    x[100] = NaN;
    x[103] = NaN;
    const y = decimateLowpass(x, F);
    expect(y[10]).toBeNaN();
    expect(y[9]).toBeCloseTo(1, 12);
    expect(y[11]).toBeCloseTo(1, 12);
  });
});

describe('decimateMax', () => {
  it('keeps a 1 ms trigger pulse that falls between kept samples', () => {
    const x = new Array(10000).fill(0);
    for (let i = 5003; i < 5013; i++) x[i] = 5; // 10 samples at 10 kHz
    const y = decimateMax(x, 10);
    expect(Math.max(...y)).toBe(5);
    // Shown at the kept sample nearest the pulse, within half a new sample interval
    expect(y.indexOf(5)).toBe(500);
  });
});

describe('downsampleChannels', () => {
  it('filters signal channels and takes block maxima for the trigger channel', () => {
    const n = 10000;
    const cardiac = sine(10000, 1.2, 1);
    const trigger = new Array(n).fill(0);
    trigger[2505] = 1;
    const ds = downsampleChannels(['cardiac', 'trigger'], [cardiac, trigger], 10000);
    expect(ds.samplingFrequency).toBe(1000);
    expect(ds.factor).toBe(10);
    expect(ds.data[0].length).toBe(1000);
    expect(Math.max(...ds.data[1])).toBe(1);
  });

  it('returns plain arrays unchanged when no downsampling is needed', () => {
    const ds = downsampleChannels(['cardiac'], [Float64Array.from([1, 2, 3])], 500);
    expect(ds).toEqual({ data: [[1, 2, 3]], samplingFrequency: 500, factor: 1 });
    expect(Array.isArray(ds.data[0])).toBe(true);
  });
});

describe('parsePhysioTsv', () => {
  it('parses columns, skips a header row and blank lines', () => {
    const cols = parsePhysioTsv(Buffer.from('cardiac\trespiratory\n1\t2\n3\t4\n\n5\tn/a\n'), 2);
    expect(cols.map((c) => Array.from(c))).toEqual([
      [1, 3, 5],
      [2, 4, NaN],
    ]);
  });

  it('gives the same result when lines are split across chunks', () => {
    const text = Array.from({ length: 500 }, (_, i) => `${i}\t${i * 0.5}\r`).join('\n');
    const whole = parsePhysioTsv(Buffer.from(text), 2);
    const chunked = parsePhysioTsv(Buffer.from(text), 2, 7);
    expect(chunked.map((c) => Array.from(c))).toEqual(whole.map((c) => Array.from(c)));
    expect(whole[0].length).toBe(500);
    expect(whole[1][499]).toBe(249.5);
  });

  it('reads a file longer than the longest string Node can hold', { timeout: 120_000 }, () => {
    // 0x1fffffe8 characters is Node's limit; build ~600 MB of rows without one big string
    const row = Buffer.from('0.123456789\t1.234567890\t0\n'); // 26 bytes
    const rows = Math.ceil(600e6 / row.length);
    const buf = Buffer.allocUnsafe(rows * row.length);
    for (let i = 0; i < rows; i++) row.copy(buf, i * row.length);
    expect(buf.length).toBeGreaterThan(0x1fffffe8);
    const cols = parsePhysioTsv(buf, 3);
    expect(cols[0].length).toBe(rows);
    expect(cols[1][rows - 1]).toBe(1.23456789);
  });
});
