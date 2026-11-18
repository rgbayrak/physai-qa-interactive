import { mean, deviation } from 'd3-array';
import type { PhysioRaw } from './bids-physio-reader';
import { butterworthBandpass, sosfiltfilt } from './filters';
import { bandPower, welchPsd } from './spectrum';
import { analysisSignalOf, signalOrNull } from '../quality/channels';
import type { AnalysisSignal } from '../quality/channels';

export interface ChannelMetrics {
  channelName: string;
  mean: number;
  stdDev: number;
  stdDevFiltered: number;
  snr: number;
  kurtosis: number;
  skewness: number;
  entropy: number;
  zeroCrossing: number;
  perfusion: number;
  relativePower: number;
}

// ── Elgendi 2016: Perfusion (P_SQI), PPG only ────────────
// PPG reference filter (docs/user-guide/metric-definitions.md, "Filtering"):
// NeuroKit2 ppg_clean(method="elgendi"), its default: 2nd-order Butterworth
// band-pass 0.5–8 Hz, zero-phase (Elgendi et al. 2013; Makowski et al. 2021).
// Used for every filtered PPG metric. Elgendi 2016 gives no filter.
const PPG_BAND = { order: 2, lowHz: 0.5, highHz: 8 };
// 1 s windows with a 1 s step (Elgendi 2016, §3, p. 11: windows stepped by 1 s; 1 s for P_SQI).
const PERFUSION_WINDOW_S = 1;


/**
 * P_SQI = (max(y) − min(y)) / |mean(x)| × 100 (Elgendi 2016, Eq. 2): x raw, y band-passed,
 * per 1 s window. The windows are averaged into one value per recording: the mean is
 * ad hoc (not in the paper). NaN when the band cannot be filtered at this rate, the
 * recording is too short, or every window has a zero raw mean.
 */
// ── Elgendi 2016: Skewness (S_SQI) and Kurtosis (K_SQI), PPG only ──
// On the raw signal x. S_SQI, Eq. 3: (1/N) Σ [(x_i − μ)/σ]³. K_SQI, Eq. 4: (1/N) Σ [(x_i − μ)/σ]⁴,
// Pearson's definition (normal = 3, no −3). The paper says only "empirical estimate" of σ;
// population moments (divide by N), the default of scipy.stats.skew / kurtosis
// (bias=True; Virtanen et al. 2020). Moving windows stepped by 1 s (Elgendi 2016, §3):
// S_SQI W = 5 s (2–5 s best; 5 s user-approved), K_SQI W = 1 s (p. 11).
const SKEWNESS_WINDOW_S = 5;
const KURTOSIS_WINDOW_S = 1;
const SQI_STEP_S = 1;

/**
 * Mean over moving windows (1 s step) of a statistic of the window's central moments
 * m2, m3, m4 (population, divide by N). The mean over windows is ad hoc, as for P_SQI.
 * NaN when the recording is shorter than one window or no window has spread.
 */
function windowedMoments(
  data: number[],
  fs: number,
  windowS: number,
  stat: (m2: number, m3: number, m4: number) => number,
): number {
  const win = Math.floor(windowS * fs);
  const step = Math.max(1, Math.floor(SQI_STEP_S * fs));
  if (win < 3 || data.length < win) return NaN;
  let sum = 0;
  let count = 0;
  for (let start = 0; start + win <= data.length; start += step) {
    let s = 0;
    for (let j = start; j < start + win; j++) s += data[j];
    const mu = s / win;
    let m2 = 0;
    let m3 = 0;
    let m4 = 0;
    for (let j = start; j < start + win; j++) {
      const d = data[j] - mu;
      const d2 = d * d;
      m2 += d2;
      m3 += d2 * d;
      m4 += d2 * d2;
    }
    if (m2 === 0) continue;
    const v = stat(m2 / win, m3 / win, m4 / win);
    if (isFinite(v)) { sum += v; count++; }
  }
  return count > 0 ? sum / count : NaN;
}

