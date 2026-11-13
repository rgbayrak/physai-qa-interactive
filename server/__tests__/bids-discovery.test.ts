import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { buildScans, findPhysioFiles, getRuns, getSubjects, readConfounds, readEvents } from '../bids-layout';
import { buildBidsIndex, entitiesMatch, indexSummaryLines, nameEntities } from '../bids-index';

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
const write = (path: string, content = '') => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
const json = (path: string, obj: object) => write(path, JSON.stringify(obj));
const index = (bidsRoot: string) => buildBidsIndex({ bidsRoot });
/** Three volumes of framewise displacement */
const confounds = 'framewise_displacement\nn/a\n0.1\n0.2\n';

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
      { sub: '01', ses: '', task: 'rest', run: '' },
      { sub: '02', ses: '', task: 'oddball', run: '' },
      { sub: '03', ses: '', task: 'game', run: '' },
    ]);
    expect(idx.stats.physioByDatatype).toEqual({ beh: 1, eeg: 1, func: 1 });
    expect(findPhysioFiles(idx, '02', '', 'oddball', '')?.file.datatype).toBe('eeg');
  });

  it('counts physio without a task (e.g. anat/) and logs it, without making a scan of it yet', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_physio.tsv.gz'));
    write(join(root, 'sub-01', 'anat', 'sub-01_acq-mprage_physio.tsv.gz'));
    const idx = index(root);
    expect(buildScans(idx)).toHaveLength(1);
    expect(idx.stats.physioByDatatype).toEqual({ anat: 1, func: 1 });
    expect(idx.unkeyed.map((f) => f.name)).toEqual(['sub-01_acq-mprage_physio.tsv.gz']);
    expect(indexSummaryLines(idx).join('\n')).toContain('1 physio files without sub- or task- not loaded');
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
    expect(buildScans(index(root))).toEqual([{ sub: '01', ses: '', task: 'rest', run: '' }]);
  });

  it('lists run-less and run scans of one task, with runs compared as numbers', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'func', 'sub-01_task-a_physio.tsv.gz'));
    write(join(root, 'sub-01', 'func', 'sub-01_task-a_run-1_physio.tsv.gz'));
    write(join(root, 'sub-01', 'func', 'sub-01_task-a_run-10_physio.tsv.gz'));
    write(join(root, 'sub-01', 'func', 'sub-01_task-a_run-2_physio.tsv.gz'));
    const idx = index(root);
    expect(buildScans(idx).map((s) => s.run)).toEqual(['', '1', '2', '10']);
    expect(getRuns(idx, '01', '', 'a')).toEqual(['1', '2', '10']);
    expect(findPhysioFiles(idx, '01', '', 'a', '01')?.tsvGzName).toBe('sub-01_task-a_run-1_physio.tsv.gz');
    expect(findPhysioFiles(idx, '01', '', 'a', '')?.tsvGzName).toBe('sub-01_task-a_physio.tsv.gz');
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
    expect(findPhysioFiles(idx, '01', '', 'rest', '')?.tsvGzName).toBe('sub-01_task-rest_physio.tsv.gz');
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

