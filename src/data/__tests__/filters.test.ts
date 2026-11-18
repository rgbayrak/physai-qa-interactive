import { describe, it, expect } from 'vitest';
import { butterworthBandpass, sosfiltfilt } from '../filters';

// Properties of a Butterworth band-pass that hold by its definition, on synthetic signals.

const FS = 100;
const sos = butterworthBandpass(2, 0.5, 8, FS);

/** Centre of the band after pre-warping: where the gain is exactly 1 */
const centreHz =
  (FS / Math.PI) * Math.atan(Math.sqrt(Math.tan((Math.PI * 0.5) / FS) * Math.tan((Math.PI * 8) / FS)));

const sine = (f: number, n = FS * 20) => Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * f * (i / FS)));

/** Peak amplitude in the middle half, away from the edges */
const midAmp = (y: ArrayLike<number>) => {
  let m = 0;
  for (let i = Math.floor(y.length / 4); i < (3 * y.length) / 4; i++) m = Math.max(m, Math.abs(y[i]));
  return m;
};

describe('butterworthBandpass + sosfiltfilt', () => {
  it('has one second-order section per order, each with zeros at z = +1 and -1', () => {
    expect(sos).toHaveLength(2);
    for (const [b0, b1, b2, a0] of sos) {
      expect(a0).toBe(1);
      expect(b1).toBeCloseTo(0, 12);
      expect(b2).toBeCloseTo(-b0, 12);
    }
  });

  it('passes the band centre with gain 1 (forward and backward)', () => {
    expect(midAmp(sosfiltfilt(sos, sine(centreHz))!)).toBeCloseTo(1, 3);
  });

  it('removes a constant offset', () => {
    const y = sosfiltfilt(sos, sine(centreHz).map((v) => v + 50))!;
    expect(midAmp(y)).toBeCloseTo(1, 3);
  });

  it('attenuates at the band edges to 1/2 (−3 dB per pass, twice) and far outside', () => {
    // Butterworth: |H| = 1/sqrt(2) at each (pre-warped) cutoff; filtfilt squares it
    expect(midAmp(sosfiltfilt(sos, sine(8))!)).toBeCloseTo(0.5, 2);
    expect(midAmp(sosfiltfilt(sos, sine(0.5, FS * 60))!)).toBeCloseTo(0.5, 2);
    expect(midAmp(sosfiltfilt(sos, sine(30))!)).toBeLessThan(0.02);
  });

  it('adds no time shift (zero phase)', () => {
    const x = sine(centreHz);
    const y = sosfiltfilt(sos, x)!;
    const mid = Math.floor(x.length / 2);
    for (let i = mid; i < mid + 50; i++) expect(y[i]).toBeCloseTo(x[i], 3);
  });

  it('returns null for a signal shorter than the padding, and refuses a band above Nyquist', () => {
    expect(sosfiltfilt(sos, [1, 2, 3])).toBeNull();
    expect(() => butterworthBandpass(2, 0.5, 8, 16)).toThrow(/Invalid band-pass/);
  });
});
