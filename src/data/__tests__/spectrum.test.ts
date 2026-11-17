import { describe, it, expect } from 'vitest';
import { bandPower, dftBins, welchPsd } from '../spectrum';

/** Direct DFT of x zero-padded to nfft, first kCount bins */
function naiveDft(x: number[], nfft: number, kCount: number) {
  const re: number[] = [];
  const im: number[] = [];
  for (let k = 0; k < kCount; k++) {
    let r = 0;
    let i = 0;
    for (let n = 0; n < x.length; n++) {
      const a = (-2 * Math.PI * k * n) / nfft;
      r += x[n] * Math.cos(a);
      i += x[n] * Math.sin(a);
    }
    re.push(r);
    im.push(i);
  }
  return { re, im };
}

describe('dftBins (Bluestein)', () => {
  it('matches a direct DFT for a length that is not a power of two, zero-padded', () => {
    // Deterministic pseudo-random input
    let seed = 7;
    const x = Array.from({ length: 150 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5);
    const nfft = 300; // 2 × length, as Welch's nfft = 2·nperseg
    const fast = dftBins(x, nfft, 40);
    const slow = naiveDft(x, nfft, 40);
    for (let k = 0; k < 40; k++) {
      expect(fast.re[k]).toBeCloseTo(slow.re[k], 9);
      expect(fast.im[k]).toBeCloseTo(slow.im[k], 9);
    }
  });
});

describe('welchPsd', () => {
  const fs = 100;
  const sine = (f: number, a = 1, n = fs * 60) => Array.from({ length: n }, (_, i) => a * Math.sin(2 * Math.PI * f * (i / fs)));

  it('puts a sine’s power (A²/2) at its frequency (density scaling)', () => {
    const spec = welchPsd(sine(2, 3), fs, { nperseg: 3000, nfft: 6000, maxHz: 8 })!;
    let peak = 0;
    for (let k = 1; k < spec.psd.length; k++) if (spec.psd[k] > spec.psd[peak]) peak = k;
    expect(spec.freqs[peak]).toBeCloseTo(2, 6);
    // Total power over the band integrates to the variance, A²/2 = 4.5
    expect(bandPower(spec.freqs, spec.psd, 0, 8)).toBeCloseTo(4.5, 2);
  });

  it('returns null for a signal shorter than one segment', () => {
    expect(welchPsd([1, 2, 3], fs, { nperseg: 10, maxHz: 8 })).toBeNull();
  });
});

describe('bandPower', () => {
  it('integrates by trapezoids over [lo, hi), upper edge excluded', () => {
    const freqs = Float64Array.from([0, 1, 2, 3]);
    const psd = Float64Array.from([1, 1, 1, 100]);
    expect(bandPower(freqs, psd, 0, 3)).toBe(2); // bins 0, 1, 2; the 3 Hz bin is excluded
  });
});
