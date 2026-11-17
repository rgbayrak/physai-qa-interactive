import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'fs';
import { gzipSync } from 'zlib';
import { tmpdir } from 'os';
import { join } from 'path';
import { countPhysioFiles, listPhysioPaths, parseAnnexMissing } from '../availability';
import { buildBidsIndex, indexSummaryLines } from '../bids-index';
import { buildScans, readPhysio, readScanRecordings } from '../bids-layout';
import { appendQualityRun } from '../quality-run-log';
import { parseLastRun } from '../../src/quality/run-log';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'physio-availability-'));
  // downloaded: real gzip content
  mkdirSync(join(dir, 'sub-01', 'func'), { recursive: true });
  writeFileSync(join(dir, 'sub-01', 'func', 'sub-01_task-rest_physio.tsv.gz'), gzipSync('1\t2\n'));
  // not downloaded, unlocked mode: a readable git-annex pointer file
  mkdirSync(join(dir, 'sub-02', 'ses-01', 'func'), { recursive: true });
  writeFileSync(
    join(dir, 'sub-02', 'ses-01', 'func', 'sub-02_ses-01_task-rest_physio.tsv.gz'),
    '/annex/objects/SHA256E-s123--abc.tsv.gz\n',
  );
  // not downloaded, locked mode: a dangling symlink
  mkdirSync(join(dir, 'sub-03', 'func'), { recursive: true });
  symlinkSync('../../.git/annex/objects/not-fetched', join(dir, 'sub-03', 'func', 'sub-03_task-rest_physio.tsv.gz'));
  // not physio: ignored
  writeFileSync(join(dir, 'sub-01', 'func', 'sub-01_task-rest_events.tsv'), 'onset\n');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('physio file count', () => {
  it('lists every physio file, downloaded or not, with and without sessions', () => {
    expect(listPhysioPaths(buildBidsIndex({ bidsRoot: dir }))).toEqual(
      [
        'sub-01/func/sub-01_task-rest_physio.tsv.gz',
        'sub-02/ses-01/func/sub-02_ses-01_task-rest_physio.tsv.gz',
        'sub-03/func/sub-03_task-rest_physio.tsv.gz',
      ].map((path) => ({ root: dir, path })),
    );
  });

  it('counts only files with gzip content as downloaded when git-annex is not used', () => {
    expect(countPhysioFiles(buildBidsIndex({ bidsRoot: dir }), false)).toEqual({
      onDisk: 3,
      downloaded: 1,
      source: 'files on disk',
    });
  });

  it('counts physio in an extra folder too', () => {
    const extra = mkdtempSync(join(tmpdir(), 'physio-availability-extra-'));
    mkdirSync(join(extra, 'sub-04', 'beh'), { recursive: true });
    writeFileSync(join(extra, 'sub-04', 'beh', 'sub-04_task-rest_physio.tsv.gz'), gzipSync('1\t2\n'));
    expect(countPhysioFiles(buildBidsIndex({ bidsRoot: dir, physioRoot: extra }), false)).toEqual({
      onDisk: 4,
      downloaded: 2,
      source: 'files on disk',
    });
    rmSync(extra, { recursive: true, force: true });
  });

  it('is zero for a folder without physio files', () => {
    expect(countPhysioFiles(buildBidsIndex({ bidsRoot: join(dir, 'missing') }), false)).toEqual({
      onDisk: 0,
      downloaded: 0,
      source: 'files on disk',
    });
  });

  it('reads the paths git-annex reports as missing', () => {
    const out = 'sub-02/ses-01/func/sub-02_ses-01_task-rest_physio.tsv.gz\nsub-03/func/sub-03_task-rest_physio.tsv.gz\n\n';
    expect([...parseAnnexMissing(out)]).toEqual([
      'sub-02/ses-01/func/sub-02_ses-01_task-rest_physio.tsv.gz',
      'sub-03/func/sub-03_task-rest_physio.tsv.gz',
    ]);
  });
});

