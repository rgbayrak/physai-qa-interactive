import type { DescriptionNotice } from './dataset-notice';
import type { BidsStructure } from './bids-structure';
import type { ScanKeyLike, ScanLocks } from './scan-key';
import { locksToQuery } from './scan-key';
import type { ChannelRef } from './recordings';

/** A scan: datatype folder plus entities, with its id (src/data/scan-key.ts) */
export type ScanEntry = ScanKeyLike;

/** ?scan=<id> for the per-scan API routes */
const scanQuery = (scan: ScanEntry) => `scan=${encodeURIComponent(scan.id)}`;

export interface SubjectInfo {
  id: string;
  sessions: string[];
}

interface ChannelQuality {
  assessment: string;
  percentValid: number | null;
}

/** A scan's physio: one entry per recording- file (one for a scan that is not split), all on the same t = 0 */
export interface PhysioScan {
  recordings: PhysioRaw[];
  /** Files of the scan whose sidecar could not be used */
  skipped: { filename: string; reason: string }[];
  /**
   * Datatype folder whose data t = 0 refers to (timeReference, src/data/scan-key.ts):
   * the physio file's own, or for beh/ physio the neural folder its events come
   * from (timeDatatype, server/bids-layout.ts)
   */
  timeDatatype: string;
}

/** One recording of a scan */
export interface PhysioRaw {
  filename: string;
  /** recording- label; '' when the file has none. Absent in data made before recordings were split */
  recording?: string;
  /** Datatype folder of the physio file ('' outside one): what t = 0 is (timeReference, src/data/scan-key.ts) */
  datatype: string;
  samplingFrequency: number;
  /**
   * Rate in the file. Above samplingFrequency when the server downsampled a
   * high-rate recording (server/downsample.ts); absent in older responses.
   */
  originalSamplingFrequency?: number;
  /** Time (s) of the first sample relative to t = 0: the first BOLD volume for func/, else the first sample of the datatype's data */
  startTime: number;
  /** How startTime was established and whether trigger pulses confirm it */
  timing: PhysioTiming;
  columns: string[];
  data: number[][];
  numSamples: number;
  quality: Record<string, ChannelQuality> | null;
}

export type TimingStatus = 'verified' | 'corrected' | 'mismatch' | 'unverified';

/** Mirrors server/bids-layout.ts PhysioTiming */
export interface PhysioTiming {
  status: TimingStatus;
  detail: string;
  offset: number;
  /** Trigger pulse times (s) on the scan-onset axis; empty if no trigger channel */
  triggerTimes: number[];
}

export interface DataPoint {
  time: number;
  value: number;
}

export async function fetchSubjects(): Promise<SubjectInfo[]> {
  const res = await fetch('/api/bids/subjects');
  const json = await res.json();
  return json.subjects;
}

/** Mirrors server/bids-layout.ts DatasetInfo (from dataset_description.json) */
export interface DatasetInfo {
  name: string | null;
  bidsVersion: string | null;
  datasetType: string | null;
  license: string | null;
  authors: string[];
  doi: string | null;
  derivatives: { name: string; version: string | null }[];
  /** Where the title and authors came from, and what to fix; absent from metrics computed before it existed */
  description?: DescriptionNotice;
  /** Added by the dev server; absent from the copy in the quality metrics' dataset.json */
  physioFiles?: PhysioFileCount;
  /** Added by the dev server: file and folder names checked against the declared BIDS version */
  structure?: BidsStructure;
}

/** Physio files the dataset lists and how many are downloaded (from /api/bids/dataset) */
export interface PhysioFileCount {
  onDisk: number;
  downloaded: number;
  /** How "downloaded" was decided: git-annex or files on disk */
  source: string;
}

export async function fetchDatasetInfo(): Promise<DatasetInfo | null> {
  const res = await fetch('/api/bids/dataset');
  if (!res.ok) return null;
  return res.json();
}

export async function fetchScans(): Promise<ScanEntry[]> {
  const res = await fetch('/api/bids/scans');
  const json = await res.json();
  return json.scans;
}

