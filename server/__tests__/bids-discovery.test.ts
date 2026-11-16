import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { gzipSync } from 'zlib';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import {
  buildScans,
  findPhysioFiles,
  findRecordings,
  getSubjects,
  readConfounds,
  readEvents,
  readPhysio,
} from '../bids-layout';
import { buildBidsIndex, entitiesMatch, indexSummaryLines, nameEntities } from '../bids-index';
import { parseScanId } from '../../src/data/scan-key';

// Bottom-up discovery (server/bids-index.ts) on small datasets written to
// temporary folders. Files are indexed from their names, so most are empty;
// only sidecars, confounds and events have content.
// Spec: https://bids-specification.readthedocs.io/en/stable/modality-specific-files/physiological-recordings.html

let dir: string;
let n = 0;
/** A new empty dataset folder with a dataset_description.json */
const dataset = () => {
  const root = join(dir, `ds${++n}`);
  write(join(root, 'dataset_description.json'), JSON.stringify({ Name: 'test', BIDSVersion: '1.9.0' }));
  return root;
};
const write = (path: string, content: string | Buffer = '') => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
const json = (path: string, obj: object) => write(path, JSON.stringify(obj));
const index = (bidsRoot: string) => buildBidsIndex({ bidsRoot });
/** Three volumes of framewise displacement */
const confounds = 'framewise_displacement\nn/a\n0.1\n0.2\n';
/** Scan ids in hierarchy order */
const ids = (bidsRoot: string) => buildScans(index(bidsRoot)).map((s) => s.id);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bids-discovery-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('entities', () => {
  it('reads entities, suffix and extension, keeping parts without "-" out of the entities', () => {
    expect(nameEntities('sub-01_ses-1_task-rest_recording-cardiac_physio.tsv.gz')).toEqual({
      entities: { sub: '01', ses: '1', task: 'rest', recording: 'cardiac' },
      suffix: 'physio',
      extension: '.tsv.gz',
    });
    expect(nameEntities('preproc_physio.json').entities).toEqual({});
    expect(nameEntities('sub-01_task-rest_bold_confounds.tsv')).toMatchObject({ suffix: 'confounds' });
  });

  it('matches whole labels, and runs as numbers', () => {
    expect(entitiesMatch({ task: 'rest' }, { sub: '01', task: 'rest' })).toBe(true);
    expect(entitiesMatch({ task: 'rest' }, { task: 'resting' })).toBe(false);
    expect(entitiesMatch({ run: '1' }, { run: '01' })).toBe(true);
    expect(entitiesMatch({ run: '1' }, { run: '10' })).toBe(false);
    expect(entitiesMatch({ echo: '1' }, { run: '1' })).toBe(false);
  });
});

