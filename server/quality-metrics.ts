import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { getSubjects, buildScans, readScanRecordings, readDatasetInfo, isReadable, findRecordings } from './bids-layout';
import type { Recording, ScanEntry } from './bids-layout';
import { buildBidsIndex, indexSummaryLines } from './bids-index';
import type { BidsIndex, IndexRoots } from './bids-index';
import { descriptionNoticeLines, noticeText } from '../src/data/dataset-notice';
import { computeSQI } from '../src/data/sqi-metrics';
import { minMaxEnvelope, roundSig } from '../src/quality/envelope';
import { analysisSignalOf, channelTypeTableLines, classifyChannel, signalOrNull } from '../src/quality/channels';
import { channelTypesOfScans } from './channel-types';
import type { ChannelOverride, SignalType } from '../src/quality/channels';
import {
  METRIC_COLUMNS,
  METRICS_TSV_NAME,
  DATASET_JSON_NAME,
  WAVEFORMS_DIR,
  REPORT_PDF_NAME,
  rowsToTsv,
  scanId,
  waveformFileName,
} from '../src/quality/metrics-tsv';
import { toScanKey } from '../src/data/scan-key';
import type {
  MetricKey,
  QualityRow,
  DatasetQualityFile,
  ParticipantsTable,
  ParticipantColumnMeta,
  WaveformFile,
} from '../src/quality/metrics-tsv';

// Dataset-wide quality metrics: runs the per-channel metrics
// (src/data/sqi-metrics.ts) over every readable
// scan and writes them to data/quality/<dataset>/. Output depends only on the
// input files: scans are in sorted order and nothing time- or machine-specific
// is written.

/** One recording of a scan, as readPhysio gives it */
type PhysioResult = Recording;

/** Buckets per channel in the waveform envelopes */
const WAVEFORM_BUCKETS = 2000;

const DATASET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

interface DatasetPaths extends IndexRoots {
  dataset: string;
}

/**
 * Locate a dataset under dataDir. The main BIDS folder is data/<dataset>
 * unless bidsRoot is given; physio and derivatives stored outside it are
 * passed as physioRoot and derivRoot, and walked too (see buildBidsIndex).
 */
export function resolveDatasetPaths(
  dataDir: string,
  dataset: string,
  overrides: { bidsRoot?: string; physioRoot?: string; derivRoot?: string } = {},
): DatasetPaths {
  if (!DATASET_NAME_RE.test(dataset)) {
    throw new Error(`Invalid dataset name "${dataset}" (letters, digits, '.', '_' and '-' only)`);
  }
  return {
    dataset,
    bidsRoot: overrides.bidsRoot ?? join(dataDir, dataset),
    physioRoot: overrides.physioRoot,
    derivRoot: overrides.derivRoot,
  };
}

interface PhysioChannels {
  /** The recording with only its physiological columns */
  raw: PhysioResult;
  /** Signal type of each kept column, same order as raw.columns; null when the name is not known */
  signals: (SignalType | null)[];
  /** Columns left out (trigger, markers, time stamps) */
  excluded: { channel: string; reason: string }[];
}

/** Keep every column except those in NON_PHYSIO_CHANNELS (src/quality/channels.ts) */
export function physioChannels(raw: PhysioResult): PhysioChannels {
  const columns: string[] = [];
  const data: number[][] = [];
  const signals: (SignalType | null)[] = [];
  const excluded: { channel: string; reason: string }[] = [];
  raw.columns.forEach((channel, i) => {
    const c = classifyChannel(channel);
    if (c.physio) {
      columns.push(channel);
      data.push(raw.data[i]);
      signals.push(c.signal);
    } else {
      excluded.push({ channel, reason: c.reason });
    }
  });
  return { raw: { ...raw, columns, data }, signals, excluded };
}

/**
 * Whether a sidecar unit is a physical one: given, and not "arbitrary".
 * BIDS: "Arbitrary units SHOULD be indicated with the string "arbitrary""
 * (BIDS Specification, Common principles, Units; checked 2026-11-16).
 * Matched exactly as BIDS writes it; other spellings (e.g. "a.u.") count as physical.
 */
export function hasPhysicalUnit(unit: string | undefined): boolean {
  return unit !== undefined && unit !== '' && unit !== 'arbitrary';
}

