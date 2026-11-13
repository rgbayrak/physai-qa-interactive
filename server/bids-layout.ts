import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { join, dirname, basename, relative } from 'path';
import { isPlaceholder } from '../src/data/dataset-notice';
import { downsampleChannels } from './downsample';
import {
  CONFOUNDS_PATTERNS,
  candidates,
  entitiesMatch,
  inheritedSidecar,
  isReadable,
  qualitySidecar,
  scanKey,
  withoutDesc,
} from './bids-index';
import type { BidsIndex, FileKind, IndexedFile } from './bids-index';
import type { DescriptionField, DescriptionNotice, DescriptionSource } from '../src/data/dataset-notice';

export { isReadable };

/** Motion/intensity confound columns exposed to the viewer, in dropdown order */
const CONFOUND_COLUMNS = [
  'framewise_displacement',
  'rmsd',
  'dvars',
  'std_dvars',
  'trans_x',
  'trans_y',
  'trans_z',
  'rot_x',
  'rot_y',
  'rot_z',
];

export interface SubjectInfo {
  id: string;
  sessions: string[];
}

interface PhysioSidecar {
  SamplingFrequency: number;
  StartTime: number;
  Columns: string[];
}

export interface ScanEntry {
  sub: string;
  ses: string;
  task: string;
  run: string;
}

const byNumeric = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** Scans in hierarchy order: sub, ses, task, then run ('' first), all compared as numbers where they are */
function compareScans(a: ScanEntry, b: ScanEntry): number {
  return byNumeric(a.sub, b.sub) || byNumeric(a.ses, b.ses) || byNumeric(a.task, b.task) || byNumeric(a.run, b.run);
}

/**
 * Every scan in the index: one per sub/ses/task/run with a readable physio
 * file (see selectScanFiles in server/bids-index.ts), in hierarchy order.
 * Physio for some subjects or sessions only is fine; run-less and run scans
 * of one task are both listed.
 */
export function buildScans(index: BidsIndex): ScanEntry[] {
  return [...index.scans.values()]
    .map((f) => ({ sub: f.entities.sub, ses: f.entities.ses ?? '', task: f.entities.task, run: f.entities.run ?? '' }))
    .sort(compareScans);
}

/** Subjects with at least one scan, and their sessions ('' for physio outside a session) */
export function getSubjects(index: BidsIndex): SubjectInfo[] {
  const sessions = new Map<string, Set<string>>();
  for (const s of buildScans(index)) {
    const set = sessions.get(s.sub) ?? new Set<string>();
    set.add(s.ses);
    sessions.set(s.sub, set);
  }
  return [...sessions]
    .map(([id, set]) => ({ id, sessions: [...set].sort(byNumeric) }))
    .sort((a, b) => byNumeric(a.id, b.id));
}

export function getTasks(index: BidsIndex, sub: string, ses: string): string[] {
  const tasks = buildScans(index)
    .filter((s) => s.sub === sub && s.ses === ses)
    .map((s) => s.task);
  return [...new Set(tasks)].sort(byNumeric);
}

/** Run labels of a task (as the physio file names write them); empty when its scans have no run */
export function getRuns(index: BidsIndex, sub: string, ses: string, task: string): string[] {
  const runs = buildScans(index)
    .filter((s) => s.sub === sub && s.ses === ses && s.task === task && s.run !== '')
    .map((s) => s.run);
  return [...new Set(runs)].sort(byNumeric);
}

/** The scan's physio file (run compared as a number), its inherited sidecar and its quality sidecar */
export function findPhysioFiles(index: BidsIndex, sub: string, ses: string, task: string, run: string) {
  const file = index.scans.get(scanKey(sub, ses, task, run));
  if (!file) return null;
  const sidecar = inheritedSidecar(index, file);
  return {
    file,
    tsvGzPath: file.path,
    tsvGzName: file.name,
    /** The nearest sidecar; sidecarPaths lists every one merged, top level first */
    sidecarPath: sidecar ? sidecar.paths[sidecar.paths.length - 1] : null,
    sidecarPaths: sidecar?.paths ?? [],
    sidecar: sidecar?.values ?? null,
    qualityJsonPath: qualitySidecar(index, file),
  };
}

