import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { gzipSync } from 'zlib';
import {
  readAnnotations,
  writeAnnotations,
  validateChannel,
  isAnnotated,
  annotationProgress,
  buildScans,
  firstScanWithoutAnnotations,
  hasAnyAnnotation,
} from '../bids-layout';
import { locksFromQuery, matchesLocks } from '../../src/data/scan-key';
import type { AnnotationsFile } from '../bids-layout';
import { buildBidsIndex } from '../bids-index';
import type { BidsIndex } from '../bids-index';

// Physio files only need to exist: the index reads names, and annotations never read the data
const PHYSIO = [
  'sub-01/ses-02/func/sub-01_ses-02_task-rest_run-01_physio.tsv.gz',
  'sub-01/ses-02/eeg/sub-01_ses-02_task-rest_run-01_physio.tsv.gz', // EEG-fMRI: a second scan
  'sub-02/func/sub-02_task-rest_physio.tsv.gz',
  'sub-03/ses-02/func/sub-03_ses-02_task-rest_run-01_physio.tsv.gz',
  'derivatives/physprep/sub-04/func/sub-04_task-rest_desc-preproc_physio.tsv.gz',
  // A scan split into recordings; belt1 and belt2 (two respiratory belts) share their column name
  'sub-05/func/sub-05_task-rest_recording-cardiac_physio.tsv.gz',
  'sub-05/func/sub-05_task-rest_recording-belt1_physio.tsv.gz',
  'sub-05/func/sub-05_task-rest_recording-belt2_physio.tsv.gz',
];

const ID = {
  func: 'func/sub-01_ses-02_task-rest_run-01',
  eeg: 'eeg/sub-01_ses-02_task-rest_run-01',
  sub02: 'func/sub-02_task-rest',
  sub03: 'func/sub-03_ses-02_task-rest_run-01',
  sub04: 'func/sub-04_task-rest',
  sub05: 'func/sub-05_task-rest',
};

const payload = (over: Partial<AnnotationsFile> = {}): AnnotationsFile => ({
  scan: ID.func,
  datatype: 'func',
  sub: '01',
  ses: '02',
  task: 'rest',
  run: '01',
  recording: '',
  channel: 'cardiac',
  sampling_rate: 50,
  annotations: [
    { id: 'a1', onset_s: 1.5, duration_s: 2, trial_type: 'fix', start_sample: 75, end_sample: 175 },
  ],
  ...over,
});

