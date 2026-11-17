// Welch power spectral density, written to match scipy.signal.welch as NeuroKit2's
// signal_psd(method="welch") calls it (Makowski et al. 2021; checked against the
// NeuroKit2 source, 2026-11-16): periodic Hann window, scaling="density",
// detrend=False, average="mean", one-sided, segments stepped by nperseg − noverlap.

/** In-place iterative radix-2 FFT; re/im length must be a power of two */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * The first `kCount` bins of the nfft-point DFT of x (zero-padded to nfft), for any nfft,
 * by Bluestein's chirp-z method: X[k] = w[k] · Σ_n (x[n] w[n]) · conj(w[k − n]), w[n] = e^(−iπn²/nfft).
 */
export function dftBins(x: ArrayLike<number>, nfft: number, kCount: number): { re: Float64Array; im: Float64Array } {
  const L = x.length;
  let m = 1;
  while (m < L + kCount - 1) m <<= 1;
  // Chirp, with n² taken mod 2·nfft so the angle stays exact for long transforms
  const span = Math.max(L, kCount);
  const cr = new Float64Array(span);
  const ci = new Float64Array(span);
  for (let n = 0; n < span; n++) {
    const a = (-Math.PI * ((n * n) % (2 * nfft))) / nfft;
    cr[n] = Math.cos(a);
    ci[n] = Math.sin(a);
  }
  const ar = new Float64Array(m);
  const ai = new Float64Array(m);
  for (let n = 0; n < L; n++) {
    ar[n] = x[n] * cr[n];
    ai[n] = x[n] * ci[n];
  }
  // b[j] = conj(w[j]) for j in (−L, kCount), negative j wrapped to m + j; the two
  // ranges do not overlap because m ≥ L + kCount − 1
  const br = new Float64Array(m);
  const bi = new Float64Array(m);
  for (let j = 0; j < kCount; j++) {
    br[j] = cr[j];
    bi[j] = -ci[j];
  }
  for (let j = 1; j < L; j++) {
    br[m - j] = cr[j];
    bi[m - j] = -ci[j];
  }
  fft(ar, ai);
  fft(br, bi);
  for (let i = 0; i < m; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    ai[i] = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r;
  }
  // Inverse FFT by conjugation
  for (let i = 0; i < m; i++) ai[i] = -ai[i];
  fft(ar, ai);
  const re = new Float64Array(kCount);
  const im = new Float64Array(kCount);
  for (let k = 0; k < kCount; k++) {
    const yr = ar[k] / m;
    const yi = -ai[k] / m;
    re[k] = yr * cr[k] - yi * ci[k];
    im[k] = yr * ci[k] + yi * cr[k];
  }
  return { re, im };
}

export interface WelchOptions {
  nperseg: number;
  /** Default nperseg // 2 (scipy) */
  noverlap?: number;
  /** Default nperseg */
  nfft?: number;
  /** Only bins with frequency below this are returned */
  maxHz: number;
}

/** One-sided Welch PSD (density) for frequencies below maxHz; null when the signal is shorter than one segment */
export function welchPsd(
  x: ArrayLike<number>,
  fs: number,
  { nperseg, noverlap = Math.floor(nperseg / 2), nfft = nperseg, maxHz }: WelchOptions,
): { freqs: Float64Array; psd: Float64Array } | null {
  if (nperseg < 2 || x.length < nperseg) return null;
  // Periodic Hann, as scipy.signal.get_window('hann', nperseg) (sym=False)
  const w = new Float64Array(nperseg);
  let wss = 0;
  for (let n = 0; n < nperseg; n++) {
    w[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / nperseg);
    wss += w[n] * w[n];
  }
  const scale = 1 / (fs * wss);
  const kCount = Math.min(Math.floor(nfft / 2) + 1, Math.ceil((maxHz * nfft) / fs));
  const psd = new Float64Array(kCount);
  const step = nperseg - noverlap;
  let segments = 0;
  const seg = new Float64Array(nperseg);
  for (let start = 0; start + nperseg <= x.length; start += step) {
    for (let n = 0; n < nperseg; n++) seg[n] = x[start + n] * w[n];
    const { re, im } = dftBins(seg, nfft, kCount);
    for (let k = 0; k < kCount; k++) {
      // One-sided: double every bin except DC and Nyquist
      const two = k === 0 || (nfft % 2 === 0 && k === nfft / 2) ? 1 : 2;
      psd[k] += two * (re[k] * re[k] + im[k] * im[k]) * scale;
    }
    segments++;
  }
  for (let k = 0; k < kCount; k++) psd[k] /= segments;
  const freqs = Float64Array.from({ length: kCount }, (_, k) => (k * fs) / nfft);
  return { freqs, psd };
}

/** Trapezoidal power over [lo, hi) Hz, as NeuroKit2's signal_power (lower edge in, upper edge out) */
export function bandPower(freqs: Float64Array, psd: Float64Array, lo: number, hi: number): number {
  let p = 0;
  let prev = -1;
  for (let k = 0; k < freqs.length; k++) {
    if (freqs[k] < lo || freqs[k] >= hi) continue;
    if (prev >= 0) p += ((psd[prev] + psd[k]) / 2) * (freqs[k] - freqs[prev]);
    prev = k;
  }
  return p;
}
