// Zero-phase Butterworth band-pass filtering, written to match
// scipy.signal.butter(order, [low, high], btype='band', output='sos', fs=fs)
// followed by scipy.signal.sosfiltfilt (default padtype 'odd'), the way
// NeuroKit2's signal_filter(method="butterworth") applies it
// (Makowski et al. 2021; checked against the NeuroKit2 source, 2026-11-16).

/** One second-order section: [b0, b1, b2, a0, a1, a2], a0 = 1 */
export type Sos = [number, number, number, number, number, number];

interface Complex { re: number; im: number }

const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
const sub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
const mul = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const div = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
const scale = (a: Complex, s: number): Complex => ({ re: a.re * s, im: a.im * s });
function csqrt(a: Complex): Complex {
  const r = Math.hypot(a.re, a.im);
  const re = Math.sqrt((r + a.re) / 2);
  const im = Math.sign(a.im || 1) * Math.sqrt(Math.max(0, (r - a.re) / 2));
  return { re, im };
}

/**
 * Butterworth band-pass as second-order sections (2·order poles in `order` sections).
 * Analog prototype, pre-warped band edges, low-pass to band-pass transform and the
 * bilinear transform, as in scipy.signal.butter. The gain is set so that the
 * response is exactly 1 at the band's centre, which is where scipy's gain puts it.
 */
export function butterworthBandpass(order: number, lowHz: number, highHz: number, fs: number): Sos[] {
  if (!(order >= 1) || !(lowHz > 0) || !(highHz > lowHz) || !(highHz < fs / 2)) {
    throw new Error(`Invalid band-pass: order ${order}, ${lowHz}-${highHz} Hz at ${fs} Hz`);
  }
  // Pre-warp the band edges for the bilinear transform (scipy: fs = 2 after normalising)
  const fs2 = 4; // 2 · fs with fs = 2
  const w1 = fs2 * Math.tan((Math.PI * (lowHz / (fs / 2))) / 2);
  const w2 = fs2 * Math.tan((Math.PI * (highHz / (fs / 2))) / 2);
  const bw = w2 - w1;
  const wo2 = w1 * w2;

  // Analog Butterworth prototype poles (scipy.signal.buttap)
  const proto: Complex[] = [];
  for (let k = -order + 1; k < order; k += 2) {
    const theta = (Math.PI * k) / (2 * order);
    proto.push({ re: -Math.cos(theta), im: -Math.sin(theta) });
  }

  // Low-pass to band-pass (scipy.signal.lp2bp_zpk), then bilinear (bilinear_zpk)
  const poles: Complex[] = [];
  for (const p of proto) {
    const pl = scale(p, bw / 2);
    const root = csqrt(sub(mul(pl, pl), { re: wo2, im: 0 }));
    for (const pb of [add(pl, root), sub(pl, root)]) {
      poles.push(div(add({ re: fs2, im: 0 }, pb), sub({ re: fs2, im: 0 }, pb)));
    }
  }

  // Pair poles into sections: complex conjugate pairs, then real poles two at a time.
  // Each section gets one zero at z = +1 and one at z = -1: b = [1, 0, -1].
  const EPS = 1e-12;
  const upper = poles.filter((p) => p.im > EPS);
  const real = poles.filter((p) => Math.abs(p.im) <= EPS).map((p) => p.re).sort((a, b) => a - b);
  const sections: Sos[] = upper.map((p) => [1, 0, -1, 1, -2 * p.re, p.re * p.re + p.im * p.im]);
  for (let i = 0; i + 1 < real.length; i += 2) {
    sections.push([1, 0, -1, 1, -(real[i] + real[i + 1]), real[i] * real[i + 1]]);
  }
  if (sections.length !== order) throw new Error('Band-pass design: unexpected pole layout');

  // Unit gain at the centre frequency (analog sqrt(w1·w2), mapped by the bilinear transform)
  const wc = 2 * Math.atan(Math.sqrt(wo2) / fs2);
  const z1: Complex = { re: Math.cos(wc), im: -Math.sin(wc) }; // z^-1 on the unit circle
  const z2 = mul(z1, z1);
  let mag = 1;
  for (const [b0, b1, b2, , a1, a2] of sections) {
    const num = add(add({ re: b0, im: 0 }, scale(z1, b1)), scale(z2, b2));
    const den = add(add({ re: 1, im: 0 }, scale(z1, a1)), scale(z2, a2));
    const h = div(num, den);
    mag *= Math.hypot(h.re, h.im);
  }
  const g = 1 / mag;
  sections[0] = [sections[0][0] * g, sections[0][1] * g, sections[0][2] * g, 1, sections[0][4], sections[0][5]];
  return sections;
}