describe('where physio is found', () => {
  it('in any datatype folder, not only func/', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_physio.tsv.gz'));
    write(join(root, 'sub-02', 'eeg', 'sub-02_task-oddball_physio.tsv.gz'));
    write(join(root, 'sub-03', 'beh', 'sub-03_task-game_physio.tsv.gz'));
    const idx = index(root);
    expect(buildScans(idx)).toEqual([
      parseScanId('func/sub-01_task-rest'),
      parseScanId('eeg/sub-02_task-oddball'),
      parseScanId('beh/sub-03_task-game'),
    ]);
    expect(buildScans(idx)[1]).toEqual({
      id: 'eeg/sub-02_task-oddball',
      datatype: 'eeg',
      sub: '02',
      ses: '',
      task: 'oddball',
      run: '',
      entities: { sub: '02', task: 'oddball' },
    });
    expect(idx.stats.physioByDatatype).toEqual({ beh: 1, eeg: 1, func: 1 });
    expect(findPhysioFiles(idx, 'eeg/sub-02_task-oddball')?.file.datatype).toBe('eeg');
  });

  it('makes a scan of physio without a task (BIDS: dwi/ and perf/); only physio without sub- is left out', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_physio.tsv.gz'));
    write(join(root, 'sub-01', 'dwi', 'sub-01_dir-AP_physio.tsv.gz'));
    write(join(root, 'task-rest_physio.tsv.gz'));
    const idx = index(root);
    expect(buildScans(idx).map((s) => [s.id, s.task])).toEqual([
      ['dwi/sub-01_dir-AP', ''],
      ['func/sub-01_task-rest', 'rest'],
    ]);
    expect(idx.stats.physioByDatatype).toEqual({ dwi: 1, func: 1, none: 1 });
    expect(idx.unkeyed.map((f) => f.name)).toEqual(['task-rest_physio.tsv.gz']);
    expect(indexSummaryLines(idx).join('\n')).toContain('1 physio files without sub- not loaded');
  });

  it('tells scans apart by every entity but recording- and desc- (acq-, dir-)', () => {
    const root = dataset();
    const func = join(root, 'sub-01', 'func');
    write(join(func, 'sub-01_task-rest_acq-mb_run-1_physio.tsv.gz'));
    write(join(func, 'sub-01_task-rest_acq-sb_run-1_physio.tsv.gz'));
    write(join(func, 'sub-01_task-rest_dir-AP_run-1_physio.tsv.gz'));
    expect(ids(root)).toEqual([
      'func/sub-01_task-rest_acq-mb_run-1',
      'func/sub-01_task-rest_acq-sb_run-1',
      'func/sub-01_task-rest_dir-AP_run-1',
    ]);
  });

  it('gives a physio file outside any datatype folder an id without one', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'sub-01_task-rest_physio.tsv.gz'));
    expect(ids(root)).toEqual(['sub-01_task-rest']);
    expect(buildScans(index(root))[0].datatype).toBe('');
  });

  it('for some subjects and sessions only', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'ses-1', 'func', 'sub-01_ses-1_task-rest_physio.tsv.gz'));
    write(join(root, 'sub-01', 'ses-2', 'func', 'sub-01_ses-2_task-rest_bold.json'), '{}');
    write(join(root, 'sub-02', 'ses-1', 'anat', 'sub-02_ses-1_T1w.json'), '{}');
    write(join(root, 'sub-03', 'ses-2', 'func', 'sub-03_ses-2_task-rest_physio.tsv.gz'));
    expect(getSubjects(index(root))).toEqual([
      { id: '01', sessions: ['1'] },
      { id: '03', sessions: ['2'] },
    ]);
  });

  it('below extra folder levels', () => {
    const root = dataset();
    write(join(root, 'study', 'raw', 'sub-01', 'func', 'sub-01_task-rest_physio.tsv.gz'));
    expect(ids(root)).toEqual(['func/sub-01_task-rest']);
  });

  it('lists run-less and run scans of one task, with runs compared as numbers', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'func', 'sub-01_task-a_physio.tsv.gz'));
    write(join(root, 'sub-01', 'func', 'sub-01_task-a_run-1_physio.tsv.gz'));
    write(join(root, 'sub-01', 'func', 'sub-01_task-a_run-10_physio.tsv.gz'));
    write(join(root, 'sub-01', 'func', 'sub-01_task-a_run-2_physio.tsv.gz'));
    const idx = index(root);
    expect(buildScans(idx).map((s) => s.run)).toEqual(['', '1', '2', '10']);
    expect(findPhysioFiles(idx, 'func/sub-01_task-a_run-1')?.tsvGzName).toBe('sub-01_task-a_run-1_physio.tsv.gz');
    expect(findPhysioFiles(idx, 'func/sub-01_task-a')?.tsvGzName).toBe('sub-01_task-a_physio.tsv.gz');
    // The id is the file's own label; another spelling is not looked up
    expect(findPhysioFiles(idx, 'func/sub-01_task-a_run-01')).toBeNull();
  });

  it('keeps run-1 and run-01 of one scan together (runs are numbers)', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'func', 'sub-01_task-a_run-01_physio.tsv.gz'));
    write(join(root, 'sub-01', 'func', 'sub-01_task-a_run-1_desc-preproc_physio.tsv.gz'));
    expect(ids(root)).toEqual(['func/sub-01_task-a_run-1']);
  });
});

