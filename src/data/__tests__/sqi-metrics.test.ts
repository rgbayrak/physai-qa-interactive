import { describe, it, expect } from 'vitest';
import { computeSQI } from '../sqi-metrics';
import type { ChannelMetrics } from '../sqi-metrics';
import type { PhysioRaw } from '../bids-physio-reader';

/**
 * SQI metrics on synthetic signals whose statistics are known analytically.
 * A pure sine has mean 0, SD 1/sqrt(2), skewness 0, Pearson kurtosis 1.5,
 * and crosses zero twice per cycle; every cycle has the same shape, so
 * beat-to-beat correlation is 1.
 */

const FS = 100;
const DURATION_S = 60;

function sine(freqHz: number, { offset = 0, amplitude = 1, phase = 0.1 } = {}): number[] {
  return Array.from({ length: FS * DURATION_S }, (_, i) =>
    offset + amplitude * Math.sin(2 * Math.PI * freqHz * (i / FS) + phase),
  );
}

function metricsFor(columns: Record<string, number[]>): Record<string, ChannelMetrics> {
  const names = Object.keys(columns);
  const raw: PhysioRaw = {
    filename: 'synthetic_physio.tsv.gz',
    datatype: 'func',
    samplingFrequency: FS,
    startTime: 0,
    timing: { status: 'unverified', detail: '', offset: 0, triggerTimes: [] },
    columns: names,
    data: names.map((n) => columns[n]),
    numSamples: columns[names[0]].length,
    quality: null,
  };
  return Object.fromEntries(computeSQI(raw).metrics.map((m) => [m.channelName, m]));
}

describe('computeSQI: basic statistics', () => {
  const m = metricsFor({ signal: sine(1) }).signal;

  it('returns one entry per channel, in column order', () => {
    const r = metricsFor({ b: sine(1), a: sine(2) });
    expect(Object.keys(r)).toEqual(['b', 'a']);
  });

  it('mean and SD of a sine', () => {
    expect(m.mean).toBeCloseTo(0, 6);
    expect(m.stdDev).toBeCloseTo(Math.SQRT1_2, 3);
  });

  it('no skewness or kurtosis for a non-PPG channel (S_SQI and K_SQI are PPG only)', () => {
    expect(m.kurtosis).toBeNaN();
    expect(m.skewness).toBeNaN();
  });

  it('zero crossing Z_SQI (Elgendi 2016 text; Chen 1988): sign changes per sample of the filtered signal', () => {
    // A pulse at f Hz passes the 0.5–8 Hz filter as a zero-mean sine: 2f sign changes per second,
    // so 2f / FS per sample in each 1 s window (phase 0.1 keeps samples off exact zeros)
    const pulse = (f: number) => sine(f, { offset: 10 });
    expect(metricsFor({ PPG: pulse(2) }).PPG.zeroCrossing).toBeCloseTo((2 * 2) / FS, 3);
    // A rate: doubling the pulse rate doubles it (Eq. 6 as printed would stay at 0.5)
    expect(metricsFor({ PPG: pulse(4) }).PPG.zeroCrossing).toBeCloseTo((2 * 4) / FS, 3);
    expect(metricsFor({ ECG: pulse(2) }).ECG.zeroCrossing).toBeNaN();
    expect(metricsFor({ s: pulse(2) }).s.zeroCrossing).toBeNaN();
  });

  it('SNR N_SQI (Elgendi 2016, Eq. 7): var(|y|) / var(y) of the filtered signal, PPG only', () => {
    // A pulse at 2 Hz passes the filter as a zero-mean sine; for a sine, var(|sin|) = 1/2 − (2/π)²
    // and var(sin) = 1/2, so the ratio is 1 − 8/π² ≈ 0.18943, whatever the amplitude or offset
    const expected = 1 - 8 / (Math.PI * Math.PI);
    expect(metricsFor({ PPG: sine(2, { offset: 10 }) }).PPG.snr).toBeCloseTo(expected, 2);
    expect(metricsFor({ PPG: sine(2, { offset: -3, amplitude: 50 }) }).PPG.snr).toBeCloseTo(expected, 2);
    expect(metricsFor({ ECG: sine(2, { offset: 10 }) }).ECG.snr).toBeNaN();
  });

  it('a flat channel has no spread and no shape or SNR values', () => {
    const flat = metricsFor({ s: new Array(1000).fill(3) }).s;
    expect(flat.stdDev).toBe(0);
    expect(flat.snr).toBeNaN();
    expect(metricsFor({ PPG: new Array(1000).fill(3) }).PPG.snr).toBeNaN(); // filtered y is 0
    expect(metricsFor({ PPG: new Array(1000).fill(3) }).PPG.zeroCrossing).toBeNaN(); // no sign changes from rounding noise
    expect(flat.skewness).toBeNaN();
    expect(flat.kurtosis).toBeNaN();
  });
});