/** This dev server launch, for keying the visit's choices (src/viewer/persistence.ts); '' when unknown */
export async function fetchLaunchId(): Promise<string> {
  const res = await fetch('/api/bids/launch');
  if (!res.ok) return '';
  const body = await res.json();
  return typeof body?.id === 'string' ? body.id : '';
}

/** The first scan with no annotations in any channel (within the locks), or null when every scan has some */
export async function fetchFirstUnannotatedScan(locks: ScanLocks = {}): Promise<ScanEntry | null> {
  const lockQuery = locksToQuery(locks);
  const res = await fetch(`/api/bids/first-unannotated${lockQuery ? `?${lockQuery}` : ''}`);
  if (!res.ok) return null;
  return (await res.json()).scan ?? null;
}

export async function fetchPhysioRaw(scan: ScanEntry): Promise<PhysioScan> {
  const res = await fetch(`/api/bids/physio?${scanQuery(scan)}`);
  if (!res.ok) {
    // The server says why (e.g. a recording that is not downloaded); else a generic message
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ? `${scan.id}: ${body.error}` : `Failed to fetch physio for ${scan.id}`);
  }
  return res.json();
}

export function toDataPoints(raw: PhysioRaw, channel: string): DataPoint[] {
  const colIdx = raw.columns.indexOf(channel);
  if (colIdx === -1) throw new Error(`Channel "${channel}" not found`);

  const col = raw.data[colIdx];
  const points: DataPoint[] = new Array(raw.numSamples);
  const dt = 1 / raw.samplingFrequency;
  const t0 = raw.startTime;

  for (let i = 0; i < raw.numSamples; i++) {
    // An n/a sample reaches the page as null (JSON has no NaN): keep it missing, never 0
    const v = col[i] as number | null;
    points[i] = { time: t0 + i * dt, value: v == null ? NaN : v };
  }
  return points;
}

export function getTimeExtent(raw: PhysioRaw): [number, number] {
  const t0 = raw.startTime;
  const t1 = t0 + (raw.numSamples - 1) / raw.samplingFrequency;
  return [t0, t1];
}

/**
 * Visible time range for all charts: starts at scan onset (t = 0), not where
 * the physio recording starts, so pre-scan physio is out of view.
 */
export function getViewExtent(raw: PhysioRaw): [number, number] {
  const [, t1] = getTimeExtent(raw);
  return [0, Math.max(t1, 0)];
}

export interface ConfoundsRaw {
  filename: string;
  numVolumes: number;
  /** Onset (s) of each volume relative to the first volume, from the BOLD sidecar; null if unknown */
  volumeTimes: number[] | null;
  /** Confound column name → one value per volume (NaN for n/a) */
  columns: Record<string, number[]>;
}

/** Motion confounds; null when there are none (always for physio outside func/) */
export async function fetchConfounds(scan: ScanEntry): Promise<ConfoundsRaw | null> {
  const res = await fetch(`/api/bids/confounds?${scanQuery(scan)}`);
  if (!res.ok) return null;
  return res.json();
}

export interface EventsRaw {
  filename: string;
  /** Event onsets (s) from t = 0, on the same axis as the physio signal */
  onset: number[];
  /** Event durations (s); 0 when n/a */
  duration: number[];
  /** Every other events column (e.g. trial_type) → one text value per event */
  columns: Record<string, string[]>;
  /**
   * Datatype folder of the events file ('' at the top level). For beh/ physio
   * whose events come from the same acquisition's neural folder (e.g. func/),
   * t = 0 is that data's first sample. Absent in older responses
   */
  datatype?: string;
}

export async function fetchEvents(scan: ScanEntry): Promise<EventsRaw | null> {
  const res = await fetch(`/api/bids/events?${scanQuery(scan)}`);
  if (!res.ok) return null;
  return res.json();
}

/** TRIAL: detected and corrected peaks from a physprep-style events file */
export interface PeaksRaw {
  filename: string;
  /** Peak times (s), on the same axis as the events onsets */
  time: number[];
  /** Channel each peak belongs to, as written in the file (e.g. ECG, PPG) */
  channel: string[];
  /** true for *_peak_corrected rows, false for the detected *_peak rows */
  corrected: boolean[];
}