describe('one physio file per scan (Step 1)', () => {
  it('the func/ file when the same run also has physio in eeg/ (EEG-fMRI), the other logged', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'eeg', 'sub-01_task-rest_physio.tsv.gz'));
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_physio.tsv.gz'));
    const idx = index(root);
    expect(findPhysioFiles(idx, '01', '', 'rest', '')?.file.datatype).toBe('func');
    expect(idx.duplicates[0].others.map((f) => f.datatype)).toEqual(['eeg']);
  });

  it('desc-preproc over the raw file, then name order for recording- files, the others logged', () => {
    const root = dataset();
    const func = join(root, 'sub-01', 'func');
    write(join(func, 'sub-01_task-rest_physio.tsv.gz'));
    write(join(func, 'sub-01_task-rest_desc-preproc_physio.tsv.gz'));
    write(join(func, 'sub-01_task-b_recording-resp_physio.tsv.gz'));
    write(join(func, 'sub-01_task-b_recording-cardiac_physio.tsv.gz'));
    const idx = index(root);
    expect(findPhysioFiles(idx, '01', '', 'rest', '')?.tsvGzName).toBe('sub-01_task-rest_desc-preproc_physio.tsv.gz');
    expect(findPhysioFiles(idx, '01', '', 'b', '')?.tsvGzName).toBe('sub-01_task-b_recording-cardiac_physio.tsv.gz');
    const log = indexSummaryLines(idx).join('\n');
    expect(log).toContain('sub-01/func/sub-01_task-b_recording-cardiac_physio.tsv.gz loaded; same scan not loaded yet: sub-01/func/sub-01_task-b_recording-resp_physio.tsv.gz');
    expect(log).toContain('not loaded yet: sub-01/func/sub-01_task-rest_physio.tsv.gz');
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

    const found = findPhysioFiles(index(root), '01', '1', 'rest', '1')!;
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
    expect(findPhysioFiles(index(root), '01', '', 'rest', '')?.sidecar).toEqual({ StartTime: 0, SamplingFrequency: 1000 });
  });

  it('applies a sidecar without entities (preproc_physio.json) to every physio file below it', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_physio.tsv.gz'));
    json(join(root, 'preproc_physio.json'), { SamplingFrequency: 50 });
    expect(findPhysioFiles(index(root), '01', '', 'rest', '')?.sidecar).toEqual({ SamplingFrequency: 50 });
  });

  it('never uses a sidecar from another dataset', () => {
    const root = dataset();
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_physio.tsv.gz'));
    json(join(root, 'derivatives', 'prep', 'task-rest_physio.json'), { SamplingFrequency: 1 });
    expect(findPhysioFiles(index(root), '01', '', 'rest', '')?.sidecar).toBeNull();
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
    const c = readConfounds(index(root), '01', '', 'rest', '')!;
    expect(c.filename).toBe('sub-01_task-rest_echo-1_desc-confounds_timeseries.tsv');
    expect(c.volumeTimes).toEqual([0, 1.5, 3]);
  });

  it('matches run-1 to run-01 but not run-10, and task-rest not to task-resting', () => {
    const root = dataset();
    const der = join(root, 'derivatives', 'fmriprep', 'sub-01', 'func');
    write(join(der, 'sub-01_task-rest_run-10_desc-confounds_timeseries.tsv'), confounds);
    write(join(der, 'sub-01_task-resting_run-1_desc-confounds_timeseries.tsv'), confounds);
    const idx = index(root);
    expect(readConfounds(idx, '01', '', 'rest', '1')).toBeNull();
    write(join(der, 'sub-01_task-rest_run-01_desc-confounds_timeseries.tsv'), confounds);
    expect(readConfounds(index(root), '01', '', 'rest', '1')?.filename).toBe(
      'sub-01_task-rest_run-01_desc-confounds_timeseries.tsv',
    );
  });

  it('finds confounds in a derivatives folder wherever it sits inside the main folder', () => {
    const root = dataset();
    const der = join(root, 'derivatives', 'nested', 'fmriprep-23', 'sub-01', 'ses-1', 'func');
    write(join(der, 'sub-01_ses-1_task-rest_desc-confounds_timeseries.tsv'), confounds);
    expect(readConfounds(index(root), '01', '1', 'rest', '')?.numVolumes).toBe(3);
  });

  it('reads events from raw datasets only; a run-less scan never takes a run file', () => {
    const root = dataset();
    const events = 'onset\tduration\n1\t2\n';
    write(join(root, 'sub-01', 'func', 'sub-01_task-rest_run-1_events.tsv'), events);
    write(join(root, 'derivatives', 'prep', 'sub-01', 'func', 'sub-01_task-rest_events.tsv'), events);
    const idx = index(root);
    expect(readEvents(idx, '01', '', 'rest', '1')?.filename).toBe('sub-01_task-rest_run-1_events.tsv');
    expect(readEvents(idx, '01', '', 'rest', '')).toBeNull();
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