/**
 * Sample indices of rising edges in a trigger channel. The threshold is the
 * midpoint of the channel's range, so it works for 0/1, 0/5V, etc.
 */
export function detectTriggerOnsets(values: ArrayLike<number>): number[] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!(max > min)) return [];
  const threshold = (min + max) / 2;
  const onsets: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i] >= threshold && values[i - 1] < threshold) onsets.push(i);
  }
  return onsets;
}

/**
 * A scan's physio recording and its inherited sidecar. BOLD timing for the
 * trigger check comes from the raw datasets (BIDS_ROOT first), then the
 * derivatives (see readBoldTiming).
 */
export function readPhysio(index: BidsIndex, sub: string, ses: string, task: string, run: string) {
  const found = findPhysioFiles(index, sub, ses, task, run);
  if (!found || !found.sidecar) return null;

  const sidecar = found.sidecar as unknown as PhysioSidecar;
  if (!Array.isArray(sidecar.Columns) || typeof sidecar.SamplingFrequency !== 'number') return null;
  const columns = parsePhysioTsv(gunzipSync(readFileSync(found.tsvGzPath)), sidecar.Columns.length);

  // Read quality sidecar if available
  let quality: Record<string, { assessment: string; percentValid: number }> | null = null;
  if (found.qualityJsonPath) {
    try {
      const qRaw = JSON.parse(readFileSync(found.qualityJsonPath, 'utf-8'));
      quality = {};
      for (const key of Object.keys(qRaw)) {
        if (key === 'Description') continue;
        const entry = qRaw[key];
        if (entry && typeof entry.QualityAssessment === 'string') {
          quality[key] = {
            assessment: entry.QualityAssessment,
            percentValid: entry.PercentageValid ?? null,
          };
        }
      }
    } catch {
      // ignore malformed quality files
    }
  }

  const fs = sidecar.SamplingFrequency;
  const scan = scanEntities(sub, ses, task, run);
  const boldTiming = readBoldTiming(index, scan);
  const expectedVolumes = boldTiming?.volumeTiming?.length ?? countConfoundVolumes(index, scan);

  // Trigger timing is checked at the original rate, before any downsampling
  const trigCol = sidecar.Columns.findIndex((c) => c.toLowerCase() === 'trigger');
  const triggerSec =
    trigCol === -1
      ? []
      : detectTriggerOnsets(columns[trigCol]).map((i) => sidecar.StartTime + i / fs);
  const timing = verifyTriggerTiming(triggerSec, boldTiming?.tr ?? null, expectedVolumes, fs);

  const ds = downsampleChannels(sidecar.Columns, columns, fs);

  return {
    filename: found.tsvGzName,
    samplingFrequency: ds.samplingFrequency,
    /** Rate in the file; above samplingFrequency when the data were downsampled */
    originalSamplingFrequency: fs,
    startTime: sidecar.StartTime - timing.offset,
    timing,
    columns: sidecar.Columns,
    data: ds.data,
    numSamples: ds.data[0]?.length ?? 0,
    quality,
  };
}

/** Text decoded per step when parsing, well below Node's longest string (~512 MB) */
const PARSE_CHUNK_BYTES = 32 * 1024 * 1024;

/**
 * Parse an uncompressed physio TSV into one array per column, a chunk of
 * lines at a time, so files larger than Node's longest string can be read.
 * Lines whose first field is not a number (a header row) are skipped.
 */
