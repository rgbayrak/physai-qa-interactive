import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import {
  getSubjects,
  getTasks,
  getRuns,
  findPhysioFiles,
  readPhysio,
  readConfounds,
  readEvents,
  readPeaks,
  readDatasetInfo,
  buildScans,
  descriptionFolders,
} from '../bids-layout';
import { buildBidsIndex, indexSummaryLines } from '../bids-index';
import type { IndexRoots } from '../bids-index';

/**
 * Exact-value tests against the synthetic datasets in test/fixtures
 * (regenerate with `python3 test/fixtures/make_fixtures.py`).
 *
 * Fixture constants, mirrored from make_fixtures.py:
 *   50 Hz physio, TR 2 s, 10 volumes, StartTime -2 s  ->  1100 samples
 */

const FIXTURES = join(process.cwd(), 'test', 'fixtures');
const SES_ROOT = join(FIXTURES, 'bids-sessions');
const SES_DER = join(SES_ROOT, 'derivatives', 'fmriprep');
const NOSES_ROOT = join(FIXTURES, 'bids-nosessions');

const index = (bidsRoot: string, extra: Omit<IndexRoots, 'bidsRoot'> = {}) => buildBidsIndex({ bidsRoot, ...extra });
const SES = index(SES_ROOT);
const NOSES = index(NOSES_ROOT);

const FS = 50;
const TR = 2;
const N_VOLUMES = 10;
const N_SAMPLES = 1100;

describe('fixture: bids-sessions layout', () => {
  it('finds sub-01 and sub-02, and skips sub-03 whose physio is a broken symlink', () => {
    expect(getSubjects(SES)).toEqual([
      { id: '01', sessions: ['01', '02'] },
      { id: '02', sessions: ['01', '02'] },
    ]);
    expect(SES.stats.unreadablePhysio).toBe(1);
  });

  it('lists tasks and runs', () => {
    expect(getTasks(SES, '01', '01')).toEqual(['rest']);
    expect(getRuns(SES, '01', '01', 'rest')).toEqual(['01']);
  });

  it('builds one scan per subject/session in hierarchy order', () => {
    expect(buildScans(SES)).toEqual([
      { sub: '01', ses: '01', task: 'rest', run: '01' },
      { sub: '01', ses: '02', task: 'rest', run: '01' },
      { sub: '02', ses: '01', task: 'rest', run: '01' },
      { sub: '02', ses: '02', task: 'rest', run: '01' },
    ]);
  });

  it('uses the per-file sidecar and finds the run-level quality sidecar', () => {
    const found = findPhysioFiles(SES, '01', '01', 'rest', '01');
    expect(found?.sidecarPath).toBe(
      join(SES_ROOT, 'sub-01', 'ses-01', 'func', 'sub-01_ses-01_task-rest_run-01_physio.json'),
    );
    expect(found?.qualityJsonPath).toBe(
      join(SES_ROOT, 'sub-01', 'ses-01', 'func', 'sub-01_ses-01_task-rest_run-01_desc-quality.json'),
    );
  });

  it('finds the scan with an unpadded run label too', () => {
    expect(findPhysioFiles(SES, '01', '01', 'rest', '1')?.tsvGzName).toBe('sub-01_ses-01_task-rest_run-01_physio.tsv.gz');
  });

  it('reads dataset and derivatives metadata', () => {
    expect(readDatasetInfo(SES)).toEqual({
      name: 'Synthetic physio fixture (sessions)',
      bidsVersion: '1.9.0',
      datasetType: 'raw',
      license: 'CC0',
      authors: ['Fixture Author'],
      doi: 'doi:10.0000/fixture.sessions',
      derivatives: [{ name: 'fMRIPrep', version: '23.0.2' }],
      description: {
        file: join(SES_ROOT, 'dataset_description.json'),
        source: 'main',
        missingFields: [],
        mainMissing: null,
      },
    });
  });
});

