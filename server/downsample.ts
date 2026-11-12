// Downsampling for high-rate physio recordings (e.g. 10 kHz), so the viewer
// and the quality metrics work on a manageable number of samples.
//
// The rate is reduced by a whole-number factor, so the kept samples sit
// exactly on the original time grid (sample k is original sample k * factor).
// Before decimating, each channel is low-pass filtered below the new Nyquist
// frequency (fs_new / 2) to avoid aliasing. The filter is a symmetric,
// centred windowed-sinc FIR: zero phase, so peaks do not shift in time.
// Pulse channels (triggers) are not filtered, which would smear the pulses;
// each kept sample takes the maximum of its block, so no pulse is lost.

/** Recordings are brought down to about this rate (Hz) */
export const TARGET_RATE = 1000;

/** Low-pass cutoff as a fraction of the new Nyquist frequency */
export const CUTOFF_FRACTION = 0.8;

/** Whole-number factor that brings fs down to at least TARGET_RATE; 1 means leave as is */
export function downsampleFactor(fs: number): number {
  if (!(fs > 0)) return 1;
  const factor = Math.floor(fs / TARGET_RATE);
  return factor >= 2 ? factor : 1;
}

/** Low-pass cutoff (Hz) used when decimating fs by factor */
export function cutoffHz(fs: number, factor: number): number {
  return CUTOFF_FRACTION * (fs / factor / 2);
}

/** Pulse-like channels: decimated by block maximum, not filtered */
export function isPulseChannel(name: string): boolean {
  return /trigger/i.test(name);
}

/**
 * Hamming-windowed sinc low-pass kernel for decimation by factor: cutoff at
 * CUTOFF_FRACTION of the new Nyquist frequency, 20 * factor + 1 taps (odd, so it
 * is centred; the length scipy.signal.decimate uses), weights summing to 1
 * (unit gain at 0 Hz). The transition band (~3.3 / taps of fs) then ends below
 * the new Nyquist frequency, so nothing above it folds back.
 */
export function lowpassKernel(factor: number): Float64Array {
  const taps = 20 * factor + 1;
  const m = (taps - 1) / 2;
  const fc = CUTOFF_FRACTION * (0.5 / factor); // cycles per input sample
  const h = new Float64Array(taps);
  let sum = 0;
  for (let n = 0; n < taps; n++) {
    const x = n - m;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (taps - 1));
    h[n] = sinc * w;
    sum += h[n];
  }
  for (let n = 0; n < taps; n++) h[n] /= sum;
  return h;
}

/** Number of samples kept when decimating length samples by factor */
function outLength(length: number, factor: number): number {
  return Math.ceil(length / factor);
}

/**
 * Low-pass filter and keep every factor-th sample (k * factor), computing the
 * filter only at the kept samples. Edges repeat the first/last sample. Missing
 * samples (NaN) stay missing; NaN neighbours are left out of the weighted sum.
 */
export function decimateLowpass(x: ArrayLike<number>, factor: number, kernel = lowpassKernel(factor)): number[] {
  const n = x.length;
  const m = (kernel.length - 1) / 2;
  const out = new Array<number>(outLength(n, factor));
  for (let k = 0; k < out.length; k++) {
    const c = k * factor;
    if (Number.isNaN(x[c])) {
      out[k] = NaN;
      continue;
    }
    let acc = 0;
    let wsum = 0;
    for (let j = 0; j < kernel.length; j++) {
      let i = c + j - m;
      if (i < 0) i = 0;
      else if (i >= n) i = n - 1;
      const v = x[i];
      if (Number.isNaN(v)) continue;
      acc += kernel[j] * v;
      wsum += kernel[j];
    }
    out[k] = wsum !== 0 ? acc / wsum : NaN;
  }
  return out;
}

/**
 * Keep every factor-th sample as the maximum of the block centred on it, so a
 * pulse shorter than the new sample interval still shows. NaN only when the
 * whole block is NaN.
 */
export function decimateMax(x: ArrayLike<number>, factor: number): number[] {
  const n = x.length;
  const half = Math.floor(factor / 2);
  const out = new Array<number>(outLength(n, factor));
  for (let k = 0; k < out.length; k++) {
    const start = Math.max(0, k * factor - half);
    const end = Math.min(n, start + factor);
    let max = -Infinity;
    for (let i = start; i < end; i++) if (x[i] > max) max = x[i];
    out[k] = max === -Infinity ? NaN : max;
  }
  return out;
}

export interface Downsampled {
  data: number[][];
  samplingFrequency: number;
  factor: number;
}

/** Downsample every channel when fs is high (see downsampleFactor); otherwise copy as plain arrays */
export function downsampleChannels(columns: string[], data: ArrayLike<number>[], fs: number): Downsampled {
  const factor = downsampleFactor(fs);
  if (factor === 1) return { data: data.map((col) => Array.from(col)), samplingFrequency: fs, factor };
  const kernel = lowpassKernel(factor);
  return {
    data: data.map((col, c) => (isPulseChannel(columns[c] ?? '') ? decimateMax(col, factor) : decimateLowpass(col, factor, kernel))),
    samplingFrequency: fs / factor,
    factor,
  };
}