// ── Elgendi 2016: Entropy (E_SQI), PPG only ──────────────
// Eq. 5 on the raw signal x: E = −Σ x[n]² ln(x[n]²), a sum over the window's samples,
// so it depends on the amplitude (units) and the number of samples per window.
// x[n] = 0 contributes 0 (the limit of u ln u as u → 0). 1 s windows stepped by 1 s.
const ENTROPY_WINDOW_S = 1;

/** Mean E_SQI over 1 s windows (the mean is ad hoc, as for P_SQI); NaN when shorter than one window */
function entropySqi(data: number[], fs: number): number {
  const win = Math.floor(ENTROPY_WINDOW_S * fs);
  const step = Math.max(1, Math.floor(SQI_STEP_S * fs));
  if (win < 1 || data.length < win) return NaN;
  let sum = 0;
  let count = 0;
  for (let start = 0; start + win <= data.length; start += step) {
    let e = 0;
    for (let j = start; j < start + win; j++) {
      const u = data[j] * data[j];
      if (u > 0) e -= u * Math.log(u);
    }
    if (isFinite(e)) { sum += e; count++; }
  }
  return count > 0 ? sum / count : NaN;
}

// ── Elgendi 2016: Zero crossing (Z_SQI), PPG only ────────
// The paper's definition (text): "the rate of sign-changes in the processed signal", citing
// Chen 1988, whose short-time zero-crossing count is Z_n = Σ_m [sign change at m] · w(n − m).
// Eq. 6 as printed, (1/N) Σ I{y < 0}, counts samples below 0 instead and is not used (user
// decision). Here w is rectangular over the 1 s window, scaled by 1/N as in Eq. 6, so Z_SQI is
// sign changes per sample of the filtered PPG y. A sign change at m: y[m] and y[m − 1] on
// different sides of 0, with 0 counted as positive. 1 s windows stepped by 1 s, as for P_SQI.
const ZERO_CROSSING_WINDOW_S = 1;

/** Mean Z_SQI over 1 s windows of the filtered signal (the mean is ad hoc, as for P_SQI) */
function zeroCrossingSqi(y: Float64Array, fs: number, tol: number): number {
  const win = Math.floor(ZERO_CROSSING_WINDOW_S * fs);
  const step = Math.max(1, Math.floor(SQI_STEP_S * fs));
  if (win < 2 || y.length < win) return NaN;
  let sum = 0;
  let count = 0;
  for (let start = 0; start + win <= y.length; start += step) {
    if (windowIsFlat(y, start, win, tol)) continue;
    let changes = 0;
    // Sign change at m compares y[m] with y[m − 1]; the window's first sample has none at the recording start
    for (let m = Math.max(start, 1); m < start + win; m++) {
      if ((y[m] >= 0) !== (y[m - 1] >= 0)) changes++;
    }
    sum += changes / win;
    count++;
  }
  return count > 0 ? sum / count : NaN;
}

// ── Elgendi 2016: Signal-to-noise ratio (N_SQI), PPG only ─
// Eq. 7: N = σ²(|y|) / σ²(y), y the filtered PPG. The variance estimator (N or N − 1)
// cancels in the ratio. The paper gives no window; 1 s windows stepped by 1 s, as for
// Z_SQI (user decision).
const SNR_WINDOW_S = 1;

/**
 * A window of the filtered signal counts as flat when its SD is at rounding level:
 * ≤ 1e3 · machine epsilon · max |x| of the raw recording. Filtering a constant leaves
 * values near 1e-16, not exact zeros, which would otherwise give N_SQI and Z_SQI values
 * from rounding noise. Numerical tolerance (ad hoc, user-approved): the factor 1e3 allows
 * for rounding accumulating through the sections and both passes.
 */
const FLAT_TOLERANCE_FACTOR = 1e3;

function flatTolerance(data: number[]): number {
  let max = 0;
  for (const v of data) if (Math.abs(v) > max) max = Math.abs(v);
  return FLAT_TOLERANCE_FACTOR * Number.EPSILON * max;
}