describe('fixture: bids-sessions physio and timing', () => {
  const read = (sub: string, ses: string) => readPhysio(SES, sub, ses, 'rest', '01')!;

  it('reads all samples and columns', () => {
    const r = read('01', '01');
    expect(r.samplingFrequency).toBe(FS);
    expect(r.columns).toEqual(['cardiac', 'respiratory', 'trigger']);
    expect(r.numSamples).toBe(N_SAMPLES);
    expect(r.data.every((c) => c.length === N_SAMPLES)).toBe(true);
  });

  it('parses the quality sidecar', () => {
    expect(read('01', '01').quality).toEqual({
      cardiac: { assessment: 'Pass', percentValid: 1 },
      respiratory: { assessment: 'Pass', percentValid: 0.9 },
    });
  });

  it('sub-01 ses-01: clean triggers at t = 0 -> verified, StartTime unchanged', () => {
    const r = read('01', '01');
    expect(r.timing.status).toBe('verified');
    expect(r.timing.offset).toBe(0);
    expect(r.startTime).toBe(-2);
    expect(r.timing.triggerTimes).toHaveLength(N_VOLUMES);
    expect(r.timing.triggerTimes[0]).toBeCloseTo(0, 9);
  });

  it('sub-01 ses-02: clean triggers 0.5 s late -> corrected, axis shifted by 0.5 s', () => {
    const r = read('01', '02');
    expect(r.timing.status).toBe('corrected');
    expect(r.timing.offset).toBeCloseTo(0.5, 9);
    expect(r.startTime).toBeCloseTo(-2.5, 9);
    expect(r.timing.triggerTimes[0]).toBeCloseTo(0, 9);
  });

  it('sub-02 ses-01: one dropped pulse -> mismatch, StartTime kept', () => {
    const r = read('02', '01');
    expect(r.timing.status).toBe('mismatch');
    expect(r.timing.offset).toBe(0);
    expect(r.startTime).toBe(-2);
    expect(r.timing.triggerTimes).toHaveLength(N_VOLUMES - 1);
    expect(r.timing.detail).toContain('1 trigger interval(s) differ from TR 2 s');
  });

  it('sub-02 ses-02: no trigger channel -> unverified', () => {
    const r = read('02', '02');
    expect(r.columns).toEqual(['cardiac', 'respiratory']);
    expect(r.timing.status).toBe('unverified');
    expect(r.timing.triggerTimes).toEqual([]);
  });
});

describe('fixture: bids-sessions confounds', () => {
  it('extracts only motion columns, in dropdown order, with n/a as NaN', () => {
    const c = readConfounds(SES, '01', '01', 'rest', '01')!;
    expect(c.filename).toBe('sub-01_ses-01_task-rest_run-01_desc-confounds_timeseries.tsv');
    expect(c.numVolumes).toBe(N_VOLUMES);
    expect(Object.keys(c.columns)).toEqual(['framewise_displacement', 'trans_x', 'rot_x']);
    expect(c.columns.framewise_displacement[0]).toBeNaN();
    expect(c.columns.framewise_displacement[1]).toBeCloseTo(0.05, 9);
  });

  it('places volumes at i * RepetitionTime from the raw BOLD sidecar', () => {
    const c = readConfounds(SES, '01', '01', 'rest', '01')!;
    expect(c.volumeTimes).toEqual(Array.from({ length: N_VOLUMES }, (_, i) => i * TR));
  });

  it('matches run-01 to unpadded run-1 derivatives and uses their VolumeTiming', () => {
    const c = readConfounds(SES, '02', '01', 'rest', '01')!;
    expect(c.filename).toBe('sub-02_ses-01_task-rest_run-1_desc-confounds_timeseries.tsv');
    expect(c.volumeTimes).toEqual(Array.from({ length: N_VOLUMES }, (_, i) => i * TR));
  });

  it('reads MRIQC *_timeseries.tsv, using the lowest echo of a multi-echo run', () => {
    const c = readConfounds(NOSES, '01', '', 'motor', '')!;
    expect(c.filename).toBe('sub-01_task-motor_echo-1_timeseries.tsv');
    expect(Object.keys(c.columns)).toEqual(['framewise_displacement', 'dvars', 'trans_x', 'rot_x']);
    expect(c.columns.framewise_displacement[0]).toBeNaN();
    expect(c.columns.framewise_displacement[1]).toBeCloseTo(0.05, 9);
    // TR from the top-level task-motor_bold.json
    expect(c.volumeTimes).toEqual(Array.from({ length: N_VOLUMES }, (_, i) => i * TR));
  });

  it('returns null for a scan without confounds', () => {
    expect(readConfounds(NOSES, '02', '', 'motor', '')).toBeNull();
  });
});

