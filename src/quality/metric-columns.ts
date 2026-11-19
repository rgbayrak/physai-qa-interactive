import type { ChannelMetrics } from '@/data/sqi-metrics';

// Labels, decimals, descriptions and sources for each per-channel quality metric.
// The Stats tab, the scatter plot and the PDF (through src/quality/model.ts)
// take metric names from here.

export interface ColDef {
  label: string;
  key: keyof ChannelMetrics;
  decimals: number;
  description?: string;
  /** Paper the metric is taken from, author and year (e.g. "Elgendi 2016"); none for plain statistics */
  source?: string;
}

export const SQI_COLUMNS: ColDef[] = [
  { label: 'Channel', key: 'channelName', decimals: 0 },
  { label: 'Mean', key: 'mean', decimals: 4, description: 'Average of the raw signal over the whole recording. Given only when the physio sidecar gives the channel a unit other than "arbitrary" (BIDS); n/a otherwise.' },
  { label: 'Std Dev', key: 'stdDev', decimals: 4, description: 'Standard deviation of the raw signal (spread of values around the mean; includes slow drift). Range: [0, +∞)' },
  { label: 'Std Dev (filtered)', key: 'stdDevFiltered', decimals: 4, description: 'Standard deviation of the band-pass filtered signal (2nd-order Butterworth, 0.5–8 Hz, zero-phase; Elgendi et al. 2013 filter): the pulse amplitude without drift. PPG channels only for now.' },
  { label: 'SNR', key: 'snr', decimals: 3, description: 'N_SQI: variance of the absolute band-pass filtered signal over the variance of the band-pass filtered signal, in 1 s windows, averaged. A clean sine gives 1 − 8/π² ≈ 0.189. PPG channels only.', source: 'Elgendi 2016' },
  { label: 'Entropy', key: 'entropy', decimals: 3, description: 'E_SQI: −Σ x² ln(x²) of the raw signal per 1 s window, averaged. A sum, so it depends on the amplitude (units) and the sampling rate; not approximate entropy. PPG channels with a physical unit only (n/a for "arbitrary" or missing units).', source: 'Elgendi 2016' },
  { label: 'Kurtosis', key: 'kurtosis', decimals: 3, description: 'K_SQI: kurtosis of the raw signal (Pearson, normal = 3) in 1 s windows stepped by 1 s, averaged. PPG channels only.', source: 'Elgendi 2016' },
  { label: 'Skewness', key: 'skewness', decimals: 3, description: 'S_SQI: skewness of the raw signal in 5 s windows stepped by 1 s, averaged. 0 = symmetric; in the paper > 0 indicated good quality with this windowing. PPG channels only.', source: 'Elgendi 2016' },
  { label: 'Zero crossing', key: 'zeroCrossing', decimals: 3, description: 'Z_SQI: sign changes per sample of the band-pass filtered signal, in 1 s windows, averaged (the paper\'s definition and Chen 1988; Eq. 6 as printed counts samples below 0 instead). A clean pulse at f Hz gives about 2f / sampling rate. PPG channels only.', source: 'Elgendi 2016' },
  { label: 'Perfusion', key: 'perfusion', decimals: 3, description: 'Perfusion index P_SQI: peak-to-peak of the band-pass filtered signal over the absolute raw mean, × 100, in 1 s windows, averaged. Needs the DC level, so PPG channels with a physical unit only (n/a for "arbitrary" or missing units).', source: 'Elgendi 2016' },
  { label: 'Relative power', key: 'relativePower', decimals: 3, description: 'R_SQI: Welch PSD power in 1–2.25 Hz over 0–8 Hz of the raw signal, in 60 s windows stepped by 30 s, averaged (NeuroKit2 settings). PPG channels only; needs at least 60 s.', source: 'Elgendi 2016' },
];

export function formatMetricValue(val: number, decimals: number): string {
  if (val === Infinity) return 'Inf';
  if (val === -Infinity) return '-Inf';
  if (Number.isNaN(val)) return 'N/A';
  return val.toFixed(decimals);
}
