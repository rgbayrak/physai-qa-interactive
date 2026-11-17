import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { join, dirname, basename, relative, isAbsolute } from 'path';
import { isPlaceholder } from '../src/data/dataset-notice';
import { downsampleChannels } from './downsample';
import {
  CONFOUNDS_PATTERNS,
  candidates,
  entitiesMatch,
  inheritedSidecar,
  isReadable,
  qualitySidecar,
  recordingOf,
  scanFile,
  scanOf,
  scanRecordings,
  withoutDesc,
} from './bids-index';
import type { BidsIndex, FileKind, IndexedFile } from './bids-index';
import { scanPrefix } from '../src/data/scan-key';
import type { ScanKeyLike } from '../src/data/scan-key';
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

/** A scan: datatype folder plus entities (src/data/scan-key.ts) */
export type ScanEntry = ScanKeyLike;

const byNumeric = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/**
 * Scans in hierarchy order: sub, ses, task, run ('' first), then datatype and
 * the other entities (through the id), compared as numbers where they are
 */
function compareScans(a: ScanEntry, b: ScanEntry): number {
  return (
    byNumeric(a.sub, b.sub) ||
    byNumeric(a.ses, b.ses) ||
    byNumeric(a.task, b.task) ||
    byNumeric(a.run, b.run) ||
    byNumeric(a.datatype, b.datatype) ||
    byNumeric(a.id, b.id)
  );
}

/**
 * Every scan in the index: one per datatype and entity set with a readable
 * physio file (see selectScanFiles in server/bids-index.ts), in hierarchy
 * order. Physio for some subjects or sessions only is fine; run-less and run
 * scans of one task, and scans without a task, are all listed.
 */