export function parsePhysioTsv(buf: Buffer, numCols: number, chunkBytes = PARSE_CHUNK_BYTES): Float64Array[] {
  let maxRows = 1;
  for (let i = buf.indexOf(10); i !== -1; i = buf.indexOf(10, i + 1)) maxRows++;
  const cols = Array.from({ length: numCols }, () => new Float64Array(maxRows));
  let rows = 0;

  let start = 0;
  while (start < buf.length) {
    let end = buf.length;
    if (start + chunkBytes < buf.length) {
      // End the chunk after a newline; a line longer than a chunk ends at its own newline
      const nl = buf.lastIndexOf(10, start + chunkBytes);
      end = nl >= start ? nl + 1 : (buf.indexOf(10, start + chunkBytes) + 1 || buf.length);
    }
    for (const line of buf.toString('latin1', start, end).split('\n')) {
      if (line.length === 0) continue;
      const parts = line.split('\t');
      if (Number.isNaN(Number(parts[0]))) continue;
      for (let c = 0; c < numCols; c++) cols[c][rows] = Number(parts[c]);
      rows++;
    }
    start = end;
  }
  return cols.map((col) => col.subarray(0, rows));
}

/** The scan's entities: sub, task, and ses and run when given */
function scanEntities(sub: string, ses: string, task: string, run: string): Record<string, string> {
  const e: Record<string, string> = { sub };
  if (ses) e.ses = ses;
  e.task = task;
  if (run) e.run = run;
  return e;
}

/**
 * How a file's entities (desc- aside) relate to the scan's: 0 the same, 1 more
 * (e.g. echo-, space-: the scan's own file), 2 fewer (inherited, e.g. a
 * top-level task-<task>_bold.json), null when they conflict.
 */
function relation(file: IndexedFile, scan: Record<string, string>): 0 | 1 | 2 | null {
  const own = withoutDesc(file.entities);
  const more = entitiesMatch(scan, own);
  const fewer = entitiesMatch(own, scan);
  if (more && fewer) return 0;
  if (more) return 1;
  if (fewer) return 2;
  return null;
}

/** BIDS_ROOT's dataset first, then other raw datasets, then derivatives */
const datasetRank = (f: IndexedFile) => (f.dataset.main ? 0 : f.dataset.type === 'raw' ? 1 : 2);

/**
 * Files of one kind that match the scan, best first: by dataset (main, raw,
 * derivatives), then the scan's own files, then its multi-echo or derivative
 * variants (name order, so echo-1 first), then inherited ones (most specific
 * first). `keep` filters further.
 */
function matchingFiles(
  index: BidsIndex,
  kind: FileKind,
  scan: Record<string, string>,
  keep: (f: IndexedFile, rel: 0 | 1 | 2) => boolean = () => true,
): IndexedFile[] {
  const ranked: { f: IndexedFile; rel: 0 | 1 | 2 }[] = [];
  for (const f of candidates(index, kind, scan.sub, scan.ses ?? '')) {
    const rel = relation(f, scan);
    if (rel !== null && keep(f, rel)) ranked.push({ f, rel });
  }
  return ranked
    .sort(
      (a, b) =>
        datasetRank(a.f) - datasetRank(b.f) ||
        a.rel - b.rel ||
        (a.rel === 2 ? Object.keys(b.f.entities).length - Object.keys(a.f.entities).length : 0) ||
        byNumeric(a.f.name, b.f.name) ||
        byNumeric(a.f.path, b.f.path),
    )
    .map((r) => r.f);
}

export type TimingStatus ='verified' | 'corrected' | 'mismatch' | 'unverified';

export interface PhysioTiming {
  status: TimingStatus;
  /** Human-readable explanation shown in the viewer */
  detail: string;
  /** Seconds subtracted from the sidecar StartTime (non-zero only when 'corrected') */
  offset: number;
  /** Trigger pulse times (s) on the final scan-onset axis; empty if no trigger channel */
  triggerTimes: number[];
}

/**
 * Check trigger pulses (times on the sidecar StartTime axis, where the first
 * BOLD volume should be at t = 0) against the BOLD TR and volume count.
 *
 * The sidecar StartTime is the BIDS reference. Triggers only move the onset
 * when they look like one clean pulse per volume (spacing matches TR, count
 * matches the number of volumes) and the first pulse is off from t = 0.
 * Anything else (dummy scans, dropped pulses, wrong sampling rate) is
 * reported as a mismatch and StartTime is kept.
 */