describe('events, by the BIDS inheritance principle and the corresponding (neural) dataset', () => {
  const events = (onset: number) => `onset\tduration\n${onset}\t1\n`;

  it('never takes an events file with an entity the physio file lacks (inheritance rule 2.c)', () => {
    const root = dataset();
    const func = join(root, 'sub-01', 'func');
    write(join(func, 'sub-01_task-rest_physio.tsv.gz'));
    write(join(func, 'sub-01_task-rest_acq-mb_events.tsv'), events(5));
    expect(readEvents(index(root), 'func/sub-01_task-rest')).toBeNull();
    write(join(func, 'sub-01_task-rest_events.tsv'), events(2));
    expect(readEvents(index(root), 'func/sub-01_task-rest')?.onset).toEqual([2]);
  });

  it('gives beh/ physio without events of its own the events of the same acquisition in func/', () => {
    const root = dataset();
    const ses = join(root, 'sub-01', 'ses-1');
    for (const rec of ['belt1', 'belt2']) write(join(ses, 'beh', `sub-01_ses-1_task-search_run-1_recording-${rec}_physio.tsv.gz`));
    write(join(ses, 'func', 'sub-01_ses-1_task-search_run-1_bold.json'), '{}');
    write(join(ses, 'func', 'sub-01_ses-1_task-search_run-1_events.tsv'), events(3));
    write(join(ses, 'func', 'sub-01_ses-1_task-search_run-2_events.tsv'), events(9)); // another run: not used
    const e = readEvents(index(root), 'beh/sub-01_ses-1_task-search_run-1');
    expect([e?.filename, e?.datatype, e?.onset]).toEqual(['sub-01_ses-1_task-search_run-1_events.tsv', 'func', [3]]);
  });

  it('uses beh/ events of its own first', () => {
    const root = dataset();
    const sub = join(root, 'sub-01');
    write(join(sub, 'beh', 'sub-01_task-search_recording-belt1_physio.tsv.gz'));
    write(join(sub, 'beh', 'sub-01_task-search_events.tsv'), events(1));
    write(join(sub, 'func', 'sub-01_task-search_events.tsv'), events(3));
    expect(readEvents(index(root), 'beh/sub-01_task-search')?.datatype).toBe('beh');
  });

  it('takes none when two neural folders match (func/ and eeg/): which one is ambiguous', () => {
    const root = dataset();
    const sub = join(root, 'sub-01');
    write(join(sub, 'beh', 'sub-01_task-search_recording-belt1_physio.tsv.gz'));
    write(join(sub, 'func', 'sub-01_task-search_events.tsv'), events(3));
    write(join(sub, 'eeg', 'sub-01_task-search_events.tsv'), events(7));
    expect(readEvents(index(root), 'beh/sub-01_task-search')).toBeNull();
  });

  it('never gives func/ physio events from beh/ or another folder', () => {
    const root = dataset();
    const sub = join(root, 'sub-01');
    write(join(sub, 'func', 'sub-01_task-search_physio.tsv.gz'));
    write(join(sub, 'beh', 'sub-01_task-search_events.tsv'), events(1));
    write(join(sub, 'eeg', 'sub-01_task-search_events.tsv'), events(7));
    expect(readEvents(index(root), 'func/sub-01_task-search')).toBeNull();
  });
});

describe('physio recordings listed (for the quality metrics coverage)', () => {
  it('counts one per recording- file: a scan split into cardiac and respiratory counts twice', () => {
    const root = dataset();
    const func = join(root, 'sub-01', 'ses-1', 'func');
    for (const task of ['a', 'b']) {
      for (const rec of ['cardiac', 'respiratory']) write(join(func, `sub-01_ses-1_task-${task}_recording-${rec}_physio.tsv.gz`));
    }
    const idx = index(root);
    expect(idx.scans.size).toBe(2);
    expect(idx.stats.physioRecordings).toBe(4);
  });

  it('counts files not downloaded, but one recording found twice (raw and desc-preproc) once, and none without sub-', () => {
    const root = dataset();
    const func = join(root, 'sub-01', 'func');
    write(join(func, 'sub-01_task-rest_physio.tsv.gz'));
    write(join(root, 'derivatives', 'prep', 'sub-01', 'func', 'sub-01_task-rest_desc-preproc_physio.tsv.gz'));
    mkdirSync(join(root, 'sub-02', 'func'), { recursive: true });
    symlinkSync('../../.git/annex/objects/missing', join(root, 'sub-02', 'func', 'sub-02_task-rest_physio.tsv.gz'));
    write(join(root, 'task-rest_physio.tsv.gz'));
    expect(index(root).stats.physioRecordings).toBe(2);
  });
});