function windowIsFlat(y: Float64Array, start: number, win: number, tol: number): boolean {
  let s = 0;
  for (let j = start; j < start + win; j++) s += y[j];
  const mu = s / win;
  let v = 0;
  for (let j = start; j < start + win; j++) v += (y[j] - mu) ** 2;
  return Math.sqrt(v / win) <= tol;
}

/** Mean N_SQI over 1 s windows of the filtered signal (the mean is ad hoc, as for P_SQI); NaN when y has no spread */
function snrSqi(y: Float64Array, fs: number, tol: number): number {
  const win = Math.floor(SNR_WINDOW_S * fs);
  const step = Math.max(1, Math.floor(SQI_STEP_S * fs));
  if (win < 2 || y.length < win) return NaN;
  let sum = 0;
  let count = 0;
  for (let start = 0; start + win <= y.length; start += step) {
    let s = 0;
    let sAbs = 0;
    for (let j = start; j < start + win; j++) { s += y[j]; sAbs += Math.abs(y[j]); }
    const mu = s / win;
    const muAbs = sAbs / win;
    let v = 0;
    let vAbs = 0;
    for (let j = start; j < start + win; j++) {
      v += (y[j] - mu) ** 2;
      vAbs += (Math.abs(y[j]) - muAbs) ** 2;
    }
    if (v === 0 || Math.sqrt(v / win) <= tol) continue;
    sum += vAbs / v;
    count++;
  }
  return count > 0 ? sum / count : NaN;
}

// ── Elgendi 2016: Relative power (R_SQI), PPG only ───────
// Eq. 9: PSD power in 1–2.25 Hz over 0–8 Hz, PSD by Welch's method. The paper gives no
// input, Welch settings or window; all of them are NeuroKit2's ppg_quality(method=
// "relative_power") defaults (Makowski et al. 2021; checked against its source,
// 2026-11-16; user decision): raw PPG; 60 s windows stepped by 30 s; per window the mean is
// removed and signal_psd's Welch runs with nperseg = 2 / min_frequency · fs, where its
// default min_frequency = 2·fs / (N/2) (so nperseg = N/2, capped at N/2), a periodic Hann
// window, 50 % overlap, nfft = 2·nperseg; band power is trapezoidal over [lo, hi).
const RP_WINDOW_S = 60;
const RP_STEP_S = 30;
const RP_BAND: [number, number] = [1, 2.25];
const RP_TOTAL: [number, number] = [0, 8];

function relativePowerWindow(x: ArrayLike<number>, fs: number): number {
  const n = x.length;
  let s = 0;
  for (let i = 0; i < n; i++) s += x[i];
  const mu = s / n;
  const centred = Float64Array.from(x, (v) => v - mu);
  // signal_psd: min_frequency "default" → 2·fs / (N/2); nperseg = int((2 / min_frequency) · fs), capped at N/2
  const minFrequency = (2 * fs) / (n / 2);
  let nperseg = Math.trunc((2 / minFrequency) * fs);
  if (nperseg > n / 2) nperseg = Math.trunc(n / 2);
  const spec = welchPsd(centred, fs, { nperseg, nfft: 2 * nperseg, maxHz: RP_TOTAL[1] });
  if (!spec) return NaN;
  const band = bandPower(spec.freqs, spec.psd, RP_BAND[0], RP_BAND[1]);
  const total = bandPower(spec.freqs, spec.psd, RP_TOTAL[0], RP_TOTAL[1]);
  return total > 0 ? band / total : NaN;
}

/** Mean R_SQI over 60 s windows stepped by 30 s (the mean is ad hoc, as for P_SQI); NaN when shorter than 60 s */
function relativePowerSqi(data: number[], fs: number): number {
  if (!(RP_TOTAL[1] < fs / 2)) return NaN;
  const win = Math.trunc(RP_WINDOW_S * fs);
  const step = Math.trunc(RP_STEP_S * fs);
  if (win < 4 || data.length < win) return NaN;
  let sum = 0;
  let count = 0;
  for (let start = 0; start + win <= data.length; start += step) {
    const v = relativePowerWindow(data.slice(start, start + win), fs);
    if (isFinite(v)) { sum += v; count++; }
  }
  return count > 0 ? sum / count : NaN;
}