/** One row per physiological channel of one recording of a scan; non-physio columns (e.g. trigger) get no row */
export function scanQualityRows(
  scan: ScanEntry,
  fullRaw: PhysioResult,
  /** Datatype folder whose data t = 0 refers to (timeDatatype, server/bids-layout.ts); the recording's own when not given */
  t0Datatype: string = fullRaw.datatype,
  /** Units per column from the physio sidecar (readChannelUnits) */
  channelUnits: Record<string, string> = {},
  /** --channel types for this run (column -> type) */
  overrides: ReadonlyMap<string, ChannelOverride> = new Map(),
): QualityRow[] {
  const { raw, signals } = physioChannels(fullRaw);
  // Which metrics each column gets: one rule with the peak detectors (analysisSignalOf)
  const { metrics } = computeSQI(raw, raw.columns.map((c) => signalOrNull(analysisSignalOf(c, overrides))));
  return metrics.map((m, i) => {
    const channel = raw.columns[i];
    const q = raw.quality?.[channel];
    const values = {} as Record<MetricKey, number>;
    for (const c of METRIC_COLUMNS) values[c.key] = m[c.key];
    // The reported mean (the DC level) means nothing in arbitrary or unknown units, so it is n/a there.
    // Only this column: means used inside other metrics are computed whatever the units.
    if (!hasPhysicalUnit(channelUnits[channel])) values.mean = NaN;
    return {
      ...toScanKey(scan),
      recording: raw.recording,
      t0Datatype,
      filename: raw.filename,
      channel,
      signalType: signals[i] ?? '',
      samplingFrequency: raw.samplingFrequency,
      numSamples: raw.numSamples,
      durationS: raw.numSamples / raw.samplingFrequency,
      timingStatus: raw.timing.status,
      sidecarAssessment: q?.assessment ?? '',
      sidecarPercentValid: q?.percentValid ?? NaN,
      metrics: values,
    };
  });
}

/** Min/max envelope of every physiological channel of one recording, on the scan's t = 0 axis */
export function waveformFile(fullRaw: PhysioResult, buckets = WAVEFORM_BUCKETS): WaveformFile {
  const { raw } = physioChannels(fullRaw);
  const fs = raw.samplingFrequency;
  const channels = raw.columns.map((channel, i) => {
    const env = minMaxEnvelope(raw.data[i], buckets);
    return { channel, min: env.min, max: env.max, centres: env.centres };
  });
  const centres = channels[0]?.centres ?? [];
  return {
    filename: raw.filename,
    samplingFrequency: fs,
    times: centres.map((c) => roundSig(raw.startTime + c / fs, 7)),
    channels: channels.map(({ channel, min, max }) => ({ channel, min, max })),
  };
}

function splitTsvLine(line: string): string[] {
  return line.replace(/\r$/, '').split('\t');
}

/** participants.tsv + participants.json; null if there is no readable participants.tsv */
function readParticipants(bidsRoot: string): ParticipantsTable | null {
  const tsvPath = join(bidsRoot, 'participants.tsv');
  if (!isReadable(tsvPath)) return null;
  const lines = readFileSync(tsvPath, 'utf-8').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;
  const header = splitTsvLine(lines[0]);
  const idCol = header.indexOf('participant_id');
  if (idCol === -1) return null;

  const rows: Record<string, Record<string, string>> = {};
  for (const line of lines.slice(1)) {
    const cells = splitTsvLine(line);
    const id = (cells[idCol] ?? '').replace(/^sub-/, '');
    if (!id) continue;
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      if (i !== idCol) row[h] = cells[i] ?? '';
    });
    rows[id] = row;
  }

  const meta: Record<string, ParticipantColumnMeta> = {};
  const jsonPath = join(bidsRoot, 'participants.json');
  if (isReadable(jsonPath)) {
    try {
      const raw = JSON.parse(readFileSync(jsonPath, 'utf-8')) as Record<string, Record<string, unknown>>;
      for (const col of header) {
        const entry = raw[col];
        if (!entry || typeof entry !== 'object') continue;
        const m: ParticipantColumnMeta = {};
        if (typeof entry.Description === 'string') m.description = entry.Description;
        if (typeof entry.Units === 'string') m.units = entry.Units;
        if (entry.Levels && typeof entry.Levels === 'object') {
          m.levels = Object.fromEntries(
            Object.entries(entry.Levels as Record<string, unknown>).filter(
              (e): e is [string, string] => typeof e[1] === 'string',
            ),
          );
        }
        meta[col] = m;
      }
    } catch {
      // ignore malformed participants.json
    }
  }

  return { columns: header.filter((_, i) => i !== idCol), meta, rows };
}

const byNumeric = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/**
 * Units of a recording's columns from its inherited physio sidecar, where it
 * describes a column as an object with a string "Units" (e.g. "cardiac": {"Units": "mV"}).
 */
function readChannelUnits(index: BidsIndex, scan: ScanEntry, recording: string): Record<string, string> {
  try {
    const sidecar = findRecordings(index, scan.id).find((r) => r.recording === recording)?.sidecar;
    if (!sidecar) return {};
    const units: Record<string, string> = {};
    for (const [key, value] of Object.entries(sidecar)) {
      const u = (value as { Units?: unknown } | null)?.Units;
      if (value && typeof value === 'object' && typeof u === 'string' && u.trim() !== '') units[key] = u.trim();
    }
    return units;
  } catch {
    return {};
  }
}

