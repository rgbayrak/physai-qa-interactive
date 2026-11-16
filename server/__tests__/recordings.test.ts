import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { gzipSync } from 'zlib';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { buildScans, readPhysio, writeAnnotations, annotationProgress } from '../bids-layout';
import { buildBidsIndex } from '../bids-index';
import { runQualityMetrics } from '../quality-metrics';
import { scanChannels } from '../../src/viewer/controls';

// Scans split into recording-<label> files, end to end: the index, each
// recording read with its own sidecar, the names Explore and Annotate gives
// the channels, the quality metrics rows and the annotation files.
// BIDS: recordings with different sampling frequencies or devices MUST be in
// separate files told apart by recording-<label>; physio may sit in func, eeg,
// meg (and other) datatype folders (rules/files/raw/task.yaml, timeseries).

// Made when the file loads: the describe blocks below write their datasets while tests are collected
const dir = mkdtempSync(join(tmpdir(), 'bids-recordings-'));
let n = 0;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A new dataset folder (data/<name>/) with a dataset_description.json; returns its name and root */
function dataset(): { name: string; root: string } {
  const name = `ds${++n}`;
  const root = join(dir, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'dataset_description.json'), JSON.stringify({ Name: name, BIDSVersion: '1.10.0' }));
  return { name, root };
}

/**
 * One physio file and its own sidecar: `seconds` of a sine per column at `fs`
 * Hz (different frequencies per column, so the signals are not flat)
 */
function recording(path: string, columns: string[], fs: number, startTime = 0, seconds = 20, extra: object = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const lines: string[] = [];
  for (let i = 0; i < fs * seconds; i++) {
    const t = startTime + i / fs;
    lines.push(columns.map((_, c) => Math.sin(2 * Math.PI * (0.25 + c) * t).toFixed(4)).join('\t'));
  }
  writeFileSync(path, gzipSync(lines.join('\n') + '\n'));
  writeFileSync(
    path.replace(/\.tsv\.gz$/, '.json'),
    JSON.stringify({ SamplingFrequency: fs, StartTime: startTime, Columns: columns, ...extra }),
  );
}

const names = (bidsRoot: string, id: string) => scanChannels(readPhysio(buildBidsIndex({ bidsRoot }), id)!).map((c) => c.label);

describe('two respiratory belts in one func scan (two devices, two rates)', () => {
  const { name, root } = dataset();
  const func = join(root, 'sub-01', 'func');
  recording(join(func, 'sub-01_task-rest_recording-belt1_physio.tsv.gz'), ['respiratory'], 25, -1, 20, {
    Manufacturer: 'Siemens',
  });
  recording(join(func, 'sub-01_task-rest_recording-belt2_physio.tsv.gz'), ['respiratory'], 100, 0, 20, {
    Manufacturer: 'BIOPAC',
  });
  const ID = 'func/sub-01_task-rest';

  it('is one scan with both belts loaded, each with its own rate and StartTime', () => {
    const idx = buildBidsIndex({ bidsRoot: root });
    expect(buildScans(idx).map((s) => s.id)).toEqual([ID]);
    const recs = readPhysio(idx, ID)!.recordings;
    expect(recs.map((r) => [r.recording, r.samplingFrequency, r.startTime, r.numSamples])).toEqual([
      ['belt1', 25, -1, 500],
      ['belt2', 100, 0, 2000],
    ]);
    expect(idx.stats.physioRecordings).toBe(2);
  });

  it('names each belt by its recording, since both columns are called respiratory', () => {
    expect(names(root, ID)).toEqual(['respiratory (recording-belt1)', 'respiratory (recording-belt2)']);
  });

  it('computes metrics per belt and counts two physio recordings', () => {
    const { rows, summary } = runQualityMetrics({ dataDir: dir, dataset: name, outRoot: join(dir, 'quality') });
    expect(rows.map((r) => [r.recording, r.channel, r.samplingFrequency])).toEqual([
      ['belt1', 'respiratory', 25],
      ['belt2', 'respiratory', 100],
    ]);
    expect([summary.nScans, summary.nPhysio]).toEqual([1, 2]);
  });

  it('keeps the belts annotations in separate files, and counts them per belt', () => {
    const idx = buildBidsIndex({ bidsRoot: root });
    const annRoot = join(dir, `annotations-${name}`);
    const base = {
      scan: ID,
      datatype: 'func',
      sub: '01',
      ses: '',
      task: 'rest',
      run: '',
      channel: 'respiratory',
      sampling_rate: 25,
      annotations: [{ id: 'a', onset_s: 1, duration_s: 1, trial_type: 'fix', start_sample: 25, end_sample: 50 }],
    };
    writeAnnotations(annRoot, idx, { ...base, recording: 'belt2' });
    expect(existsSync(join(annRoot, 'sub-01', 'func', 'sub-01_task-rest_recording-belt2_channel-respiratory_annotations.json'))).toBe(
      true,
    );
    expect(annotationProgress(annRoot, idx, [{ id: ID }], 'respiratory', 'belt1').annotated).toBe(0);
    expect(annotationProgress(annRoot, idx, [{ id: ID }], 'respiratory', 'belt2').annotated).toBe(1);
  });
});