/** The PPG band-pass filtered signal, or null when the band cannot be filtered at this rate or the recording is too short */
function ppgFiltered(data: number[], fs: number): Float64Array | null {
  if (!(PPG_BAND.highHz < fs / 2)) return null;
  return sosfiltfilt(butterworthBandpass(PPG_BAND.order, PPG_BAND.lowHz, PPG_BAND.highHz, fs), data);
}

/** Standard deviation, the same estimator as the raw Std Dev (d3 deviation, divides by n − 1) */
function sdOf(y: ArrayLike<number>): number {
  return deviation(Array.from(y)) ?? NaN;
}

function perfusionIndex(data: number[], y: Float64Array | null, fs: number): number {
  const win = Math.floor(PERFUSION_WINDOW_S * fs);
  if (!y || win < 2 || data.length < win) return NaN;
  let sum = 0;
  let count = 0;
  for (let start = 0; start + win <= data.length; start += win) {
    let xSum = 0;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let j = start; j < start + win; j++) {
      xSum += data[j];
      if (y[j] < yMin) yMin = y[j];
      if (y[j] > yMax) yMax = y[j];
    }
    const xMean = Math.abs(xSum / win);
    if (xMean === 0) continue;
    const v = ((yMax - yMin) / xMean) * 100;
    if (isFinite(v)) { sum += v; count++; }
  }
  return count > 0 ? sum / count : NaN;
}

interface SQIResults {
  metrics: ChannelMetrics[];
}

// ── Channel metrics ──────────────────────────────────────

function computeChannelMetrics(
  data: number[],
  channelName: string,
  samplingFrequency: number,
  signal: AnalysisSignal | null,
): ChannelMetrics {
  const mu = mean(data) ?? 0;
  const sd = deviation(data) ?? 0;

  // Elgendi 2016 metrics: PPG only (the column's analysis type, analysisSignalOf in src/quality/channels.ts)
  const isPpg = signal === 'ppg';
  const skewness = isPpg ? windowedMoments(data, samplingFrequency, SKEWNESS_WINDOW_S, (m2, m3) => m3 / Math.pow(m2, 1.5)) : NaN;
  const entropy = isPpg ? entropySqi(data, samplingFrequency) : NaN;
  const kurtosis = isPpg ? windowedMoments(data, samplingFrequency, KURTOSIS_WINDOW_S, (m2, _m3, m4) => m4 / (m2 * m2)) : NaN;

  // PPG channels: band-passed once, for the filtered SD and perfusion
  const ppgY = isPpg ? ppgFiltered(data, samplingFrequency) : null;

  return {
    channelName,
    mean: mu,
    stdDev: sd,
    stdDevFiltered: ppgY ? sdOf(ppgY) : NaN,
    snr: ppgY ? snrSqi(ppgY, samplingFrequency, flatTolerance(data)) : NaN,
    kurtosis,
    skewness,
    entropy,
    zeroCrossing: ppgY ? zeroCrossingSqi(ppgY, samplingFrequency, flatTolerance(data)) : NaN,
    perfusion: ppgY ? perfusionIndex(data, ppgY, samplingFrequency) : NaN,
    relativePower: isPpg ? relativePowerSqi(data, samplingFrequency) : NaN,
  };
}

/**
 * Metrics of every column. `signals` gives each column's analysis type (same
 * order as raw.columns; null for none, ambiguous or unknown); when not given,
 * it comes from the column name (analysisSignalOf, no --channel overrides).
 */
export function computeSQI(raw: PhysioRaw, signals?: (AnalysisSignal | null)[]): SQIResults {
  const metrics: ChannelMetrics[] = [];
  for (let i = 0; i < raw.columns.length; i++) {
    const signal = signals ? signals[i] ?? null : signalOrNull(analysisSignalOf(raw.columns[i]));
    metrics.push(computeChannelMetrics(raw.data[i], raw.columns[i], raw.samplingFrequency, signal));
  }
  return { metrics };
}