/** A scan or one of its recordings, for the log and failedScans: func/sub-01_task-rest (recording-cardiac) */
const recordingLabel = (id: string, recording: string) => (recording ? `${id} (recording-${recording})` : id);

interface QualityRunOptions {
  /** Folder holding the datasets, normally <project>/data */
  dataDir: string;
  dataset: string;
  /** Output root; results go to <outRoot>/<dataset>/. Default <dataDir>/quality */
  outRoot?: string;
  bidsRoot?: string;
  /** Folder holding the physio files when they are not in bidsRoot */
  physioRoot?: string;
  derivRoot?: string;
  /** Compute only the first N readable scans (hierarchy order, as Prev/Next); all when not given */
  maxScans?: number;
  /** --channel types for this run (column -> type); they win over the names */
  channelOverrides?: ReadonlyMap<string, ChannelOverride>;
  buckets?: number;
  log?: (msg: string) => void;
}

interface QualityRunResult {
  outDir: string;
  rows: QualityRow[];
  summary: DatasetQualityFile;
  /** The files found, e.g. to count the physio files downloaded */
  index: BidsIndex;
  /** The scans computed: every readable scan, or the first maxScans of them */
  scans: ScanEntry[];
}

/** Compute metrics for every readable scan and write the TSV, dataset.json, waveforms and index */
export function runQualityMetrics(opts: QualityRunOptions): QualityRunResult {
  const log = opts.log ?? (() => {});
  const paths = resolveDatasetPaths(opts.dataDir, opts.dataset, {
    bidsRoot: opts.bidsRoot,
    physioRoot: opts.physioRoot,
    derivRoot: opts.derivRoot,
  });
  // A missing main BIDS folder is not fatal when the physio is elsewhere: the
  // physio metrics are still computed; only the dataset info, participants
  // and BOLD timing are empty
  const physioDir = paths.physioRoot ?? paths.bidsRoot;
  if (!existsSync(physioDir)) throw new Error(`Physio folder not found: ${physioDir}`);
  log(`Main BIDS folder: ${paths.bidsRoot}${existsSync(paths.bidsRoot) ? '' : ' (not found)'}`);
  if (paths.physioRoot) log(`Physio folder: ${paths.physioRoot}`);
  if (paths.derivRoot) log(`Derivatives folder: ${paths.derivRoot}`);
  const index = buildBidsIndex(paths);
  for (const line of indexSummaryLines(index)) log(`  ${line}`);
  const info = readDatasetInfo(index);
  for (const line of descriptionNoticeLines(info.description)) log(`Warning: ${noticeText(line)}`);

  const outRoot = opts.outRoot ?? join(opts.dataDir, 'quality');
  const outDir = join(outRoot, paths.dataset);
  const waveDir = join(outDir, WAVEFORMS_DIR);
  // The waveforms folder is ours alone; clear it so scans that disappeared leave no stale files
  rmSync(waveDir, { recursive: true, force: true });
  mkdirSync(waveDir, { recursive: true });
  // The PDF report describes the old metrics: remove it, Stats builds and saves a new one when it next opens
  rmSync(join(outDir, REPORT_PDF_NAME), { force: true });

  const subjects = getSubjects(index);
  const readableScans = buildScans(index);
  log(`${paths.dataset}: ${readableScans.length} readable scans from ${subjects.length} subjects`);
  // --max-scans: the first N in hierarchy order (e.g. sub-01's first scans), for a quick look or the user study
  const scans = opts.maxScans === undefined ? readableScans : readableScans.slice(0, opts.maxScans);
  if (scans.length < readableScans.length) {
    log(`Computing the first ${scans.length} of ${readableScans.length} readable scans (--max-scans ${opts.maxScans})`);
  }

  const rows: QualityRow[] = [];
  const failedScans: { scan: string; reason: string }[] = [];
  const channels = new Set<string>();
  const tasks = new Set<string>();
  const rates = new Set<number>();
  const subjectsWithRows = new Set<string>();
  /** Scans with at least one row; failedScans also lists single recordings, so it is not the count of failed scans */
  let scansWithRows = 0;
  /** Recordings (physio files) with at least one row */
  let physioWithRows = 0;
  const excludedCounts = new Map<string, { reason: string; scans: number }>();
  const channelUnits = new Map<string, string>();

  // What every column is taken as, and why ("!" = check), before computing; saved in dataset.json
  const channelTypes = channelTypesOfScans(index, scans, opts.channelOverrides);
  log('Channel types (from the physio.json Columns; "!" = check):');
  for (const line of channelTypeTableLines(channelTypes)) log(`  ${line}`);

  scans.forEach((scan, i) => {
    const id = scanId(scan);
    try {
      // A recording that cannot be read (corrupt, not downloaded) is listed as failed with its reason
      const physio = readScanRecordings(index, scan.id);
      if (!physio) {
        failedScans.push({ scan: id, reason: 'physio file or sidecar not found' });
        log(`  [${i + 1}/${scans.length}] ${id}: skipped (physio file or sidecar not found)`);
        return;
      }
      for (const s of physio.skipped) {
        failedScans.push({ scan: `${id} (${s.filename})`, reason: s.reason });
        log(`  [${i + 1}/${scans.length}] ${id}: ${s.filename} skipped (${s.reason})`);
      }
      // Excluded channels are counted once per scan, whichever recordings have them
      const excludedHere = new Map<string, string>();
      let scanHasRows = false;
      for (const raw of physio.recordings) {
        const label = recordingLabel(id, raw.recording);
        const { excluded } = physioChannels(raw);
        for (const e of excluded) excludedHere.set(e.channel, e.reason);
        const units = readChannelUnits(index, scan, raw.recording);
        const recordingRows = scanQualityRows(scan, raw, physio.timeDatatype, units, opts.channelOverrides);
        if (recordingRows.length === 0) {
          failedScans.push({ scan: label, reason: 'no physiological channels' });
          log(`  [${i + 1}/${scans.length}] ${label}: skipped (no physiological channels in ${raw.columns.join(', ')})`);
          continue;
        }
        scanHasRows = true;
        physioWithRows++;
        rows.push(...recordingRows);
        recordingRows.forEach((r) => channels.add(r.channel));
        // First unit seen for a channel wins (scans are in sorted order, so this is deterministic)
        for (const r of recordingRows) {
          if (units[r.channel] && !channelUnits.has(r.channel)) channelUnits.set(r.channel, units[r.channel]);
        }
        rates.add(raw.samplingFrequency);
        const wavePath = join(waveDir, waveformFileName(scan, raw.recording));
        mkdirSync(dirname(wavePath), { recursive: true });
        writeFileSync(wavePath, JSON.stringify(waveformFile(raw, opts.buckets)));
        const skipped = excluded.length ? ` (excluded: ${excluded.map((e) => e.channel).join(', ')})` : '';
        const downsampled =
          raw.originalSamplingFrequency !== raw.samplingFrequency
            ? ` (downsampled ${raw.originalSamplingFrequency} → ${raw.samplingFrequency} Hz)`
            : '';
        log(`  [${i + 1}/${scans.length}] ${label}: ${recordingRows.map((r) => r.channel).join(', ')}${skipped}${downsampled}`);
      }
      for (const [channel, reason] of excludedHere) {
        const prev = excludedCounts.get(channel);
        excludedCounts.set(channel, { reason, scans: (prev?.scans ?? 0) + 1 });
      }
      if (!scanHasRows) {
        if (!failedScans.some((f) => f.scan === id)) failedScans.push({ scan: id, reason: 'no physiological channels' });
        return;
      }
      if (scan.task) tasks.add(scan.task);
      subjectsWithRows.add(scan.sub);
      scansWithRows++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failedScans.push({ scan: id, reason });
      log(`  [${i + 1}/${scans.length}] ${id}: failed (${reason})`);
    }
  });

  const summary: DatasetQualityFile = {
    dataset: paths.dataset,
    info,
    nSubjects: subjectsWithRows.size,
    nScans: scansWithRows,
    nPhysio: physioWithRows,
    channels: [...channels].sort(byNumeric),
    tasks: [...tasks].sort(byNumeric),
    samplingFrequencies: [...rates].sort((a, b) => a - b),
    participants: readParticipants(paths.bidsRoot),
    failedScans,
    excludedChannels: [...excludedCounts]
      .map(([channel, v]) => ({ channel, reason: v.reason, scans: v.scans }))
      .sort((a, b) => byNumeric(a.channel, b.channel)),
    channelUnits: Object.fromEntries([...channelUnits].sort((a, b) => byNumeric(a[0], b[0]))),
    channelTypes,
    metricsFile: METRICS_TSV_NAME,
  };

  writeFileSync(join(outDir, METRICS_TSV_NAME), rowsToTsv(rows));
  writeFileSync(join(outDir, DATASET_JSON_NAME), JSON.stringify(summary, null, 2) + '\n');
  log(`Wrote ${rows.length} rows to ${join(outDir, METRICS_TSV_NAME)}`);
  if (channelTypes.some((r) => r.check)) log('Rows marked "!" in the channel types table above are assumed or skipped; see their fix.');

  return { outDir, rows, summary, index, scans };
}