describe('fixture: events', () => {
  it('reads onsets, durations and the other columns as text', () => {
    const e = readEvents(NOSES, '01', '', 'motor', '')!;
    expect(e.filename).toBe('sub-01_task-motor_events.tsv');
    // the row without an onset is dropped; an n/a duration counts as 0
    expect(e.onset).toEqual([0, 6, 12]);
    expect(e.duration).toEqual([4, 4, 0]);
    expect(e.columns).toEqual({
      trial_type: ['left', 'right', 'left'],
      response_time: ['0.52', 'n/a', '0.61'],
    });
  });

  it('uses the run-less events file for every run (BIDS inheritance)', () => {
    for (const run of ['1', '02']) {
      expect(readEvents(NOSES, '01', '', 'motor', run)?.filename).toBe('sub-01_task-motor_events.tsv');
    }
  });

  it('returns null when the scan has no events file', () => {
    expect(readEvents(NOSES, '02', '', 'motor', '')).toBeNull();
    expect(readEvents(SES, '01', '01', 'rest', '01')).toBeNull();
  });
});

describe('physio stored outside the main BIDS folder', () => {
  // main/: dataset_description.json, task-motor_bold.json, events (no physio)
  // phys/: the physio files and sidecars only
  let dir: string;
  let main: string;
  let phys: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bids-physio-root-'));
    main = join(dir, 'main');
    phys = join(dir, 'phys');
    const copy = (rel: string, to: string) => {
      mkdirSync(dirname(join(to, rel)), { recursive: true });
      cpSync(join(NOSES_ROOT, rel), join(to, rel));
    };
    for (const rel of ['dataset_description.json', 'task-motor_bold.json', 'sub-01/func/sub-01_task-motor_events.tsv']) {
      copy(rel, main);
    }
    for (const rel of [
      'task-motor_physio.json',
      'sub-01/sub-01_task-motor_physio.json',
      'sub-01/func/sub-01_task-motor_physio.tsv.gz',
      'sub-02/func/sub-02_task-motor_physio.tsv.gz',
    ]) {
      copy(rel, phys);
    }
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('walks the main folder, then the physio folder', () => {
    expect(index(main, { physioRoot: phys }).walked).toEqual([main, phys]);
  });

  it('does not search outside the main folder for physio', () => {
    // phys/ is a sibling of main/: without BIDSPHYS_ROOT it is not walked
    const idx = index(main);
    expect(idx.walked).toEqual([main]);
    expect(getSubjects(idx)).toEqual([]);
  });

  it('finds the same scans in the physio folder', () => {
    expect(buildScans(index(main, { physioRoot: phys }))).toEqual(buildScans(NOSES));
  });

  it('reads BOLD timing and events from the main folder', () => {
    const idx = index(main, { physioRoot: phys });
    expect(readPhysio(idx, '01', '', 'motor', '')!.timing.status).toBe('verified'); // TR from main/task-motor_bold.json
    expect(readEvents(idx, '01', '', 'motor', '')?.filename).toBe('sub-01_task-motor_events.tsv');
    expect(readDatasetInfo(idx).name).toBe('Synthetic physio fixture (no sessions)');
    expect(readConfounds(idx, '01', '', 'motor', '')).toBeNull(); // no derivatives anywhere
  });

  it("prefers the main folder's BOLD sidecars over the physio folder's", () => {
    writeFileSync(join(phys, 'task-motor_bold.json'), JSON.stringify({ RepetitionTime: 3 }));
    // main has TR 2, which the triggers match
    expect(readPhysio(index(main, { physioRoot: phys }), '01', '', 'motor', '')!.timing.status).toBe('verified');
    // without main's sidecar, the physio folder's TR 3 is used, and the triggers do not match it
    const empty = join(dir, 'empty');
    mkdirSync(empty, { recursive: true });
    expect(readPhysio(index(empty, { physioRoot: phys }), '01', '', 'motor', '')!.timing.status).toBe('mismatch');
    rmSync(join(phys, 'task-motor_bold.json'));
  });
});

