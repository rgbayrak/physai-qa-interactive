import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative, sep } from 'path';
import { buildBidsIndex } from '../bids-index';
import type { BidsIndex } from '../bids-index';
import { buildScans, channelFilePath } from '../bids-layout';
import { PEAKS_SUFFIX, buildPeaksManifest, peakSignalOf, readDetectedPeaks } from '../peaks';
import type { DetectedPeaksFile } from '../../src/data/detected-peaks';

const FIXTURES = join(process.cwd(), 'test', 'fixtures');

describe('peakSignalOf', () => {
  it('sends ECG names to the ECG detectors, other cardiac names (and BIDS cardiac) to the PPG ones', () => {
    for (const name of ['ECG', 'ekg', 'ECG2', 'ecg_1']) expect(peakSignalOf(name)).toBe('ecg');
    for (const name of ['cardiac', 'PPG', 'pleth', 'pulse_ox', 'BVP']) expect(peakSignalOf(name)).toBe('ppg');
  });

  it('sends respiratory names to the respiration detectors', () => {
    for (const name of ['respiratory', 'RSP', 'resp', 'belt']) expect(peakSignalOf(name)).toBe('resp');
  });

  it('gives no detectors to other signals, non-physio columns or unknown names', () => {
    for (const name of ['trigger', 'EDA', 'co2', 'foo', '']) expect(peakSignalOf(name)).toBeNull();
  });
});

describe('buildPeaksManifest (fixture: bids-recordings)', () => {
  let index: BidsIndex;
  const outDir = join(tmpdir(), 'peaks-out');
  beforeAll(() => {
    index = buildBidsIndex({ bidsRoot: join(FIXTURES, 'bids-recordings') });
  });

  it('lists each PPG and respiratory channel once, with its column, rate and output path; not the trigger', () => {
    const m = buildPeaksManifest(index, buildScans(index), outDir);
    const jobs = m.jobs.map((j) => ({ recording: j.recording, channel: j.channel, signal: j.signal, col: j.column_index, fs: j.sampling_rate }));
    expect(jobs).toEqual(
      expect.arrayContaining([
        { recording: 'cardiac', channel: 'cardiac', signal: 'ppg', col: 0, fs: 50 },
        { recording: 'belt', channel: 'respiratory', signal: 'resp', col: 0, fs: 100 },
        { recording: 'resp', channel: 'respiratory', signal: 'resp', col: 0, fs: 25 },
      ]),
    );
    expect(m.jobs.some((j) => j.channel === 'trigger')).toBe(false);
    const cardiac = m.jobs.find((j) => j.recording === 'cardiac')!;
    expect(relative(outDir, cardiac.out_path).split(sep)).toEqual([
      'sub-01',
      'func',
      `sub-01_task-rest_recording-cardiac_channel-cardiac${PEAKS_SUFFIX}`,
    ]);
    expect(cardiac.n_columns).toBe(2);
    expect(cardiac.physio_path.endsWith('sub-01_task-rest_recording-cardiac_physio.tsv.gz')).toBe(true);
  });

  it('gives the channel types table: every column, its type and why, counted per recording', () => {
    // Existing files do not change the table: it describes the columns, not what is computed
    const m = buildPeaksManifest(index, buildScans(index), outDir);
    const rows = Object.fromEntries(m.channelTypes.map((r) => [r.column, [r.type, r.recordings, r.check]]));
    expect(rows).toEqual({
      cardiac: ['PPG', 1, true], // assumed: check it
      trigger: ['—', 2, false],
      respiratory: ['respiration', 2, false], // recording-belt and recording-resp
    });
  });

  it('lets --channel retype or skip a column, and records where each type came from', () => {
    const plain = buildPeaksManifest(index, buildScans(index), outDir);
    expect(plain.jobs.find((j) => j.channel === 'cardiac')?.signal_source).toBe('name');

    const overrides = new Map([['cardiac', 'ecg'], ['respiratory', 'none']] as const);
    const m = buildPeaksManifest(index, buildScans(index), outDir, { overrides });
    expect(m.jobs.map((j) => [j.channel, j.signal, j.signal_source])).toEqual([['cardiac', 'ecg', 'override']]);
    expect(m.channelTypes.find((r) => r.column === 'cardiac')).toMatchObject({ type: 'ECG', why: 'set with --channel cardiac=ecg', check: false });
    expect(m.channelTypes.find((r) => r.column === 'respiratory')).toMatchObject({ type: '—', why: 'set with --channel respiratory=none' });
  });

  it('lists every analysed channel, whether or not it has a peaks file: detect_peaks.py decides what each still needs', () => {
    expect(buildPeaksManifest(index, buildScans(index), outDir).jobs).toHaveLength(3); // cardiac + two respiratory
  });

  it('covers only the scans given (--max-scans)', () => {
    expect(buildPeaksManifest(index, [], outDir).jobs).toEqual([]);
  });
});

describe('readDetectedPeaks', () => {
  let index: BidsIndex;
  let tmp: string;
  let scanId: string;
  const file = (over: Partial<DetectedPeaksFile> = {}): DetectedPeaksFile => ({
    scan: scanId,
    recording: '',
    channel: 'cardiac',
    signal: 'ppg',
    sampling_rate: 50,
    physio_file: 'x_physio.tsv.gz',
    detectors: [
      { id: 'app_ppg', label: 'App', library: 'app', reference: 'ad hoc', params: {}, peaks: [10, 60], error: null },
    ],
    ...over,
  });

  beforeAll(() => {
    index = buildBidsIndex({ bidsRoot: join(FIXTURES, 'bids-sessions') });
    scanId = buildScans(index)[0].id;
    tmp = mkdtempSync(join(tmpdir(), 'physio-peaks-'));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  const write = (content: string) => {
    const path = channelFilePath(tmp, index, scanId, '', 'cardiac', PEAKS_SUFFIX);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };

  it('reads the file written for the channel', () => {
    write(JSON.stringify(file()));
    expect(readDetectedPeaks(tmp, index, scanId, '', 'cardiac')).toEqual(file());
  });

  it('is null when none were computed or the file cannot be parsed', () => {
    expect(readDetectedPeaks(tmp, index, scanId, '', 'respiratory')).toBeNull();
    write('{ not json');
    expect(readDetectedPeaks(tmp, index, scanId, '', 'cardiac')).toBeNull();
    write(JSON.stringify({ scan: scanId }));
    expect(readDetectedPeaks(tmp, index, scanId, '', 'cardiac')).toBeNull();
  });

  it('never builds a path from an unknown scan, recording or an unsafe channel name', () => {
    expect(() => readDetectedPeaks(tmp, index, 'func/sub-99_task-rest', '', 'cardiac')).toThrow(/Unknown scan/);
    expect(() => readDetectedPeaks(tmp, index, scanId, 'nope', 'cardiac')).toThrow(/Unknown recording/);
    expect(() => readDetectedPeaks(tmp, index, scanId, '', '../cardiac')).toThrow(/Invalid channel/);
  });
});