let tmp: string;
let root: string;
let index: BidsIndex;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'physio-annotations-'));
  const bids = join(tmp, 'bids');
  for (const rel of PHYSIO) {
    mkdirSync(dirname(join(bids, rel)), { recursive: true });
    // A physio file becomes a scan only with content on disk (hasPhysioContent): an empty gzip
    writeFileSync(join(bids, rel), gzipSync(''));
  }
  writeFileSync(join(bids, 'dataset_description.json'), '{}');
  index = buildBidsIndex({ bidsRoot: bids });
  root = join(tmp, 'annotations');
  mkdirSync(root);
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('annotation progress', () => {
  it('counts a scan once a signal quality rating, notes or a time window is saved', () => {
    expect(isAnnotated(null)).toBe(false);
    expect(isAnnotated(payload({ annotations: [] }))).toBe(false);
    expect(isAnnotated(payload({ annotations: [], waveform_quality: null, waveform_comment: '  ' }))).toBe(false);
    expect(isAnnotated(payload())).toBe(true); // one time window
    expect(isAnnotated(payload({ annotations: [], waveform_quality: 'good' }))).toBe(true);
    expect(isAnnotated(payload({ annotations: [], waveform_comment: 'noisy start' }))).toBe(true);
  });

  it('finds the first scan with no annotations in any channel (where a fresh launch opens)', () => {
    const scans = [{ id: ID.func }, { id: ID.sub02 }, { id: ID.sub03 }];
    expect(firstScanWithoutAnnotations(root, index, scans)).toBe(scans[0]);
    writeAnnotations(root, index, payload({ channel: 'respiratory' })); // sub-01: another channel than cardiac
    writeAnnotations(root, index, payload({ scan: ID.sub02, annotations: [] })); // saved but empty: still to do
    expect(hasAnyAnnotation(root, index, ID.func)).toBe(true);
    expect(hasAnyAnnotation(root, index, ID.sub02)).toBe(false);
    expect(firstScanWithoutAnnotations(root, index, scans)).toBe(scans[1]);
    writeAnnotations(root, index, payload({ scan: ID.sub02, waveform_quality: 'good' }));
    writeAnnotations(root, index, payload({ scan: ID.sub03 }));
    expect(firstScanWithoutAnnotations(root, index, scans)).toBeNull();
  });

  it('counts annotated scans for one channel out of all scans', () => {
    const scans = [{ id: ID.func }, { id: ID.sub02 }, { id: ID.sub03 }];
    writeAnnotations(root, index, payload()); // sub-01 cardiac: annotated
    writeAnnotations(root, index, payload({ scan: ID.sub02, annotations: [], waveform_quality: 'bad' }));
    writeAnnotations(root, index, payload({ scan: ID.sub03, annotations: [] })); // saved but empty
    writeAnnotations(root, index, payload({ scan: ID.sub03, channel: 'respiratory' })); // other channel
    // sub-03 has a cardiac file but nothing in it, so it is the first one left to do
    expect(annotationProgress(root, index, scans, 'cardiac')).toEqual({ annotated: 2, total: 3, firstUnannotated: scans[2] });
    // respiratory: only sub-03 is annotated, so the earliest scan (sub-01) comes first
    expect(annotationProgress(root, index, scans, 'respiratory')).toEqual({
      annotated: 1,
      total: 3,
      firstUnannotated: scans[0],
    });
    expect(annotationProgress(root, index, [], 'cardiac')).toEqual({ annotated: 0, total: 0, firstUnannotated: null });
  });

  it('counts the func/ and eeg/ recordings of one run as two scans', () => {
    const scans = buildScans(index).filter((s) => s.sub === '01');
    expect(scans.map((s) => s.id)).toEqual([ID.eeg, ID.func]);
    writeAnnotations(root, index, payload());
    expect(annotationProgress(root, index, scans, 'cardiac')).toEqual({
      annotated: 1,
      total: 2,
      firstUnannotated: scans[0],
    });
  });

  it('counts only the locked scans, as the progress route does for ?lock=datatype:func', () => {
    const locks = locksFromQuery(new URLSearchParams('lock=datatype%3Afunc').getAll('lock'));
    const scans = buildScans(index).filter((s) => matchesLocks(s, locks));
    expect(scans.every((s) => s.datatype === 'func')).toBe(true);
    writeAnnotations(root, index, payload()); // func/ sub-01 cardiac
    const p = annotationProgress(root, index, scans, 'cardiac');
    expect([p.annotated, p.total]).toEqual([1, scans.length]);
    expect(p.firstUnannotated?.datatype ?? 'func').toBe('func'); // never the eeg/ scan of sub-01
  });

  it('has no first unannotated scan once every scan is annotated', () => {
    writeAnnotations(root, index, payload());
    expect(annotationProgress(root, index, [{ id: ID.func }], 'cardiac').firstUnannotated).toBeNull();
  });

  it('rejects channel names that could escape the annotations folder', () => {
    expect(validateChannel('cardiac')).toBeNull();
    expect(validateChannel('resp_belt-2')).toBeNull();
    expect(validateChannel('../x')).not.toBeNull();
    expect(validateChannel('a\\b')).not.toBeNull();
    expect(validateChannel('a.json')).not.toBeNull();
  });
});

describe('annotations storage', () => {
  it('round-trips a payload in the physio file folder (sub-XX/ses-YY/func/)', () => {
    writeAnnotations(root, index, payload());
    expect(
      existsSync(join(root, 'sub-01', 'ses-02', 'func', 'sub-01_ses-02_task-rest_run-01_channel-cardiac_annotations.json')),
    ).toBe(true);
    expect(readAnnotations(root, index, ID.func, '', 'cardiac')).toEqual(payload());
  });

  it('keeps the eeg/ recording of the same run in its own folder', () => {
    writeAnnotations(root, index, payload({ scan: ID.eeg }));
    expect(
      existsSync(join(root, 'sub-01', 'ses-02', 'eeg', 'sub-01_ses-02_task-rest_run-01_channel-cardiac_annotations.json')),
    ).toBe(true);
    expect(readAnnotations(root, index, ID.func, '', 'cardiac')).toBeNull();
    expect(readAnnotations(root, index, ID.eeg, '', 'cardiac')?.datatype).toBe('eeg');
  });

  it('drops ses/run from the name for session- and run-less scans', () => {
    writeAnnotations(root, index, payload({ scan: ID.sub02 }));
    expect(existsSync(join(root, 'sub-02', 'func', 'sub-02_task-rest_channel-cardiac_annotations.json'))).toBe(true);
    expect(readAnnotations(root, index, ID.sub02, '', 'cardiac')?.annotations).toHaveLength(1);
  });

  it('places physio from a derivatives dataset relative to that dataset, without desc- in the name', () => {
    writeAnnotations(root, index, payload({ scan: ID.sub04 }));
    expect(existsSync(join(root, 'sub-04', 'func', 'sub-04_task-rest_channel-cardiac_annotations.json'))).toBe(true);
  });

  it('writes the scan fields from the index, not from the payload', () => {
    writeAnnotations(root, index, payload({ scan: ID.sub02, sub: 'x', ses: 'y', task: 'z', run: '9', datatype: 'anat' }));
    const file = readAnnotations(root, index, ID.sub02, '', 'cardiac')!;
    expect([file.scan, file.datatype, file.sub, file.ses, file.task, file.run]).toEqual([ID.sub02, 'func', '02', '', 'rest', '']);
  });

  it('keeps channels apart and overwrites on save', () => {
    writeAnnotations(root, index, payload());
    writeAnnotations(root, index, payload({ channel: 'respiratory', annotations: [] }));
    writeAnnotations(root, index, payload({ annotations: [] }));
    expect(readAnnotations(root, index, ID.func, '', 'cardiac')?.annotations).toEqual([]);
    expect(readdirSync(join(root, 'sub-01', 'ses-02', 'func'))).toHaveLength(2);
  });

  it('returns null when there is no file, or the file is not valid JSON', () => {
    expect(readAnnotations(root, index, ID.func, '', 'cardiac')).toBeNull();
    const dir = join(root, 'sub-01', 'ses-02', 'func');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'sub-01_ses-02_task-rest_run-01_channel-cardiac_annotations.json'), '{not json');
    expect(readAnnotations(root, index, ID.func, '', 'cardiac')).toBeNull();
  });
});