describe('index: found by content, not folder names', () => {
  // Empty files are enough: files are indexed from their names only
  let dir: string;
  const touch = (path: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
  };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bids-roots-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('notes a folder that does not exist instead of crashing, and finds no subjects in it', () => {
    const gone = join(dir, 'no-such-folder');
    const idx = index(gone, { physioRoot: join(gone, 'phys'), derivRoot: join(gone, 'der') });
    expect(idx.notes).toEqual([
      expect.stringContaining(`BIDS_ROOT ${gone} does not exist`),
      expect.stringContaining(`BIDSPHYS_ROOT ${join(gone, 'phys')} does not exist`),
      expect.stringContaining(`BIDSDER_ROOT ${join(gone, 'der')} does not exist`),
    ]);
    expect(idx.walked).toEqual([]);
    expect(getSubjects(idx)).toEqual([]);
  });

  it('finds the derivatives with confounds in plain BIDS', () => {
    expect(descriptionFolders(SES).derivatives).toBe(SES_DER);
    // MRIQC timeseries count as confounds too, whatever the folder is called
    expect(descriptionFolders(NOSES).derivatives).toBe(join(NOSES_ROOT, 'derivatives', 'mriqc'));
  });

  it('finds physio in any folder inside the main folder, or inside its derivatives/', () => {
    const main = join(dir, 'a');
    touch(join(main, 'sub-01', 'ses-1', 'func', 'sub-01_ses-1_task-x_bold.json'));
    touch(join(main, 'recordings-v2', 'sub-01', 'ses-1', 'func', 'sub-01_ses-1_task-x_physio.tsv.gz'));
    expect(findPhysioFiles(index(main), '01', '1', 'x', '')?.tsvGzPath).toBe(
      join(main, 'recordings-v2', 'sub-01', 'ses-1', 'func', 'sub-01_ses-1_task-x_physio.tsv.gz'),
    );

    const main2 = join(dir, 'b');
    touch(join(main2, 'sub-01', 'func', 'sub-01_task-x_bold.json'));
    const clean = join(main2, 'derivatives', 'cleaned', 'sub-01', 'func', 'sub-01_task-x_desc-clean_physio.tsv.gz');
    touch(clean);
    const found = findPhysioFiles(index(main2), '01', '', 'x', '');
    expect(found?.tsvGzPath).toBe(clean);
    expect(found?.file.dataset).toMatchObject({ root: join(main2, 'derivatives', 'cleaned'), type: 'derivative' });
  });

  it('prefers fMRIPrep confounds over MRIQC timeseries, then path order', () => {
    const main = join(dir, 'c');
    touch(join(main, 'sub-01', 'func', 'sub-01_task-x_physio.tsv.gz'));
    touch(join(main, 'derivatives', 'aaa-qc', 'sub-01', 'func', 'sub-01_task-x_timeseries.tsv'));
    touch(join(main, 'derivatives', 'zzz-prep', 'sub-01', 'func', 'sub-01_task-x_desc-confounds_timeseries.tsv'));
    expect(descriptionFolders(index(main)).derivatives).toBe(join(main, 'derivatives', 'zzz-prep'));
  });

  it('loads one physio file when two folders have the same scan, and says so', () => {
    const main = join(dir, 'd');
    touch(join(main, 'sub-01', 'func', 'sub-01_task-x_bold.json'));
    touch(join(main, 'two', 'sub-01', 'func', 'sub-01_task-x_physio.tsv.gz'));
    touch(join(main, 'one', 'sub-01', 'func', 'sub-01_task-x_physio.tsv.gz'));
    const idx = index(main);
    expect(findPhysioFiles(idx, '01', '', 'x', '')?.tsvGzPath).toBe(join(main, 'one', 'sub-01', 'func', 'sub-01_task-x_physio.tsv.gz'));
    expect(idx.duplicates.map((d) => d.others.map((o) => o.path))).toEqual([
      [join(main, 'two', 'sub-01', 'func', 'sub-01_task-x_physio.tsv.gz')],
    ]);
    expect(indexSummaryLines(idx).join('\n')).toContain('same scan not loaded yet: two/sub-01/func/sub-01_task-x_physio.tsv.gz');
  });
});