export function verifyTriggerTiming(
  triggerSec: number[],
  tr: number | null,
  expectedVolumes: number | null,
  fs: number,
): PhysioTiming {
  const keep = (status: TimingStatus, detail: string): PhysioTiming => ({
    status,
    detail,
    offset: 0,
    triggerTimes: triggerSec,
  });

  if (triggerSec.length === 0) {
    return keep('unverified', 'No trigger pulses; using sidecar StartTime as-is');
  }
  if (tr == null) {
    return keep('unverified', 'No BOLD RepetitionTime/VolumeTiming to check triggers against; using sidecar StartTime');
  }

  // Every pulse-to-pulse interval must match TR, not just on average: one
  // extra or dropped pulse shifts every volume after it.
  const intervals = triggerSec.slice(1).map((t, i) => t - triggerSec[i]);
  const badIdx = intervals.findIndex((dt) => Math.abs(dt - tr) > 0.05 * tr);
  if (badIdx !== -1) {
    const nBad = intervals.filter((dt) => Math.abs(dt - tr) > 0.05 * tr).length;
    return keep(
      'mismatch',
      `${nBad} trigger interval(s) differ from TR ${tr} s (first: ${intervals[badIdx].toFixed(3)} s after pulse ${badIdx + 1}); using sidecar StartTime`,
    );
  }
  if (expectedVolumes != null && triggerSec.length !== expectedVolumes) {
    return keep(
      'mismatch',
      `${triggerSec.length} trigger pulses vs ${expectedVolumes} volumes (dummy scans or dropped pulses?); using sidecar StartTime`,
    );
  }

  const offset = triggerSec[0];
  const tolerance = Math.max(0.05 * tr, 2 / fs);
  if (Math.abs(offset) <= tolerance) {
    return keep(
      'verified',
      `${triggerSec.length} trigger pulses match TR ${tr} s; first pulse at ${offset.toFixed(3)} s agrees with sidecar StartTime`,
    );
  }
  return {
    status: 'corrected',
    detail: `Sidecar StartTime puts the first trigger at ${offset.toFixed(3)} s; shifted so it is at 0 (pulses match TR ${tr} s and volume count)`,
    offset,
    triggerTimes: triggerSec.map((t) => t - offset),
  };
}

interface BoldTiming {
  tr: number;
  /** BIDS VolumeTiming (s, relative to the first volume), if the sidecar has it */
  volumeTiming: number[] | null;
}

/**
 * TR and volume onsets from the BOLD sidecars that match the scan (see
 * matchingFiles): raw datasets first (the scan's own sidecar, then e.g.
 * per-echo ones, then inherited ones such as task-<task>_bold.json), then the
 * derivatives'. Returns null if no timing is found.
 */
function readBoldTiming(index: BidsIndex, scan: Record<string, string>): BoldTiming | null {
  for (const { path } of matchingFiles(index, 'bold', scan)) {
    if (!isReadable(path)) continue;
    const meta = JSON.parse(readFileSync(path, 'utf-8'));
    if (Array.isArray(meta.VolumeTiming) && meta.VolumeTiming.length > 1) {
      const vt: number[] = meta.VolumeTiming;
      return { tr: vt[1] - vt[0], volumeTiming: vt };
    }
    if (typeof meta.RepetitionTime === 'number' && meta.RepetitionTime > 0) {
      return { tr: meta.RepetitionTime, volumeTiming: null };
    }
  }
  return null;
}

/** Position of a confounds file's pattern in CONFOUNDS_PATTERNS (lower is preferred) */
export const confoundsPatternRank = (name: string) => CONFOUNDS_PATTERNS.findIndex((p) => p.test(name));

/**
 * The scan's confounds file, anywhere in the index: the first readable match
 * of the most preferred CONFOUNDS_PATTERNS entry. Multi-echo runs (…_echo-1_…,
 * …_echo-2_…) share their motion, so the lowest echo is used.
 */
function findConfoundsFile(index: BidsIndex, scan: Record<string, string>): IndexedFile | null {
  const files = matchingFiles(index, 'confounds', scan).sort(
    (a, b) => confoundsPatternRank(a.name) - confoundsPatternRank(b.name),
  );
  return files.find((f) => isReadable(f.path)) ?? null;
}

