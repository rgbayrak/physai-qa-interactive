// Detected peaks of one channel: the file scripts/detect_peaks.py writes
// (data/peaks/<dataset>/…/<scan>[_recording-X]_channel-<ch>_peaks.json) and
// the viewer reads through /api/bids/detected-peaks. Relative imports only:
// this module is also loaded by Node scripts.

/** Detector family of a channel (server/peaks.ts peakSignalOf) */
export type PeakSignal = 'ppg' | 'ecg' | 'resp';

export interface DetectorResult {
  /** Stable id, e.g. neurokit2_elgendi2013 */
  id: string;
  /** Shown in the viewer, e.g. "Elgendi 2013 (NeuroKit2)" */
  label: string;
  /** Library and version, e.g. "neurokit2 0.3.0"; "in-house" or "app" for the others */
  library: string;
  /** Author-year reference, or why there is none */
  reference: string;
  /** Settings used, including the cleaning step */
  params: Record<string, unknown>;
  /** The signal type's default detector (the one compute-peaks runs unless told otherwise); absent in older files */
  default?: boolean;
  /** Peak positions as sample indices at sampling_rate, from the first sample of the file */
  peaks: number[];
  /** Why the detector gave no peaks (an exception, n/a samples); null when it ran */
  error: string | null;
}

export interface DetectedPeaksFile {
  scan: string;
  recording: string;
  channel: string;
  signal: PeakSignal;
  /** Where the type came from: the column name, or --channel; absent in files written before it was recorded */
  signal_source?: 'name' | 'override';
  /** Rate the sample indices are at: the file's own (sidecar SamplingFrequency) */
  sampling_rate: number;
  physio_file: string;
  detectors: DetectorResult[];
}

/**
 * Peak times (s) on the viewer's time axis: the recording's start time plus
 * index / rate (the same axis as toDataPoints in bids-physio-reader.ts).
 */
export function detectorPeakTimes(file: DetectedPeaksFile, detectorId: string, startTime: number): number[] {
  const d = file.detectors.find((x) => x.id === detectorId);
  if (!d || !(file.sampling_rate > 0)) return [];
  return d.peaks.map((i) => startTime + i / file.sampling_rate);
}

/** The channel's detected peaks, or null when none were computed */
export async function fetchDetectedPeaks(scanId: string, recording: string, channel: string): Promise<DetectedPeaksFile | null> {
  const q = new URLSearchParams({ scan: scanId, recording, channel });
  const res = await fetch(`/api/bids/detected-peaks?${q}`);
  if (!res.ok) return null;
  return res.json();
}