describe('what is skipped', () => {
  it('physioevents files, recognised but never taken for physio', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_physio.tsv.gz'));
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_physioevents.tsv.gz'));
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_physioevents.json'), '{}');
    const idx = index(root);
    expect(buildScans(idx)).toHaveLength(1);
    expect(idx.stats.physioEvents).toBe(2);
    expect(findPhysioFiles(idx, 'func/sub-01_task-rest')?.tsvGzName).toBe('sub-01_task-rest_physio.tsv.gz');
  });

  it('broken symlinks (not downloaded), hidden folders, sourcedata/, code/ and folder symlinks', () => {
    const root = dataset();
    const func = join(root, 'sub-01', 'func');
    mkdirSync(func, { recursive: true });
    symlinkSync('../../.git/annex/objects/missing', join(func, 'sub-01_task-rest_physio.tsv.gz'));
    write(join(root, '.git', 'sub-02', 'func', 'sub-02_task-rest_physio.tsv.gz'));
    write(join(root, 'sourcedata', 'sub-03', 'func', 'sub-03_task-rest_physio.tsv.gz'));
    write(join(root, 'code', 'sub-04', 'func', 'sub-04_task-rest_physio.tsv.gz'));
    const elsewhere = join(dir, 'elsewhere');
    write(join(elsewhere, 'sub-05', 'func', 'sub-05_task-rest_physio.tsv.gz'));
    symlinkSync(elsewhere, join(root, 'linked'));
    const idx = index(root);
    expect(buildScans(idx)).toEqual([]);
    expect(idx.files.filter((f) => f.kind === 'physio').map((f) => f.name)).toEqual(['sub-01_task-rest_physio.tsv.gz']);
    expect(idx.stats.unreadablePhysio).toBe(1);
  });

  it('a folder without physio gives no scans instead of failing', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_bold.json'), '{}');
    const idx = index(root);
    expect(buildScans(idx)).toEqual([]);
    expect(getSubjects(idx)).toEqual([]);
    expect(indexSummaryLines(idx).join('\n')).toContain('Readable physio files: none');
  });
});

describe('one physio file per scan', () => {
  it('two scans when the same run has physio in func/ and eeg/ (EEG-fMRI)', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'eeg', 'sub-01_task-rest_physio.tsv.gz'));
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_physio.tsv.gz'));
    const idx = index(root);
    expect(ids(root)).toEqual(['eeg/sub-01_task-rest', 'func/sub-01_task-rest']);
    expect(findPhysioFiles(idx, 'eeg/sub-01_task-rest')?.file.datatype).toBe('eeg');
    expect(idx.duplicates).toEqual([]);
  });

  it('desc-preproc over the raw file, then name order for recording- files, the others logged', () => {
    const root = dataset();
    const func = join(root, 'sub-01', 'func');
    write(join(func, 'sub-01_task-rest_physio.tsv.gz'));
    write(join(func, 'sub-01_task-rest_desc-preproc_physio.tsv.gz'));
    write(join(func, 'sub-01_task-b_recording-resp_physio.tsv.gz'));
    write(join(func, 'sub-01_task-b_recording-cardiac_physio.tsv.gz'));
    const idx = index(root);
    expect(findPhysioFiles(idx, 'func/sub-01_task-rest')?.tsvGzName).toBe('sub-01_task-rest_desc-preproc_physio.tsv.gz');
    expect(findPhysioFiles(idx, 'func/sub-01_task-b')?.tsvGzName).toBe('sub-01_task-b_recording-cardiac_physio.tsv.gz');
    // Every recording- file is loaded; only the raw copy of the desc-preproc recording is left out
    expect(findRecordings(idx, 'func/sub-01_task-b').map((r) => r.recording)).toEqual(['cardiac', 'resp']);
    const log = indexSummaryLines(idx).join('\n');
    expect(log).toContain('1 scans split into recording- files');
    expect(log).toContain(
      'sub-01/func/sub-01_task-rest_desc-preproc_physio.tsv.gz loaded; same recording not loaded: sub-01/func/sub-01_task-rest_physio.tsv.gz',
    );
    expect(idx.duplicates).toHaveLength(1);
  });
});