describe('fixture: peaks (trial)', () => {
  it('keeps peak rows with a channel, flagging the corrected ones', () => {
    expect(readPeaks(SES, '01', '02', 'rest', '01')).toEqual({
      filename: 'sub-01_ses-02_task-rest_run-01_events.tsv',
      time: [0.694, 0.694, 1.046, 1.171, 1.171],
      channel: ['ECG', 'ECG', 'ECG', 'PPG', 'PPG'],
      corrected: [false, true, false, false, true],
    });
  });

  it('returns null for events without peaks or without a channel column', () => {
    expect(readPeaks(NOSES, '01', '', 'motor', '')).toBeNull(); // task events only
    expect(readPeaks(SES, '01', '01', 'rest', '01')).toBeNull(); // no events file
  });
});

describe('fixture: bids-nosessions', () => {
  it('reports session-less subjects as sessions [""] and scans with no run', () => {
    expect(getSubjects(NOSES)).toEqual([
      { id: '01', sessions: [''] },
      { id: '02', sessions: [''] },
    ]);
    expect(buildScans(NOSES)).toEqual([
      { sub: '01', ses: '', task: 'motor', run: '' },
      { sub: '02', ses: '', task: 'motor', run: '' },
    ]);
  });

  it('sub-01: subject-level sidecar over the top-level one, and run-less quality sidecar', () => {
    const found = findPhysioFiles(NOSES, '01', '', 'motor', '');
    expect(found?.sidecarPaths).toEqual([
      join(NOSES_ROOT, 'task-motor_physio.json'),
      join(NOSES_ROOT, 'sub-01', 'sub-01_task-motor_physio.json'),
    ]);
    expect(found?.sidecarPath).toBe(join(NOSES_ROOT, 'sub-01', 'sub-01_task-motor_physio.json'));
    expect(found?.sidecar?.Columns).toEqual(['cardiac', 'respiratory', 'trigger']); // the nearest wins
    expect(found?.qualityJsonPath).toBe(join(NOSES_ROOT, 'sub-01', 'func', 'sub-01_task-motor_desc-quality.json'));
  });

  it('sub-01: skips the TSV header row and verifies triggers against top-level task-motor_bold.json', () => {
    const r = readPhysio(NOSES, '01', '', 'motor', '')!;
    expect(r.numSamples).toBe(N_SAMPLES);
    expect(r.data[0].every((v) => Number.isFinite(v))).toBe(true);
    expect(r.timing.status).toBe('verified');
  });

  it('sub-02: inherits the top-level task-motor_physio.json', () => {
    const found = findPhysioFiles(NOSES, '02', '', 'motor', '');
    expect(found?.sidecarPath).toBe(join(NOSES_ROOT, 'task-motor_physio.json'));
    const r = readPhysio(NOSES, '02', '', 'motor', '')!;
    expect(r.columns).toEqual(['cardiac', 'respiratory']);
    expect(r.timing.status).toBe('unverified');
  });

  it('reads dataset metadata with missing fields as null', () => {
    expect(readDatasetInfo(NOSES)).toEqual({
      name: 'Synthetic physio fixture (no sessions)',
      bidsVersion: '1.9.0',
      datasetType: null,
      license: null,
      authors: [],
      doi: null,
      derivatives: [],
      description: {
        file: join(NOSES_ROOT, 'dataset_description.json'),
        source: 'main',
        missingFields: ['Authors'], // the fixture lists no authors
        mainMissing: null,
      },
    });
  });
});