export function buildScans(index: BidsIndex): ScanEntry[] {
  return [...index.scans.values()].map((recordings) => scanOf(recordings[0])).sort(compareScans);
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

/**
 * One recording's physio file (by scan id and recording- label, '' for a file
 * without one; the first recording when not given), its inherited sidecar and
 * its quality sidecar. Null for an unknown scan or recording.
 */
export function findPhysioFiles(index: BidsIndex, scanId: string, recording?: string) {
  const recordings = scanRecordings(index, scanId);
  const file = recording === undefined ? recordings[0] : recordings.find((f) => recordingOf(f) === recording);
  return file ? physioFilesOf(index, file) : null;
}

/** Every recording of the scan, as findPhysioFiles gives them; empty for an unknown id */
export function findRecordings(index: BidsIndex, scanId: string) {
  return scanRecordings(index, scanId).map((f) => physioFilesOf(index, f));
}

function physioFilesOf(index: BidsIndex, file: IndexedFile) {
  const sidecar = inheritedSidecar(index, file);
  return {
    file,
    /** recording- label; '' when the file has none */
    recording: recordingOf(file),
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
 * The entities BOLD sidecars, confounds and events are matched against: the
 * physio file's own, without recording- and desc- (so acq-, dir-, … match)
 */
function matchEntities(file: IndexedFile): Record<string, string> {
  return scanOf(file).entities;
}

/**
 * Every recording of a scan, each read with its own inherited sidecar
 * (SamplingFrequency, StartTime, Columns), downsampling and
 * timing check (see readRecording). The recordings share t = 0: each
 * StartTime is relative to the same data file. A recording whose sidecar
 * lacks Columns or SamplingFrequency is listed in `skipped`. Null for an
 * unknown scan, or when no recording can be read.
 */
export function readPhysio(index: BidsIndex, scanId: string) {
  const result = readScanRecordings(index, scanId);
  return result && result.recordings.length ? result : null;
}

/**
 * As readPhysio, but for a known scan also when no recording can be read
 * (`recordings` empty, `skipped` says why); null only for an unknown scan
 */
export function readScanRecordings(index: BidsIndex, scanId: string) {
  const files = findRecordings(index, scanId);
  if (files.length === 0) return null;
  // BOLD timing is the same for every recording of a func/ scan: read it once
  const first = files[0].file;
  let bold: { tr: number | null; expectedVolumes: number | null } | null = null;
  if (first.datatype === 'func') {
    const scan = matchEntities(first);
    const boldTiming = readBoldTiming(index, scan);
    bold = { tr: boldTiming?.tr ?? null, expectedVolumes: boldTiming?.volumeTiming?.length ?? countConfoundVolumes(index, scan) };
  }
  const recordings: Recording[] = [];
  const skipped: { filename: string; reason: string }[] = [];
  for (const found of files) {
    let r: ReturnType<typeof readRecording>;
    try {
      r = readRecording(found, bold);
    } catch (err) {
      // Content checked at start-up (hasPhysioContent), but the file can be corrupt, or dropped since
      const what = found.tsvGzName.endsWith('.gz') ? 'gzip' : 'text';
      skipped.push({
        filename: found.tsvGzName,
        reason: `could not read the ${what} file (${err instanceof Error ? err.message : String(err)}): corrupt, or not downloaded (datalad get)`,
      });
      continue;
    }
    if (r) recordings.push(r);
    else skipped.push({ filename: found.tsvGzName, reason: 'sidecar not found or without Columns and SamplingFrequency' });
  }
  return { recordings, skipped, timeDatatype: timeDatatype(index, scanId) };
}

/** A physio file's bytes: gunzipped for *.tsv.gz, as they are for a plain *.tsv */
function readPhysioBytes(path: string): Buffer {
  const buf = readFileSync(path);
  return path.endsWith('.gz') ? gunzipSync(buf) : buf;
}

export type Recording = NonNullable<ReturnType<typeof readRecording>>;

/**
 * One recording and its inherited sidecar. For func/ physio the trigger
 * pulses are checked against the BOLD timing (`bold`, from the raw datasets,
 * BIDS_ROOT first, then the derivatives; see readBoldTiming). Physio in
 * another datatype folder is timed against that folder's data (see
 * timeReference in src/data/scan-key.ts), so the BOLD check does not apply and
 * StartTime is used as is (`bold` null).
 */
function readRecording(
  found: ReturnType<typeof physioFilesOf>,
  bold: { tr: number | null; expectedVolumes: number | null } | null,
) {
  if (!found.sidecar) return null;
  const sidecar = found.sidecar as unknown as PhysioSidecar;
  if (!Array.isArray(sidecar.Columns) || typeof sidecar.SamplingFrequency !== 'number') return null;
  const columns = parsePhysioTsv(readPhysioBytes(found.tsvGzPath), sidecar.Columns.length);

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
  const datatype = found.file.datatype ?? '';

  // Trigger timing is checked at the original rate, before any downsampling
  const trigCol = sidecar.Columns.findIndex((c) => c.toLowerCase() === 'trigger');
  const triggerSec =
    trigCol === -1
      ? []
      : detectTriggerOnsets(columns[trigCol]).map((i) => sidecar.StartTime + i / fs);
  let timing: PhysioTiming;
  if (bold) {
    timing = verifyTriggerTiming(triggerSec, bold.tr, bold.expectedVolumes, fs);
  } else {
    const folder = datatype ? `${datatype}/` : 'no datatype folder';
    timing = {
      status: 'unverified',
      detail: `Physio in ${folder}: StartTime is relative to that data, not to BOLD volumes, so no trigger check; using sidecar StartTime as-is`,
      offset: 0,
      triggerTimes: triggerSec,
    };
  }

  const ds = downsampleChannels(sidecar.Columns, columns, fs);

  return {
    filename: found.tsvGzName,
    /** recording- label; '' when the file has none */
    recording: found.recording,
    /** Datatype folder of the physio file ('' outside one): says what t = 0 is (timeReference) */
    datatype,
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

/** The scan's motion confounds; null for physio outside func/ (confounds describe BOLD volumes) */
export function readConfounds(index: BidsIndex, scanId: string) {
  const physio = scanFile(index, scanId);
  if (!physio || physio.datatype !== 'func') return null;
  const scan = matchEntities(physio);
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
 * Datatypes whose data are neural recordings: what a physio StartTime is
 * relative to ("the corresponding (neural) dataset", BIDS StartTime)
 */
const NEURAL_DATATYPES = new Set(['func', 'eeg', 'meg', 'ieeg', 'nirs', 'pet']);

/**
 * The scan's BIDS events file, following the inheritance principle: files at
 * the physio file's level or above (2.a), with no entity the physio file lacks
 * (2.c), so the run's own file, then the run-less one (it applies to every run),
 * then a top-level task-<task>_events.tsv; a run-less scan never takes a run's
 * file. Only files in the physio file's datatype folder or the top level:
 * onsets are relative to their own data file, so func/ events do not time eeg/
 * physio (a sibling folder never applies, 2.a). `inDataset` picks the datasets
 * searched.
 *
 * With `neuralFallback`, physio in beh/ (a folder without neural data) that
 * has no events of its own takes them from the same acquisition in a neural
 * datatype folder: its StartTime is relative to "the corresponding (neural)
 * dataset", which can only be that one. When two neural folders match (e.g.
 * func/ and eeg/), it is ambiguous and none is used. Null if there is none.
 */
function findEventsFile(
  index: BidsIndex,
  physio: IndexedFile,
  inDataset: (f: IndexedFile) => boolean,
  neuralFallback = false,
): IndexedFile | null {
  const scan = matchEntities(physio);
  // rel 0 (same entities) or 2 (fewer): never an events file with an entity the physio file lacks
  const applicable = (f: IndexedFile, rel: 0 | 1 | 2) => inDataset(f) && rel !== 1;
  const own = matchingFiles(
    index,
    'events',
    scan,
    (f, rel) => applicable(f, rel) && (f.datatype === physio.datatype || f.datatype === null),
  ).find((f) => isReadable(f.path));
  if (own || !neuralFallback || physio.datatype !== 'beh') return own ?? null;

  const neural = matchingFiles(
    index,
    'events',
    scan,
    (f, rel) => applicable(f, rel) && f.datatype !== null && NEURAL_DATATYPES.has(f.datatype),
  ).filter((f) => isReadable(f.path));
  const folders = new Set(neural.map((f) => f.datatype));
  return folders.size === 1 ? neural[0] : null;
}

/**
 * Datatype folder whose data t = 0 refers to (timeReference, src/data/scan-key.ts):
 * the physio file's own, except beh/ physio whose events come from the same
 * acquisition's neural folder (findEventsFile with the fallback, as readEvents
 * uses): its StartTime is taken to be relative to that data. BIDS names no
 * corresponding dataset for beh/ physio, so this is the project's reading.
 * One rule for the viewer (readPhysio) and the quality metrics (t0_datatype).
 */
export function timeDatatype(index: BidsIndex, scanId: string): string {
  const physio = scanFile(index, scanId);
  const own = physio?.datatype ?? '';
  if (!physio || own !== 'beh') return own;
  const events = findEventsFile(index, physio, (f) => f.dataset.type === 'raw', true);
  return events?.datatype && NEURAL_DATATYPES.has(events.datatype) ? events.datatype : own;
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

  return { filename: basename(filePath), onset, duration, columns, datatype: '' };
}

/**
 * Task events (BIDS *_events.tsv): onset and duration in seconds from the
 * first volume (the viewer's t = 0), plus every other column as text. Rows
 * without a numeric onset are dropped; an n/a duration counts as 0.
 * Read from the raw datasets (BIDS_ROOT first), never from derivatives; for
 * beh/ physio, from the same acquisition's neural folder when beh/ has none
 * (see findEventsFile). `datatype` names the events file's folder.
 */
export function readEvents(index: BidsIndex, scanId: string) {
  const physio = scanFile(index, scanId);
  if (!physio) return null;
  const file = findEventsFile(index, physio, (f) => f.dataset.type === 'raw', true);
  const events = file ? parseEventsFile(file.path) : null;
  // The events file's datatype folder ('' at the top level): for beh/ physio it says what t = 0 is
  return events ? { ...events, datatype: file!.datatype ?? '' } : null;
}

/** Peak rows in a physprep events file: r_peak, systolic_peak, …, each optionally _corrected */
const PEAK_TYPE_RE = /peak(_corrected)?$/i;

/**
 * TRIAL (not a supported feature yet): detected and corrected peaks from a
 * physprep-style events file in the physio file's own dataset (onset,
 * duration, trial_type such as r_peak / r_peak_corrected, channel such as
 * ECG / PPG). Only peak rows with a channel are kept. Null if there are none.
 */
export function readPeaks(index: BidsIndex, scanId: string) {
  const physio = scanFile(index, scanId);
  if (!physio) return null;
  const file = findEventsFile(index, physio, (f) => f.dataset === physio.dataset);
  const events = file ? parseEventsFile(file.path) : null;
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
  /** Scan id (src/data/scan-key.ts), e.g. func/sub-01_task-rest_run-01: names the scan the file belongs to */
  scan: string;
  datatype: string;
  /** sub/ses/task/run for people reading the file ('' when the scan has none); written from the scan id */
  sub: string;
  ses: string;
  task: string;
  run: string;
  /** recording- label of the physio file the channel is in; '' when it has none */
  recording: string;
  channel: string;
  sampling_rate: number;
  annotations: StoredAnnotation[];
}

/** Channel names are physio column names; allow _ and - but never path separators or dots */
const CHANNEL_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Where the annotations of one channel of one recording are stored: under
 * `root`, in the physio file's folder relative to its dataset (e.g.
 * sub-01/ses-02/eeg/), named by the scan prefix, then recording-<label> for a
 * split scan, then the channel. Only the index and a checked channel name
 * build the path: an unknown scan id or recording label is never turned into one.
 */
function annotationsFilePath(root: string, index: BidsIndex, scanId: string, recording: string, channel: string): string {
  const error = validateChannel(channel);
  if (error) throw new Error(error);
  if (!scanFile(index, scanId)) throw new Error(`Unknown scan: ${JSON.stringify(scanId)}`);
  const file = scanRecordings(index, scanId).find((f) => recordingOf(f) === recording);
  if (!file) throw new Error(`Unknown recording of ${scanId}: ${JSON.stringify(recording)}`);
  const folder = relative(file.dataset.root, file.dir);
  if (folder.startsWith('..') || isAbsolute(folder)) throw new Error(`Physio file outside its dataset: ${file.path}`);
  const label = recording ? `_recording-${recording}` : '';
  return join(root, folder, `${scanPrefix(scanOf(file).entities)}${label}_channel-${channel}_annotations.json`);
}

export function readAnnotations(
  root: string,
  index: BidsIndex,
  scanId: string,
  recording: string,
  channel: string,
): AnnotationsFile | null {
  const filePath = annotationsFilePath(root, index, scanId, recording, channel);
  if (!isReadable(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/** Channel name check before it goes into a file name; error message or null */
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
 * Explore and Annotate can open it: a skipped scan is never forgotten. A scan
 * counts when the channel of that name is annotated in whichever recording
 * holds it, or only in `recording` when given (e.g. respiratory of belt1,
 * when belt1 and belt2 both have one).
 */
export function annotationProgress<S extends { id: string }>(
  root: string,
  index: BidsIndex,
  scans: S[],
  channel: string,
  recording?: string,
): { annotated: number; total: number; firstUnannotated: S | null } {
  let annotated = 0;
  let firstUnannotated: S | null = null;
  for (const s of scans) {
    const labels = scanRecordings(index, s.id)
      .map(recordingOf)
      .filter((r) => recording === undefined || r === recording);
    if (labels.some((r) => isAnnotated(readAnnotations(root, index, s.id, r, channel)))) annotated++;
    else firstUnannotated ??= s;
  }
  return { annotated, total: scans.length, firstUnannotated };
}

const ANNOTATIONS_SUFFIX = '_annotations.json';

/**
 * True when any channel of any recording of the scan has annotations
 * (isAnnotated): the annotation files are found by their names in the
 * recording's folder (annotationsFilePath's naming, any channel), then read
 */
export function hasAnyAnnotation(root: string, index: BidsIndex, scanId: string): boolean {
  for (const file of scanRecordings(index, scanId)) {
    const folder = relative(file.dataset.root, file.dir);
    if (folder.startsWith('..') || isAbsolute(folder)) continue;
    const recording = recordingOf(file);
    const start = `${scanPrefix(scanOf(file).entities)}${recording ? `_recording-${recording}` : ''}_channel-`;
    let names: string[];
    try {
      names = readdirSync(join(root, folder));
    } catch {
      continue; // no annotations folder yet
    }
    for (const name of names) {
      if (!name.startsWith(start) || !name.endsWith(ANNOTATIONS_SUFFIX)) continue;
      const channel = name.slice(start.length, -ANNOTATIONS_SUFFIX.length);
      if (validateChannel(channel)) continue;
      if (isAnnotated(readAnnotations(root, index, scanId, recording, channel))) return true;
    }
  }
  return false;
}

/** The first scan (in the given order) with no annotations in any channel; null when every scan has some */
export function firstScanWithoutAnnotations<S extends { id: string }>(root: string, index: BidsIndex, scans: S[]): S | null {
  return scans.find((s) => !hasAnyAnnotation(root, index, s.id)) ?? null;
}

/**
 * Save the annotations of one channel of one recording. The scan fields
 * (scan, datatype, sub, ses, task, run) are written from the index, not taken
 * from the payload.
 */
export function writeAnnotations(root: string, index: BidsIndex, payload: AnnotationsFile): void {
  const recording = typeof payload.recording === 'string' ? payload.recording : '';
  const filePath = annotationsFilePath(root, index, payload.scan, recording, payload.channel);
  const scan = scanOf(scanFile(index, payload.scan)!);
  const { waveform_quality, waveform_comment, channel, sampling_rate, annotations } = payload;
  const file: AnnotationsFile = {
    waveform_quality,
    waveform_comment,
    scan: scan.id,
    datatype: scan.datatype,
    sub: scan.sub,
    ses: scan.ses,
    task: scan.task,
    run: scan.run,
    recording,
    channel,
    sampling_rate,
    annotations,
  };
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(file, null, 2));
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
  const physioFile = first ? scanFile(index, first.id) : undefined;
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