describe('sidecar inheritance', () => {
  it('merges top-level, subject, session and run-less sidecars; the nearest, most specific wins', () => {
    const root = dataset();
    const func = join(root, 'sub-01', 'ses-1', 'func');
    write(join(func, 'sub-01_ses-1_task-rest_run-1_physio.tsv.gz'));
    json(join(root, 'task-rest_physio.json'), { SamplingFrequency: 100, StartTime: 0, Columns: ['a'], Manufacturer: 'top' });
    json(join(root, 'sub-01', 'sub-01_task-rest_physio.json'), { Manufacturer: 'subject', Level: 'subject' });
    json(join(root, 'sub-01', 'ses-1', 'sub-01_ses-1_task-rest_physio.json'), { Level: 'session' });
    json(join(func, 'sub-01_ses-1_task-rest_physio.json'), { StartTime: -1 });
    json(join(func, 'sub-01_ses-1_task-rest_run-1_physio.json'), { Columns: ['cardiac', 'trigger'] });
    // Not applicable: another task, another run, and an eeg/ sidecar (not above the func/ file)
    json(join(root, 'task-other_physio.json'), { Manufacturer: 'wrong' });
    json(join(func, 'sub-01_ses-1_task-rest_run-2_physio.json'), { Columns: ['wrong'] });
    json(join(root, 'sub-01', 'ses-1', 'eeg', 'sub-01_ses-1_task-rest_physio.json'), { StartTime: 99 });

    const found = findPhysioFiles(index(root), 'func/sub-01_ses-1_task-rest_run-1')!;
    expect(found.sidecar).toEqual({
      SamplingFrequency: 100,
      StartTime: -1,
      Columns: ['cardiac', 'trigger'],
      Manufacturer: 'subject',
      Level: 'session',
    });
    expect(found.sidecarPaths.map((p) => p.slice(root.length + 1))).toEqual([
      'task-rest_physio.json',
      'sub-01/sub-01_task-rest_physio.json',
      'sub-01/ses-1/sub-01_ses-1_task-rest_physio.json',
      'sub-01/ses-1/func/sub-01_ses-1_task-rest_physio.json',
      'sub-01/ses-1/func/sub-01_ses-1_task-rest_run-1_physio.json',
    ]);
  });

  it('keeps recording- sidecars to their own recording', () => {
    const root = dataset();
    const func = join(root, 'sub-01', 'func');
    write(join(func, 'sub-01_task-rest_recording-cardiac_physio.tsv.gz'));
    json(join(func, 'sub-01_task-rest_physio.json'), { StartTime: 0 });
    json(join(func, 'sub-01_task-rest_recording-cardiac_physio.json'), { SamplingFrequency: 1000 });
    json(join(func, 'sub-01_task-rest_recording-resp_physio.json'), { SamplingFrequency: 25 });
    expect(findPhysioFiles(index(root), 'func/sub-01_task-rest')?.sidecar).toEqual({ StartTime: 0, SamplingFrequency: 1000 });
  });

  it('applies a sidecar without entities (preproc_physio.json) to every physio file below it', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_physio.tsv.gz'));
    json(join(root, 'preproc_physio.json'), { SamplingFrequency: 50 });
    expect(findPhysioFiles(index(root), 'func/sub-01_task-rest')?.sidecar).toEqual({ SamplingFrequency: 50 });
  });

  it('never uses a sidecar from another dataset', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_physio.tsv.gz'));
    json(join(root, 'derivatives', 'prep', 'task-rest_physio.json'), { SamplingFrequency: 1 });
    expect(findPhysioFiles(index(root), 'func/sub-01_task-rest')?.sidecar).toBeNull();
  });
});