describe('computeSQI: channel-type specific metrics', () => {
  const r = metricsFor({
    cardiac: sine(1),
    respiratory: sine(0.25),
    trigger: sine(0.5),
  });

  it('cardiac: K_SQI is computed', () => {
    expect(r.cardiac.kurtosis).toBeCloseTo(1.5, 9); // K_SQI of a sine: each 1 s window is one whole period
  });

  it('respiratory: no K_SQI', () => {
    expect(r.respiratory.kurtosis).toBeNaN();
  });

  it('other channels: no K_SQI', () => {
    expect(r.trigger.kurtosis).toBeNaN();
  });

  it('K_SQI needs one full 1 s window', () => {
    const short = sine(1).slice(0, FS / 2);
    expect(metricsFor({ cardiac: short }).cardiac.kurtosis).toBeNaN();
  });

  it('entropy E_SQI (Elgendi 2016, Eq. 5): −Σ x² ln(x²) per 1 s window, averaged', () => {
    // A constant c: each 1 s window (100 samples) sums to −100 · c² · ln(c²)
    const c = 2;
    const expected = -FS * c * c * Math.log(c * c); // −554.517…
    expect(metricsFor({ PPG: new Array(FS * 10).fill(c) }).PPG.entropy).toBeCloseTo(expected, 9);
    // x² does not see the sign; a zero sample adds 0 (limit of u ln u)
    expect(metricsFor({ PPG: new Array(FS * 10).fill(-c) }).PPG.entropy).toBeCloseTo(expected, 9);
    const withZeros = new Array(FS * 10).fill(c).map((v, i) => (i % 2 ? 0 : v));
    expect(metricsFor({ PPG: withZeros }).PPG.entropy).toBeCloseTo(expected / 2, 9);
    // Windows with different values are averaged: half the windows at c = 2, half at 1 (which give 0)
    const mixed = Array.from({ length: FS * 10 }, (_, i) => (i < FS * 5 ? c : 1));
    expect(metricsFor({ PPG: mixed }).PPG.entropy).toBeCloseTo(expected / 2, 9);
    expect(metricsFor({ ECG: new Array(FS * 10).fill(c) }).ECG.entropy).toBeNaN();
  });

  it('relative power R_SQI (Elgendi 2016, Eq. 9): Welch power in 1–2.25 Hz over 0–8 Hz, NeuroKit2 settings', () => {
    const wave = (parts: [number, number][], offset = 0) =>
      Array.from({ length: FS * 120 }, (_, i) => offset + parts.reduce((s, [f, a]) => s + a * Math.sin(2 * Math.PI * f * (i / FS)), 0));
    // Equal sines at 1.5 Hz (in the band) and 5 Hz (outside it, inside 0–8 Hz): half the power
    expect(metricsFor({ PPG: wave([[1.5, 1], [5, 1]]) }).PPG.relativePower).toBeCloseTo(0.5, 2);
    // Only in the band: 1; only outside it: 0
    expect(metricsFor({ PPG: wave([[1.5, 1]]) }).PPG.relativePower).toBeCloseTo(1, 2);
    expect(metricsFor({ PPG: wave([[5, 1]]) }).PPG.relativePower).toBeCloseTo(0, 2);
    // A ratio: amplitude and offset do not change it (the window mean is removed)
    expect(metricsFor({ PPG: wave([[1.5, 3], [5, 3]], 20) }).PPG.relativePower).toBeCloseTo(0.5, 2);
    // Reference: NeuroKit2 0.3.0, ppg_quality(x, sampling_rate=100, method="relative_power", ppg_raw=x)
    // on this signal (150 s, 4 windows), read at the window centres (computed 2026-11-16)
    const ref = Array.from({ length: FS * 150 }, (_, i) => {
      const t = i / FS;
      return 20 + Math.sin(2 * Math.PI * 1.5 * t) + 0.6 * Math.sin(2 * Math.PI * 5 * t + 0.4) + 0.3 * Math.sin(2 * Math.PI * 0.3 * t);
    });
    expect(metricsFor({ PPG: ref }).PPG.relativePower).toBeCloseTo(0.689655194335, 6);
    // Needs one 60 s window; PPG only
    expect(metricsFor({ PPG: wave([[1.5, 1]]).slice(0, FS * 59) }).PPG.relativePower).toBeNaN();
    expect(metricsFor({ ECG: wave([[1.5, 1]]) }).ECG.relativePower).toBeNaN();
  });

  it('kurtosis K_SQI (Elgendi 2016, Eq. 4): Pearson kurtosis per 1 s window, averaged', () => {
    // x = 10 + sin θ − a·cos 2θ, θ = 2π·1 Hz·t. Per period: m2 = (1 + a²)/2 and
    // m4 = 3/8 + 6a²·(1/4) + 3a⁴/8, so K = m4 / m2²; a = 0.5 gives 0.7734375 / 0.390625 = 1.98.
    // Each 1 s window is one whole period sampled at 100 Hz, so each window has exactly this value.
    const a = 0.5;
    const x = Array.from({ length: FS * DURATION_S }, (_, i) => {
      const th = 2 * Math.PI * (i / FS);
      return 10 + Math.sin(th) - a * Math.cos(2 * th);
    });
    const m2 = (1 + a * a) / 2;
    const m4 = 3 / 8 + (6 * a * a) / 4 + (3 * a ** 4) / 8;
    expect(m4 / (m2 * m2)).toBeCloseTo(1.98, 12);
    expect(metricsFor({ PPG: x }).PPG.kurtosis).toBeCloseTo(1.98, 9);
    // Pearson, not excess: no −3; scale and offset do not change it
    expect(metricsFor({ PPG: x.map((v) => 3 * v - 7) }).PPG.kurtosis).toBeCloseTo(1.98, 9);
    expect(metricsFor({ ECG: x }).ECG.kurtosis).toBeNaN();
  });

  it('perfusion P_SQI (Elgendi 2016, Eq. 2): peak-to-peak of the filtered signal / |raw mean| × 100', () => {
    // A sine at the band centre passes with gain 1, so mid-recording windows give 2 / 10 × 100 ≈ 20;
    // the filter's start-up transients raise the first and last windows, so the mean is a little above.
    const fc = (FS / Math.PI) * Math.atan(Math.sqrt(Math.tan((Math.PI * 0.5) / FS) * Math.tan((Math.PI * 8) / FS)));
    const pulse = (offset: number, amplitude: number) =>
      Array.from({ length: FS * DURATION_S }, (_, i) => offset + amplitude * Math.sin(2 * Math.PI * fc * (i / FS)));
    const p = metricsFor({ PPG: pulse(10, 1) }).PPG.perfusion;
    // Reference: the same signal and 1 s windows with scipy.signal.butter(2, [0.5, 8], btype="band",
    // output="sos", fs=100) + scipy.signal.sosfiltfilt (computed 2026-11-16)
    expect(p).toBeCloseTo(20.1528575762, 6);
    // Doubling the pulse doubles it; a negative offset counts by its size
    expect(metricsFor({ PPG: pulse(10, 2) }).PPG.perfusion / p).toBeCloseTo(2, 2);
    // The whole signal negated: raw mean −x̄ and filtered −y, so |x̄| and the peak-to-peak are unchanged
    expect(metricsFor({ PPG: pulse(-10, -1) }).PPG.perfusion).toBeCloseTo(p, 6);
  });

  it('skewness S_SQI (Elgendi 2016, Eq. 3): population skewness per 5 s window, averaged', () => {
    // x = 10 + sin θ + a·sin(2θ − π/2), θ = 2π·1 Hz·t. Per period: m2 = (1 + a²)/2,
    // m3 = 3a/4 (the cross term), so skewness = (3a/4) / ((1 + a²)/2)^1.5; a = 0.5 gives 0.758947…
    // Every 5 s window holds whole periods sampled at 100 Hz, so each window has exactly this value.
    const a = 0.5;
    const x = Array.from({ length: FS * DURATION_S }, (_, i) => {
      const th = 2 * Math.PI * (i / FS);
      return 10 + Math.sin(th) + a * Math.sin(2 * th - Math.PI / 2);
    });
    const expected = ((3 * a) / 4) / Math.pow((1 + a * a) / 2, 1.5);
    expect(metricsFor({ PPG: x }).PPG.skewness).toBeCloseTo(expected, 9);
    // Mirrored signal: skewness changes sign
    expect(metricsFor({ PPG: x.map((v) => -v) }).PPG.skewness).toBeCloseTo(-expected, 9);
    // PPG only, and needs one full 5 s window
    expect(metricsFor({ ECG: x }).ECG.skewness).toBeNaN();
    expect(metricsFor({ PPG: x.slice(0, 4 * FS) }).PPG.skewness).toBeNaN();
  });

  it('filtered SD: the band-passed pulse without the offset or drift; raw SD keeps the drift', () => {
    const fc = (FS / Math.PI) * Math.atan(Math.sqrt(Math.tan((Math.PI * 0.5) / FS) * Math.tan((Math.PI * 8) / FS)));
    // Pulse at the band centre (gain 1) on a slow 0.02 Hz drift, which the 0.5 Hz high-pass removes
    const x = Array.from({ length: FS * DURATION_S }, (_, i) =>
      10 + Math.sin(2 * Math.PI * fc * (i / FS)) + 5 * Math.sin(2 * Math.PI * 0.02 * (i / FS)));
    const m = metricsFor({ PPG: x }).PPG;
    expect(m.stdDevFiltered).toBeCloseTo(Math.SQRT1_2, 1);
    expect(m.stdDev).toBeGreaterThan(2); // the drift dominates the raw SD
    expect(metricsFor({ ECG: x }).ECG.stdDevFiltered).toBeNaN();
  });

  it('perfusion: PPG names only, n/a for ECG, respiratory, too low a rate, or zero raw mean', () => {
    const r = metricsFor({ cardiac: sine(1, { offset: 5 }), pleth: sine(1, { offset: 5 }), ECG: sine(1, { offset: 5 }), respiratory: sine(0.25, { offset: 5 }) });
    expect(Number.isFinite(r.cardiac.perfusion)).toBe(true);
    expect(Number.isFinite(r.pleth.perfusion)).toBe(true);
    expect(r.ECG.perfusion).toBeNaN();
    expect(r.respiratory.perfusion).toBeNaN();
    expect(metricsFor({ PPG: new Array(FS * 10).fill(0) }).PPG.perfusion).toBeNaN();
  });
});