/** Steady-state initial conditions of one section for a unit step (scipy.signal.lfilter_zi) */
function sectionZi([b0, b1, b2, , a1, a2]: Sos): [number, number] {
  // Solve [[1 + a1, -1], [a2, 1]] · zi = [b1 - a1·b0, b2 - a2·b0]
  const r0 = b1 - a1 * b0;
  const r1 = b2 - a2 * b0;
  const det = 1 + a1 + a2;
  return [(r0 + r1) / det, (r1 * (1 + a1) - a2 * r0) / det];
}

/** scipy.signal.sosfilt_zi: each section's zi scaled by the DC gain of the sections before it */
function sosZi(sos: Sos[]): [number, number][] {
  let gain = 1;
  return sos.map((s) => {
    const zi = sectionZi(s);
    const out: [number, number] = [zi[0] * gain, zi[1] * gain];
    gain *= (s[0] + s[1] + s[2]) / (s[3] + s[4] + s[5]);
    return out;
  });
}

/** Cascade of sections, direct form II transposed (scipy.signal.sosfilt), with initial state zi */
function sosfilt(sos: Sos[], x: Float64Array, zi: [number, number][]): Float64Array {
  const y = Float64Array.from(x);
  sos.forEach(([b0, b1, b2, , a1, a2], s) => {
    let [z0, z1] = zi[s];
    for (let i = 0; i < y.length; i++) {
      const xi = y[i];
      const yi = b0 * xi + z0;
      z0 = b1 * xi - a1 * yi + z1;
      z1 = b2 * xi - a2 * yi;
      y[i] = yi;
    }
  });
  return y;
}

/**
 * Forward-backward filtering (scipy.signal.sosfiltfilt, padtype 'odd'):
 * odd extension at both ends, forward pass from steady state, backward pass, trim.
 * Returns null when the signal is too short for the padding.
 */
export function sosfiltfilt(sos: Sos[], data: ArrayLike<number>): Float64Array | null {
  const n = data.length;
  // scipy: ntaps = 2·sections + 1 − min(trailing zero b2s, trailing zero a2s); padlen = 3·ntaps
  const zerosB = sos.filter((s) => s[2] === 0).length;
  const zerosA = sos.filter((s) => s[5] === 0).length;
  const padlen = 3 * (2 * sos.length + 1 - Math.min(zerosB, zerosA));
  if (n <= padlen) return null;

  const ext = new Float64Array(n + 2 * padlen);
  for (let i = 0; i < padlen; i++) ext[i] = 2 * data[0] - data[padlen - i];
  for (let i = 0; i < n; i++) ext[padlen + i] = data[i];
  for (let i = 0; i < padlen; i++) ext[padlen + n + i] = 2 * data[n - 1] - data[n - 2 - i];

  const zi = sosZi(sos);
  const at = (v: number) => zi.map(([a, b]) => [a * v, b * v] as [number, number]);
  const fwd = sosfilt(sos, ext, at(ext[0]));
  fwd.reverse();
  const back = sosfilt(sos, fwd, at(fwd[0]));
  back.reverse();
  return back.slice(padlen, padlen + n);
}