function readConfoundsText(path: string): string {
  const buf = readFileSync(path);
  return (path.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf-8');
}

/** Number of volumes (data rows) in the confounds file, or null if there is none */
function countConfoundVolumes(index: BidsIndex, scan: Record<string, string>): number | null {
  const file = findConfoundsFile(index, scan);
  if (!file) return null;
  return readConfoundsText(file.path).split('\n').filter((l) => l.length > 0).length - 1;
}

export function readConfounds(index: BidsIndex, sub: string, ses: string, task: string, run: string) {
  const scan = scanEntities(sub, ses, task, run);
  const file = findConfoundsFile(index, scan);
  if (!file) return null;
  const filePath = file.path;

  const lines = readConfoundsText(filePath).split('\n').filter((l) => l.length > 0);
  if (lines.length < 2) return null;

  const headers = lines[0].split('\t');
  const present = CONFOUND_COLUMNS.filter((c) => headers.includes(c));
  if (present.length === 0) return null;

  const columns: Record<string, number[]> = {};
  for (const c of present) columns[c] = [];
  const rows = lines.slice(1).map((l) => l.split('\t'));
  for (const c of present) {
    const idx = headers.indexOf(c);
    for (const row of rows) {
      const val = row[idx];
      columns[c].push(val === 'n/a' ? NaN : Number(val));
    }
  }

  // Volume onsets on the scan-onset axis (t = 0 = first volume)
  const bold = readBoldTiming(index, scan);
  const volumeTimes = bold
    ? Array.from({ length: rows.length }, (_, i) => bold.volumeTiming?.[i] ?? i * bold.tr)
    : null;

  return {
    filename: basename(filePath),
    numVolumes: rows.length,
    volumeTimes,
    columns,
  };
}

/**
 * The scan's BIDS events file, following BIDS inheritance: the run's own file,
 * then the run-less file (it applies to every run), then a top-level
 * task-<task>_events.tsv. A run-less scan never picks up a run's file.
 * `inDataset` picks the datasets searched. Null if there is none.
 */
function findEventsFile(
  index: BidsIndex,
  scan: Record<string, string>,
  inDataset: (f: IndexedFile) => boolean,
): string | null {
  const files = matchingFiles(index, 'events', scan, (f) => inDataset(f) && ('run' in scan || !('run' in f.entities)));
  return files.find((f) => isReadable(f.path))?.path ?? null;
}

/** Parse an events TSV; null without an onset column or rows */
function parseEventsFile(filePath: string) {
  const lines = readFileSync(filePath, 'utf-8')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;

  const headers = lines[0].split('\t').map((h) => h.trim());
  const onsetIdx = headers.indexOf('onset');
  if (onsetIdx < 0) return null;
  const durationIdx = headers.indexOf('duration');
  const other = headers.filter((h, i) => i !== onsetIdx && i !== durationIdx && h.length > 0);

  const onset: number[] = [];
  const duration: number[] = [];
  const columns: Record<string, string[]> = {};
  for (const c of other) columns[c] = [];

  for (const line of lines.slice(1)) {
    const row = line.split('\t').map((v) => v.trim());
    const t = Number(row[onsetIdx]);
    if (row[onsetIdx] === '' || !Number.isFinite(t)) continue;
    const d = durationIdx >= 0 ? Number(row[durationIdx]) : 0;
    onset.push(t);
    duration.push(Number.isFinite(d) && d > 0 ? d : 0);
    for (const c of other) columns[c].push(row[headers.indexOf(c)] ?? 'n/a');
  }
  if (onset.length === 0) return null;

  return { filename: basename(filePath), onset, duration, columns };
}

/**
 * Task events (BIDS *_events.tsv): onset and duration in seconds from the
 * first volume (the viewer's t = 0), plus every other column as text. Rows
 * without a numeric onset are dropped; an n/a duration counts as 0.
 * Read from the raw datasets (BIDS_ROOT first), never from derivatives.
 */
export function readEvents(index: BidsIndex, sub: string, ses: string, task: string, run: string) {
  const path = findEventsFile(index, scanEntities(sub, ses, task, run), (f) => f.dataset.type === 'raw');
  return path ? parseEventsFile(path) : null;
}

/** Peak rows in a physprep events file: r_peak, systolic_peak, …, each optionally _corrected */
const PEAK_TYPE_RE = /peak(_corrected)?$/i;

/**
 * TRIAL (not a supported feature yet): detected and corrected peaks from a
 * physprep-style events file in the physio file's own dataset (onset,
 * duration, trial_type such as r_peak / r_peak_corrected, channel such as
 * ECG / PPG). Only peak rows with a channel are kept. Null if there are none.
 */
export function readPeaks(index: BidsIndex, sub: string, ses: string, task: string, run: string) {
  const physio = index.scans.get(scanKey(sub, ses, task, run));
  if (!physio) return null;
  const path = findEventsFile(index, scanEntities(sub, ses, task, run), (f) => f.dataset === physio.dataset);
  const events = path ? parseEventsFile(path) : null;
  const types = events?.columns.trial_type;
  const channels = events?.columns.channel;
  if (!events || !types || !channels) return null;

  const time: number[] = [];
  const channel: string[] = [];
  const corrected: boolean[] = [];
  events.onset.forEach((t, i) => {
    const type = types[i] ?? '';
    const ch = channels[i] ?? '';
    if (!PEAK_TYPE_RE.test(type) || ch === '' || ch.toLowerCase() === 'n/a') return;
    time.push(t);
    channel.push(ch);
    corrected.push(/_corrected$/i.test(type));
  });
  return time.length > 0 ? { filename: events.filename, time, channel, corrected } : null;
}

export interface StoredAnnotation {
  id: string;
  onset_s: number;
  duration_s: number;
  trial_type: string;
  start_sample: number;
  end_sample: number;
}

export interface AnnotationsFile {
  /** Whole-waveform rating (good, bad, fixable, unknown); first in the file. Absent in older files */
  waveform_quality?: 'good' | 'bad' | 'fixable' | 'unknown' | null;
  /** Whole-waveform quality analysis comment; absent in older files */
  waveform_comment?: string;
  sub: string;
  ses: string;
  task: string;
  run: string;
  channel: string;
  sampling_rate: number;
  annotations: StoredAnnotation[];
}

/** BIDS labels are alphanumeric only (BIDS spec, "Entities") */
const LABEL_RE = /^[A-Za-z0-9]+$/;
/** Channel names are physio column names; allow _ and - but never path separators or dots */
const CHANNEL_RE = /^[A-Za-z0-9_-]+$/;

export interface ScanKey {
  sub: string;
  ses?: string;
  task?: string;
  run?: string;
  channel?: string;
}

/**
 * Check request-supplied identifiers before they are used to build a file
 * path. Returns an error message, or null if every given field is safe.
 * `ses` and `run` may be '' (session-less / run-less layouts); `sub` may not.
 */
export function validateScanKey(key: ScanKey): string | null {
  if (!LABEL_RE.test(key.sub)) return `Invalid sub label: ${JSON.stringify(key.sub)}`;
  for (const field of ['ses', 'task', 'run'] as const) {
    const v = key[field];
    if (v !== undefined && v !== '' && !LABEL_RE.test(v)) {
      return `Invalid ${field} label: ${JSON.stringify(v)}`;
    }
  }
  if (key.channel !== undefined && !CHANNEL_RE.test(key.channel)) {
    return `Invalid channel name: ${JSON.stringify(key.channel)}`;
  }
  return null;
}

function annotationsFilePath(
  root: string,
  sub: string,
  ses: string,
  task: string,
  run: string,
  channel: string,
): string {
  // Defence in depth: the server validates first, but never build a path from unchecked input
  const error = validateScanKey({ sub, ses, task, run, channel });
  if (error) throw new Error(error);
  const dir = ses
    ? join(root, `sub-${sub}`, `ses-${ses}`, 'func')
    : join(root, `sub-${sub}`, 'func');
  let base = ses ? `sub-${sub}_ses-${ses}_task-${task}` : `sub-${sub}_task-${task}`;
  if (run) base += `_run-${run}`;
  base += `_channel-${channel}_annotations.json`;
  return join(dir, base);
}

export function readAnnotations(
  root: string,
  sub: string,
  ses: string,
  task: string,
  run: string,
  channel: string,
): AnnotationsFile | null {
  const filePath = annotationsFilePath(root, sub, ses, task, run, channel);
  if (!isReadable(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/** Channel name check on its own (same rule as validateScanKey); error message or null */
export function validateChannel(channel: string): string | null {
  return CHANNEL_RE.test(channel) ? null : `Invalid channel name: ${JSON.stringify(channel)}`;
}

/**
 * A scan's channel counts as annotated once anything about it was saved: a
 * full-recording signal quality rating, notes, or at least one time window.
 */
export function isAnnotated(file: AnnotationsFile | null): boolean {
  if (!file) return false;
  return (
    file.waveform_quality != null ||
    (typeof file.waveform_comment === 'string' && file.waveform_comment.trim() !== '') ||
    (Array.isArray(file.annotations) && file.annotations.length > 0)
  );
}

/**
 * How many of the given scans are annotated for one channel ("24/80 annotated"),
 * and the first one that is not, in the scans' order (hierarchy order), so
 * Explore and Annotate can open it: a skipped scan is never forgotten.
 */
export function annotationProgress<S extends { sub: string; ses: string; task: string; run: string }>(
  root: string,
  scans: S[],
  channel: string,
): { annotated: number; total: number; firstUnannotated: S | null } {
  let annotated = 0;
  let firstUnannotated: S | null = null;
  for (const s of scans) {
    if (isAnnotated(readAnnotations(root, s.sub, s.ses, s.task, s.run, channel))) annotated++;
    else firstUnannotated ??= s;
  }
  return { annotated, total: scans.length, firstUnannotated };
}

export function writeAnnotations(root: string, payload: AnnotationsFile): void {
  const filePath = annotationsFilePath(root, payload.sub, payload.ses, payload.task, payload.run, payload.channel);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

/**
 * Folders whose dataset_description.json describes the dataset:
 * - physio: the dataset of the first scan's physio file (in hierarchy
 *   order), else BIDSPHYS_ROOT; null when that is the main folder
 * - derivatives: the dataset of the best confounds file in the index
 *   (CONFOUNDS_PATTERNS order, then path), else BIDSDER_ROOT
 */
export function descriptionFolders(index: BidsIndex): { physio: string | null; derivatives: string | null } {
  const first = buildScans(index)[0];
  const physioFile = first ? index.scans.get(scanKey(first.sub, first.ses, first.task, first.run)) : undefined;
  const physio = physioFile?.dataset.root ?? index.physioRoot ?? null;
  const confounds = index.files
    .filter((f) => f.kind === 'confounds')
    .sort((a, b) => confoundsPatternRank(a.name) - confoundsPatternRank(b.name) || byNumeric(a.path, b.path))[0];
  return {
    physio: physio && physio !== index.bidsRoot ? physio : null,
    derivatives: confounds?.dataset.root ?? index.derivRoot ?? null,
  };
}

export interface DatasetInfo {
  name: string | null;
  bidsVersion: string | null;
  datasetType: string | null;
  license: string | null;
  authors: string[];
  doi: string | null;
  /** Pipelines that generated the derivatives (e.g. fMRIPrep 23.0.2), if any */
  derivatives: { name: string; version: string | null }[];
  /** Where the title and authors came from, and what the user should fix */
  description: DescriptionNotice;
}

function readJsonIfReadable(path: string): Record<string, unknown> | null {
  if (!isReadable(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/** http(s) URL as is, a DOI as https://doi.org/…; anything else (bids: URIs, relative paths) is null */
function webLink(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^https?:\/\//i.test(s)) return s;
  const doi = s.replace(/^doi:/i, '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  return /^10\.\d{4,}\//.test(doi) ? `https://doi.org/${doi}` : null;
}

/**
 * The main BIDS folder as a DataLad subdataset of the folder above it: its
 * URL and install command from that folder's .gitmodules, or null.
 */
function subdatasetSource(bidsRoot: string): { url: string | null; command: string } | null {
  const parent = dirname(bidsRoot);
  const gitmodules = join(parent, '.gitmodules');
  if (!isReadable(gitmodules)) return null;
  const rel = relative(parent, bidsRoot);
  // [submodule "…"] sections, each with path = … and url = … (DataLad may add datalad-url)
  for (const section of readFileSync(gitmodules, 'utf-8').split(/^\s*\[submodule\b/m).slice(1)) {
    const field = (key: string) => section.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'm'))?.[1] ?? null;
    if (field('path') !== rel) continue;
    return {
      url: webLink(field('datalad-url')) ?? webLink(field('url')),
      command: `cd ${parent} && datalad get -n ${rel} && datalad get ${rel}/dataset_description.json`,
    };
  }
  return null;
}

/** First web link in a description's SourceDatasets ([{ URL, DOI, Version }]), or null */
function sourceDatasetLink(desc: Record<string, unknown> | null): string | null {
  const sources = Array.isArray(desc?.SourceDatasets) ? desc.SourceDatasets : [];
  for (const s of sources as { URL?: unknown; DOI?: unknown }[]) {
    const link = webLink(s?.URL) ?? webLink(s?.DOI);
    if (link) return link;
  }
  return null;
}

/**
 * Dataset-level metadata from dataset_description.json: BIDS_ROOT's, and the
 * derivatives' above the confounds (see descriptionFolders). When the main
 * BIDS folder has none, the title and authors come from the physio files'
 * dataset, then the derivatives', and description.mainMissing says where to
 * get the main one. Placeholder titles and authors (n/a, Unknown, Author 1,
 * …) are dropped and listed in description.missingFields.
 */
export function readDatasetInfo(index: BidsIndex): DatasetInfo {
  const { bidsRoot } = index;
  const folders = descriptionFolders(index);
  const bidsderRoot = folders.derivatives ?? join(bidsRoot, 'derivatives');
  const mainPath = join(bidsRoot, 'dataset_description.json');
  const main = readJsonIfReadable(mainPath);
  const der = folders.derivatives ? readJsonIfReadable(join(folders.derivatives, 'dataset_description.json')) : null;
  const physioPath = join(folders.physio ?? bidsRoot, 'dataset_description.json');
  const physio = folders.physio ? readJsonIfReadable(physioPath) : null;
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);

  // Title and authors: main, else physio, else derivatives
  const [source, file, desc]: [DescriptionSource, string | null, Record<string, unknown>] = main
    ? ['main', mainPath, main]
    : physio
      ? ['physio', physioPath, physio]
      : der
        ? ['derivatives', join(bidsderRoot, 'dataset_description.json'), der]
        : ['none', null, {}];
  const name = isPlaceholder(desc.Name) ? null : (desc.Name as string).trim();
  const authors = Array.isArray(desc.Authors)
    ? desc.Authors.filter((a): a is string => !isPlaceholder(a)).map((a) => a.trim())
    : [];
  const missingFields: DescriptionField[] = [];
  if (!name) missingFields.push('Name');
  if (authors.length === 0) missingFields.push('Authors');

  let mainMissing: DescriptionNotice['mainMissing'] = null;
  if (!main) {
    const sub = subdatasetSource(bidsRoot);
    mainMissing = {
      path: mainPath,
      url: sub?.url ?? sourceDatasetLink(physio) ?? sourceDatasetLink(der),
      command: sub?.command ?? null,
    };
  }

  // The other fields describe the main dataset only, never a fallback pipeline
  const raw = main ?? {};
  const generatedBy = Array.isArray(der?.GeneratedBy) ? der.GeneratedBy : [];
  return {
    name,
    bidsVersion: str(raw.BIDSVersion),
    datasetType: str(raw.DatasetType),
    license: str(raw.License),
    authors,
    doi: str(raw.DatasetDOI),
    derivatives: generatedBy
      .filter((g: { Name?: unknown }) => typeof g?.Name === 'string')
      .map((g: { Name: string; Version?: unknown }) => ({ name: g.Name, version: str(g.Version) })),
    description: { file, source, missingFields, mainMissing },
  };
}