describe('annotations of a scan split into recordings', () => {
  const belt = (recording: string, over: Partial<AnnotationsFile> = {}) =>
    payload({ scan: ID.sub05, recording, channel: 'respiratory', ...over });

  it('keeps one file per recording and channel, named with recording-<label>', () => {
    writeAnnotations(root, index, belt('belt1'));
    writeAnnotations(root, index, belt('belt2', { annotations: [] }));
    const dir = join(root, 'sub-05', 'func');
    expect(readdirSync(dir).sort()).toEqual([
      'sub-05_task-rest_recording-belt1_channel-respiratory_annotations.json',
      'sub-05_task-rest_recording-belt2_channel-respiratory_annotations.json',
    ]);
    expect(readAnnotations(root, index, ID.sub05, 'belt1', 'respiratory')?.annotations).toHaveLength(1);
    expect(readAnnotations(root, index, ID.sub05, 'belt2', 'respiratory')?.recording).toBe('belt2');
  });

  it('counts a scan by column name in whichever recording holds it, or in one recording when asked', () => {
    const scans = [{ id: ID.sub05 }];
    writeAnnotations(root, index, belt('belt2'));
    expect(annotationProgress(root, index, scans, 'respiratory').annotated).toBe(1);
    expect(annotationProgress(root, index, scans, 'respiratory', 'belt2').annotated).toBe(1);
    expect(annotationProgress(root, index, scans, 'respiratory', 'belt1').annotated).toBe(0);
    writeAnnotations(root, index, payload({ scan: ID.sub05, recording: 'cardiac' }));
    expect(annotationProgress(root, index, scans, 'cardiac').annotated).toBe(1);
  });

  it('refuses a recording the scan does not have, and the empty label for a split scan', () => {
    expect(() => writeAnnotations(root, index, belt('belt3'))).toThrow(/Unknown recording/);
    expect(() => writeAnnotations(root, index, belt(''))).toThrow(/Unknown recording/);
    expect(readdirSync(root)).toEqual([]);
  });
});

describe('path safety', () => {
  it('refuses a scan id that is not in the index and writes nothing', () => {
    for (const scan of ['func/sub-../../escaped_task-rest', '../../etc', 'func/sub-99_task-rest']) {
      expect(() => writeAnnotations(root, index, payload({ scan }))).toThrow(/Unknown scan/);
    }
    expect(() => writeAnnotations(root, index, payload({ channel: '../../../escaped' }))).toThrow(/Invalid channel/);
    expect(readdirSync(root)).toEqual([]);
    expect(existsSync(join(tmp, 'escaped'))).toBe(false);
  });

  it('readAnnotations refuses traversal instead of reading outside the root', () => {
    expect(() => readAnnotations(root, index, ID.func, '', '../../secret')).toThrow(/Invalid channel/);
    expect(() => readAnnotations(root, index, '../../secret', '', 'cardiac')).toThrow(/Unknown scan/);
    // A recording label that is not one of the scan's never becomes part of a path
    expect(() => readAnnotations(root, index, ID.func, '../../x', 'cardiac')).toThrow(/Unknown recording/);
  });

  it('stores what it was given as JSON', () => {
    writeAnnotations(root, index, payload({ waveform_comment: 'ok' }));
    const path = join(root, 'sub-01', 'ses-02', 'func', 'sub-01_ses-02_task-rest_run-01_channel-cardiac_annotations.json');
    expect(JSON.parse(readFileSync(path, 'utf-8')).waveform_comment).toBe('ok');
  });
});