describe('readDatasetInfo: missing or placeholder dataset description', () => {
  let dir: string;
  const write = (path: string, content: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  const desc = (o: object) => JSON.stringify(o);
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bids-description-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('drops placeholder titles and authors and lists them as missing', () => {
    const main = join(dir, 'placeholder');
    write(join(main, 'dataset_description.json'), desc({ Name: 'n/a', Authors: ['Unknown', '[Author 1]', '', 'Ada'] }));
    const info = readDatasetInfo(index(main));
    expect(info.name).toBeNull();
    expect(info.authors).toEqual(['Ada']); // a real one-word name is kept
    expect(info.description).toMatchObject({ source: 'main', missingFields: ['Name'], mainMissing: null });
  });

  it('falls back to the physio folder, then the derivatives, for the title and authors', () => {
    const main = join(dir, 'fallback', 'main');
    const phys = join(dir, 'fallback', 'phys');
    const der = join(dir, 'fallback', 'der');
    write(join(der, 'dataset_description.json'), desc({ Name: 'Pipeline output', DatasetType: 'derivative' }));
    const idx = index(main, { physioRoot: phys, derivRoot: der });
    expect(readDatasetInfo(idx)).toMatchObject({
      name: 'Pipeline output',
      license: null, // other fields never come from a fallback
      description: { source: 'derivatives', file: join(der, 'dataset_description.json') },
    });
    write(join(phys, 'dataset_description.json'), desc({ Name: 'Physio outputs', Authors: ['Lab'], License: 'CC0' }));
    const info = readDatasetInfo(idx);
    expect(info).toMatchObject({ name: 'Physio outputs', authors: ['Lab'], license: null });
    expect(info.description).toMatchObject({
      source: 'physio',
      mainMissing: { path: join(main, 'dataset_description.json'), url: null, command: null },
    });
  });

  it('links to the main dataset from the DataLad parent .gitmodules', () => {
    const ds = join(dir, 'superds');
    write(
      join(ds, '.gitmodules'),
      '[submodule "physprep"]\n\tpath = physprep\n\turl = https://example.org/physprep.git\n' +
        '[submodule "data"]\n\tpath = data\n\turl = ./data\n\tdatalad-url = https://example.org/main.git\n',
    );
    const m = readDatasetInfo(index(join(ds, 'data'), { derivRoot: join(ds, 'der') })).description.mainMissing!;
    expect(m.url).toBe('https://example.org/main.git'); // datalad-url wins over a relative url
    expect(m.command).toBe(`cd ${ds} && datalad get -n data && datalad get data/dataset_description.json`);
  });

  it('links to SourceDatasets (URL or DOI) and ignores links that are not web links', () => {
    const main = join(dir, 'source', 'main');
    const phys = join(dir, 'source', 'phys');
    write(
      join(phys, 'dataset_description.json'),
      desc({ Name: 'Physio', SourceDatasets: [{ URL: 'bids::' }, { URL: '../raw' }, { DOI: 'doi:10.1234/abcd' }] }),
    );
    expect(readDatasetInfo(index(main, { physioRoot: phys })).description.mainMissing?.url).toBe(
      'https://doi.org/10.1234/abcd',
    );
  });

  it('reports no description at all', () => {
    const info = readDatasetInfo(index(join(dir, 'empty'), { derivRoot: join(dir, 'empty-der') }));
    expect(info.name).toBeNull();
    expect(info.description).toMatchObject({ file: null, source: 'none', missingFields: ['Name', 'Authors'] });
  });
});