export async function fetchPeaks(scan: ScanEntry): Promise<PeaksRaw | null> {
  const res = await fetch(`/api/bids/peaks?${scanQuery(scan)}`);
  if (!res.ok) return null;
  return res.json();
}

/**
 * Convert one confound column to DataPoints on the scan-onset time axis
 * (t = 0 at the first volume, same axis as the physio signal).
 * Volume i sits at volumeTimes[i] (from the BOLD sidecar). Without BOLD
 * timing, volumes are spread evenly across the physio recording, which is
 * only approximate and wrong when physio starts before the scan.
 */
export function toConfoundPoints(confounds: ConfoundsRaw, column: string, raw: PhysioRaw): DataPoint[] {
  const values = confounds.columns[column] ?? [];
  const physioDuration = (raw.numSamples - 1) / raw.samplingFrequency;
  const fallbackTr = physioDuration / confounds.numVolumes;
  const timeOf = (i: number) =>
    confounds.volumeTimes?.[i] ?? raw.startTime + i * fallbackTr;
  const points: DataPoint[] = [];
  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    if (val == null || Number.isNaN(val)) continue;
    points.push({ time: timeOf(i), value: val });
  }
  return points;
}

export interface StoredAnnotation {
  id: string;
  onset_s: number;
  duration_s: number;
  trial_type: string;
  start_sample: number;
  end_sample: number;
}

/** Rating of a whole waveform in Explore and Annotate */
export type WaveformQuality = 'good' | 'bad' | 'fixable' | 'unknown';

export interface AnnotationsFile {
  /** Whole-waveform rating; absent in files saved before it existed */
  waveform_quality?: WaveformQuality | null;
  /** Whole-waveform quality analysis comment; absent in older files */
  waveform_comment?: string;
  /** Scan id: the server finds the file by it and writes the fields below from it */
  scan: string;
  datatype: string;
  sub: string;
  ses: string;
  task: string;
  run: string;
  /** recording- label of the file the channel is in; '' when it has none */
  recording: string;
  channel: string;
  sampling_rate: number;
  annotations: StoredAnnotation[];
}

export async function fetchAnnotations(scan: ScanEntry, ref: ChannelRef): Promise<AnnotationsFile | null> {
  const res = await fetch(
    `/api/bids/annotations?${scanQuery(scan)}&recording=${encodeURIComponent(ref.recording)}&channel=${encodeURIComponent(ref.channel)}`,
  );
  if (!res.ok) return null;
  return res.json();
}

interface AnnotationProgress {
  annotated: number;
  total: number;
  /** Earliest scan (hierarchy order) with nothing saved for the channel; null when all are annotated */
  firstUnannotated: ScanEntry | null;
}

/** How many scans have anything saved (signal quality, notes or time windows) for one channel */
/**
 * Counted by column name, in whichever recording holds it; `recording` limits
 * it to one recording, for a column two recordings share (e.g. respiratory of belt1)
 */
/** Annotation progress for one channel, over the scans with every lock (all scans when none) */
export async function fetchAnnotationProgress(
  channel: string,
  recording?: string,
  locks: ScanLocks = {},
): Promise<AnnotationProgress | null> {
  const only = recording === undefined ? '' : `&recording=${encodeURIComponent(recording)}`;
  const lockQuery = locksToQuery(locks);
  const res = await fetch(
    `/api/bids/annotation-progress?channel=${encodeURIComponent(channel)}${only}${lockQuery ? `&${lockQuery}` : ''}`,
  );
  if (!res.ok) return null;
  return res.json();
}

export async function saveAnnotations(payload: AnnotationsFile): Promise<void> {
  const res = await fetch('/api/bids/annotations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to save annotations');
}

export function getValueExtent(raw: PhysioRaw, channel: string): [number, number] {
  const colIdx = raw.columns.indexOf(channel);
  if (colIdx === -1) throw new Error(`Channel "${channel}" not found`);

  const col = raw.data[colIdx];
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < col.length; i++) {
    // Missing samples (n/a, sent as null) are left out; null would otherwise count as 0
    const v = col[i] as number | null;
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min > max) return [-1, 1]; // every sample missing: an empty chart with a readable axis
  const pad = (max - min) * 0.02;
  return [min - pad, max + pad];
}