describe('physio files not downloaded never become scans', () => {
  it('keeps only files with content: no dangling symlink, annex pointer or empty file (same as the count)', () => {
    const idx = buildBidsIndex({ bidsRoot: dir });
    expect(buildScans(idx).map((s) => s.id)).toEqual(['func/sub-01_task-rest']);
    expect(countPhysioFiles(idx, false).downloaded).toBe(1);
  });

  it('says per folder setting how many physio files are not downloaded, leaving out a setting with none missing', () => {
    const extra = mkdtempSync(join(tmpdir(), 'physio-availability-phys-'));
    mkdirSync(join(extra, 'sub-01', 'func'), { recursive: true });
    writeFileSync(join(extra, 'sub-01', 'func', 'sub-01_task-rest_desc-preproc_physio.tsv.gz'), '/annex/objects/x\n');
    const lines = indexSummaryLines(buildBidsIndex({ bidsRoot: dir, physioRoot: extra }));
    // "other" when some of the setting's files are downloaded (BIDS_ROOT: 1 of 3), none when all are missing
    expect(lines.filter((l) => l.includes('not downloaded'))).toEqual([
      'in BIDS_ROOT = 2 other physio files listed but not downloaded (skipped)',
      'in BIDSPHYS_ROOT = 1 physio files listed but not downloaded (skipped)',
    ]);
    // BIDSPHYS_ROOT inside BIDS_ROOT: its files count for BIDSPHYS_ROOT
    const inside = indexSummaryLines(buildBidsIndex({ bidsRoot: dir, physioRoot: join(dir, 'sub-02') }));
    expect(inside.filter((l) => l.includes('not downloaded'))).toEqual([
      'in BIDS_ROOT = 1 other physio files listed but not downloaded (skipped)',
      'in BIDSPHYS_ROOT = 1 physio files listed but not downloaded (skipped)',
    ]);
    const one = indexSummaryLines(buildBidsIndex({ bidsRoot: join(dir, 'sub-01') }));
    expect(one.some((l) => l.includes('not downloaded'))).toBe(false);
    rmSync(extra, { recursive: true, force: true });
  });

  it('reads an uncompressed *_physio.tsv (outside BIDS), but not as an annex pointer or empty', () => {
    const root = mkdtempSync(join(tmpdir(), 'physio-plain-tsv-'));
    const put = (rel: string, content: string) => {
      mkdirSync(join(root, rel, '..'), { recursive: true });
      writeFileSync(join(root, rel), content);
    };
    put('task-rest_physio.json', JSON.stringify({ SamplingFrequency: 2, StartTime: 0, Columns: ['cardiac'] }));
    put('sub-01/func/sub-01_task-rest_physio.tsv', '1\n2\n3\n');
    put('sub-02/func/sub-02_task-rest_physio.tsv', '/annex/objects/SHA256E-s6--abc.tsv\n');
    put('sub-03/func/sub-03_task-rest_physio.tsv', '');
    const idx = buildBidsIndex({ bidsRoot: root });
    expect(buildScans(idx).map((s) => s.id)).toEqual(['func/sub-01_task-rest']);
    expect(readPhysio(idx, 'func/sub-01_task-rest')!.recordings[0].numSamples).toBe(3);
    rmSync(root, { recursive: true, force: true });
  });

  it('skips a recording it cannot read, with the reason, and opens the scan with the others', () => {
    const root = mkdtempSync(join(tmpdir(), 'physio-corrupt-'));
    const put = (rel: string, content: string | Buffer) => {
      mkdirSync(join(root, rel, '..'), { recursive: true });
      writeFileSync(join(root, rel), content);
    };
    const sidecar = JSON.stringify({ SamplingFrequency: 2, StartTime: 0, Columns: ['cardiac'] });
    put('task-rest_recording-cardiac_physio.json', sidecar);
    put('task-rest_recording-resp_physio.json', sidecar.replace('cardiac', 'respiratory'));
    put('sub-01/func/sub-01_task-rest_recording-cardiac_physio.tsv.gz', gzipSync('1\n2\n'));
    // gzip magic bytes, then not gzip: passes the start-up check, fails to unzip
    put('sub-01/func/sub-01_task-rest_recording-resp_physio.tsv.gz', Buffer.from([0x1f, 0x8b, 0, 1, 2, 3]));
    const idx = buildBidsIndex({ bidsRoot: root });
    const { recordings, skipped } = readScanRecordings(idx, 'func/sub-01_task-rest')!;
    expect(recordings.map((r) => r.recording)).toEqual(['cardiac']);
    expect(skipped).toEqual([
      { filename: 'sub-01_task-rest_recording-resp_physio.tsv.gz', reason: expect.stringMatching(/could not read the gzip file .*datalad get/) },
    ]);
    // Nothing readable: readPhysio gives null, readScanRecordings says why
    rmSync(join(root, 'sub-01/func/sub-01_task-rest_recording-cardiac_physio.tsv.gz'));
    writeFileSync(join(root, 'sub-01/func/sub-01_task-rest_recording-cardiac_physio.tsv.gz'), Buffer.from([0x1f, 0x8b, 9]));
    expect(readPhysio(idx, 'func/sub-01_task-rest')).toBeNull();
    expect(readScanRecordings(idx, 'func/sub-01_task-rest')!.skipped).toHaveLength(2);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('quality metrics run log', () => {
  it('writes the header once, then one line per run', () => {
    const out = join(dir, 'quality', 'ds-test');
    const run = { runDate: '2026-11-05T15:40:12', scansComputed: 78, scansAvailable: 120, scansFailed: 2, countSource: 'git-annex' };
    appendQualityRun(out, run);
    const path = appendQualityRun(out, { ...run, runDate: '2026-11-06T09:12:40', scansComputed: 118 });
    const lines = readFileSync(path, 'utf-8').trim().split('\n');
    expect(lines).toEqual([
      // max_scans: n/a for a full run (--max-scans not given)
      'run_date\tscans_computed\tscans_available\tscans_failed\tcount_source\tmax_scans',
      '2026-11-05T15:40:12\t78\t120\t2\tgit-annex\tn/a',
      '2026-11-06T09:12:40\t118\t120\t2\tgit-annex\tn/a',
    ]);
    expect(parseLastRun(readFileSync(path, 'utf-8'))?.scansComputed).toBe(118);
  });

  it('gives a log from before max_scans the new header, keeps its old lines, and logs a subset run', () => {
    const out = join(dir, 'quality', 'ds-old');
    mkdirSync(out, { recursive: true });
    const old = 'run_date\tscans_computed\tscans_available\tscans_failed\tcount_source\n2026-11-04T10:00:00\t78\t120\t2\tgit-annex\n';
    writeFileSync(join(out, 'quality_runs.tsv'), old);
    const run = { runDate: '2026-11-06T09:12:40', scansComputed: 12, scansAvailable: 120, scansFailed: 0, countSource: 'files on disk', maxScans: 10 };
    const path = appendQualityRun(out, run);
    expect(readFileSync(path, 'utf-8').trim().split('\n')).toEqual([
      'run_date\tscans_computed\tscans_available\tscans_failed\tcount_source\tmax_scans',
      '2026-11-04T10:00:00\t78\t120\t2\tgit-annex',
      '2026-11-06T09:12:40\t12\t120\t0\tfiles on disk\t10',
    ]);
    expect(parseLastRun(readFileSync(path, 'utf-8'))).toEqual(run);
  });
});