describe('confounds, BOLD timing and events matched by entities', () => {
  it('uses multi-echo BOLD sidecars and confounds for physio without echo-', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_physio.tsv.gz'));
    json(join(root, 'sub-01', 'func', 'sub-01_task-rest_echo-1_bold.json'), { RepetitionTime: 1.5 });
    json(join(root, 'sub-01', 'func', 'sub-01_task-rest_echo-2_bold.json'), { RepetitionTime: 9 });
    const der = join(root, 'derivatives', 'fmriprep', 'sub-01', 'func');
    write(join(der, 'sub-01_task-rest_echo-2_desc-confounds_timeseries.tsv'), confounds);
    write(join(der, 'sub-01_task-rest_echo-1_desc-confounds_timeseries.tsv'), confounds);
    const c = readConfounds(index(root), 'func/sub-01_task-rest')!;
    expect(c.filename).toBe('sub-01_task-rest_echo-1_desc-confounds_timeseries.tsv');
    expect(c.volumeTimes).toEqual([0, 1.5, 3]);
  });

  it('matches run-1 to run-01 but not run-10, and task-rest not to task-resting', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_run-1_physio.tsv.gz'));
    const der = join(root, 'derivatives', 'fmriprep', 'sub-01', 'func');
    write(join(der, 'sub-01_task-rest_run-10_desc-confounds_timeseries.tsv'), confounds);
    write(join(der, 'sub-01_task-resting_run-1_desc-confounds_timeseries.tsv'), confounds);
    expect(readConfounds(index(root), 'func/sub-01_task-rest_run-1')).toBeNull();
    write(join(der, 'sub-01_task-rest_run-01_desc-confounds_timeseries.tsv'), confounds);
    expect(readConfounds(index(root), 'func/sub-01_task-rest_run-1')?.filename).toBe(
      'sub-01_task-rest_run-01_desc-confounds_timeseries.tsv',
    );
  });

  it('matches on the physio file entities, so acq-mb and acq-sb each get their own confounds', () => {
    const root = dataset();
    const func = join(root, 'sub-01', 'func');
    write(join(func, 'sub-01_task-rest_acq-mb_physio.tsv.gz'));
    write(join(func, 'sub-01_task-rest_acq-sb_physio.tsv.gz'));
    const der = join(root, 'derivatives', 'fmriprep', 'sub-01', 'func');
    write(join(der, 'sub-01_task-rest_acq-mb_desc-confounds_timeseries.tsv'), confounds);
    write(join(der, 'sub-01_task-rest_acq-sb_desc-confounds_timeseries.tsv'), 'framewise_displacement\nn/a\n');
    const idx = index(root);
    expect(readConfounds(idx, 'func/sub-01_task-rest_acq-mb')?.numVolumes).toBe(3);
    expect(readConfounds(idx, 'func/sub-01_task-rest_acq-sb')?.numVolumes).toBe(1);
  });

  it('finds confounds in a derivatives folder wherever it sits inside the main folder', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'ses-1', 'func', 'sub-01_ses-1_task-rest_physio.tsv.gz'));
    const der = join(root, 'derivatives', 'nested', 'fmriprep-23', 'sub-01', 'ses-1', 'func');
    write(join(der, 'sub-01_ses-1_task-rest_desc-confounds_timeseries.tsv'), confounds);
    expect(readConfounds(index(root), 'func/sub-01_ses-1_task-rest')?.numVolumes).toBe(3);
  });

  it('reads events from raw datasets only; a run-less scan never takes a run file', () => {
    const root = dataset();
    const events = 'onset\tduration\n1\t2\n';
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_physio.tsv.gz'));
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_run-1_physio.tsv.gz'));
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_run-1_events.tsv'), events);
    write(join(root, 'derivatives', 'prep', 'sub-01', 'func', 'sub-01_task-rest_events.tsv'), events);
    const idx = index(root);
    expect(readEvents(idx, 'func/sub-01_task-rest_run-1')?.filename).toBe('sub-01_task-rest_run-1_events.tsv');
    expect(readEvents(idx, 'func/sub-01_task-rest')).toBeNull();
  });

  it('returns null for a scan id that is not in the index', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_physio.tsv.gz'));
    const idx = index(root);
    expect(readConfounds(idx, 'func/sub-02_task-rest')).toBeNull();
    expect(readEvents(idx, 'func/sub-02_task-rest')).toBeNull();
    expect(readPhysio(idx, 'func/sub-02_task-rest')).toBeNull();
  });
});