describe('belts named by device (recording-siemensBelt, recording-biopacBelt), at different sampling frequencies', () => {
  const { root } = dataset();
  const func = join(root, 'sub-01', 'ses-1', 'func');
  recording(join(func, 'sub-01_ses-1_task-rest_run-1_recording-siemensBelt_physio.tsv.gz'), ['respiratory'], 50);
  recording(join(func, 'sub-01_ses-1_task-rest_run-1_recording-biopacBelt_physio.tsv.gz'), ['respiratory'], 1000, 0, 5);
  const ID = 'func/sub-01_ses-1_task-rest_run-1';

  it('reads each belt at its own sampling frequency', () => {
    const recs = readPhysio(buildBidsIndex({ bidsRoot: root }), ID)!.recordings;
    // Recordings come in label order (biopacBelt before siemensBelt)
    expect(recs.map((r) => [r.recording, r.samplingFrequency, r.numSamples])).toEqual([
      ['biopacBelt', 1000, 5000],
      ['siemensBelt', 50, 1000],
    ]);
  });

  it('names each belt by its label', () => {
    expect(names(root, ID)).toEqual(['respiratory (recording-biopacBelt)', 'respiratory (recording-siemensBelt)']);
  });
});

describe('recording- files in eeg, meg and func folders', () => {
  const { name, root } = dataset();
  const sub = join(root, 'sub-01', 'ses-1');
  // EEG-fMRI: physio next to the BOLD run and next to the EEG recording
  recording(join(sub, 'func', 'sub-01_ses-1_task-rest_recording-cardiac_physio.tsv.gz'), ['cardiac'], 100, -30);
  recording(join(sub, 'func', 'sub-01_ses-1_task-rest_recording-respiratory_physio.tsv.gz'), ['respiratory'], 25, -30);
  recording(join(sub, 'eeg', 'sub-01_ses-1_task-rest_recording-cardiac_physio.tsv.gz'), ['cardiac'], 500, 0, 4);
  recording(join(sub, 'eeg', 'sub-01_ses-1_task-rest_recording-respiratory_physio.tsv.gz'), ['respiratory'], 50);
  // MEG with two respiratory belts
  recording(join(sub, 'meg', 'sub-01_ses-1_task-rest_recording-belt1_physio.tsv.gz'), ['respiratory'], 50);
  recording(join(sub, 'meg', 'sub-01_ses-1_task-rest_recording-belt2_physio.tsv.gz'), ['respiratory'], 200, 0, 5);

  it('makes one scan per datatype folder, each with its own recordings', () => {
    const idx = buildBidsIndex({ bidsRoot: root });
    expect(buildScans(idx).map((s) => s.id)).toEqual([
      'eeg/sub-01_ses-1_task-rest',
      'func/sub-01_ses-1_task-rest',
      'meg/sub-01_ses-1_task-rest',
    ]);
    const recs = (id: string) => readPhysio(idx, id)!.recordings.map((r) => [r.recording, r.samplingFrequency]);
    expect(recs('func/sub-01_ses-1_task-rest')).toEqual([['cardiac', 100], ['respiratory', 25]]);
    expect(recs('eeg/sub-01_ses-1_task-rest')).toEqual([['cardiac', 500], ['respiratory', 50]]);
    expect(recs('meg/sub-01_ses-1_task-rest')).toEqual([['belt1', 50], ['belt2', 200]]);
    expect(idx.stats.physioRecordings).toBe(6);
  });

  it('keeps plain names where each recording has its own column, labels only where two share one', () => {
    expect(names(root, 'func/sub-01_ses-1_task-rest')).toEqual(['cardiac', 'respiratory']);
    expect(names(root, 'eeg/sub-01_ses-1_task-rest')).toEqual(['cardiac', 'respiratory']);
    expect(names(root, 'meg/sub-01_ses-1_task-rest')).toEqual([
      'respiratory (recording-belt1)',
      'respiratory (recording-belt2)',
    ]);
  });

  it('times eeg/ and meg/ recordings against their own data (no BOLD trigger check)', () => {
    const idx = buildBidsIndex({ bidsRoot: root });
    for (const dt of ['eeg', 'meg']) {
      for (const r of readPhysio(idx, `${dt}/sub-01_ses-1_task-rest`)!.recordings) {
        expect(r.datatype).toBe(dt);
        expect(r.timing.detail).toMatch(new RegExp(`Physio in ${dt}/`));
      }
    }
  });

  it('computes metrics for all six recordings of the three scans', () => {
    const { rows, summary } = runQualityMetrics({ dataDir: dir, dataset: name, outRoot: join(dir, 'quality') });
    expect([summary.nScans, summary.nPhysio]).toEqual([3, 6]);
    expect(rows.map((r) => `${r.datatype}:${r.recording}:${r.channel}`)).toEqual([
      'eeg:cardiac:cardiac',
      'eeg:respiratory:respiratory',
      'func:cardiac:cardiac',
      'func:respiratory:respiratory',
      'meg:belt1:respiratory',
      'meg:belt2:respiratory',
    ]);
  });
});