describe('physio outside func/ (EEG-fMRI)', () => {
  // BIDS: StartTime is relative to the first sample of the corresponding data, so
  // eeg/ physio is timed against the EEG recording and never against BOLD volumes
  const sidecar = { SamplingFrequency: 10, StartTime: 0, Columns: ['cardiac', 'trigger'] };
  /** 1 s at 10 Hz with a trigger pulse every 0.2 s (5 pulses) */
  const tsv = Array.from({ length: 10 }, (_, i) => `0.5\t${i % 2}`).join('\n') + '\n';
  const setup = () => {
    const root = dataset();
    for (const dt of ['func', 'eeg']) {
      write(join(root, 'sub-01', dt, `sub-01_task-rest_physio.tsv.gz`), gzipSync(tsv));
      json(join(root, 'sub-01', dt, 'sub-01_task-rest_physio.json'), sidecar);
      write(join(root, 'sub-01', dt, 'sub-01_task-rest_events.tsv'), `onset\tduration\n${dt === 'eeg' ? 7 : 3}\t1\n`);
    }
    json(join(root, 'sub-01', 'func', 'sub-01_task-rest_bold.json'), { RepetitionTime: 0.2 });
    write(join(root, 'derivatives', 'fmriprep', 'sub-01', 'func', 'sub-01_task-rest_desc-confounds_timeseries.tsv'), confounds);
    return index(root);
  };

  it('checks triggers against BOLD timing for func/ only', () => {
    const idx = setup();
    // func/: 5 pulses at the TR, checked against the 3 confounds volumes
    expect(readPhysio(idx, 'func/sub-01_task-rest')?.recordings[0].timing.detail).toMatch(/5 trigger pulses vs 3 volumes/);
    const eeg = readPhysio(idx, 'eeg/sub-01_task-rest')!.recordings[0];
    expect(eeg.datatype).toBe('eeg');
    expect(eeg.timing.status).toBe('unverified');
    expect(eeg.timing.detail).toMatch(/Physio in eeg\/: .*no trigger check/);
    expect(eeg.timing.triggerTimes).toHaveLength(5);
  });

  it('gives confounds to func/ physio only', () => {
    const idx = setup();
    expect(readConfounds(idx, 'func/sub-01_task-rest')?.numVolumes).toBe(3);
    expect(readConfounds(idx, 'eeg/sub-01_task-rest')).toBeNull();
  });

  it('takes events from the physio file datatype folder (or the top level), never from another', () => {
    const idx = setup();
    expect(readEvents(idx, 'func/sub-01_task-rest')?.onset).toEqual([3]);
    expect(readEvents(idx, 'eeg/sub-01_task-rest')?.onset).toEqual([7]);
  });
});

describe('datasets', () => {
  it('treats derivatives/<pipeline>/ as a derivative dataset, with or without a description', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_physio.tsv.gz'));
    write(join(root, 'derivatives', 'a', 'sub-01', 'func', 'sub-01_task-rest_desc-confounds_timeseries.tsv'), confounds);
    json(join(root, 'derivatives', 'b', 'dataset_description.json'), { Name: 'b', DatasetType: 'derivative' });
    const idx = index(root);
    const datasets = idx.datasets
      .map((d) => ({ root: d.root.slice(root.length), type: d.type, main: d.main }))
      .sort((a, b) => a.root.localeCompare(b.root));
    expect(datasets).toEqual([
      { root: '', type: 'raw', main: true },
      { root: '/derivatives/a', type: 'derivative', main: false },
      { root: '/derivatives/b', type: 'derivative', main: false },
    ]);
  });
});
