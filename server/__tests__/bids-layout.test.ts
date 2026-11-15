import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { existsSync } from 'fs';
import { getSubjects, findPhysioFiles, readPhysio, buildScans } from '../bids-layout';
import { buildBidsIndex } from '../bids-index';
import { parseScanId } from '../../src/data/scan-key';

/**
 * Dataset-agnostic BIDS layout test suite.
 *
 * Each entry only needs a name and a root path. Every assertion is derived
 * from what the functions themselves discover — no hardcoded subject IDs,
 * channel names, session labels, or subject counts.
 *
 * To add a new dataset, append an entry with { name, root }.
 *
 * The synthetic fixtures under test/fixtures always run; real datasets under
 * data/ run only when they have been downloaded.
 */

const BASE = join(process.cwd(), 'data');
const FIXTURES = join(process.cwd(), 'test', 'fixtures');

const datasets = [
  { name: 'fixture: bids-sessions', root: join(FIXTURES, 'bids-sessions') },
  { name: 'fixture: bids-nosessions', root: join(FIXTURES, 'bids-nosessions') },
  { name: 'ds006644', root: join(BASE, 'ds006644') },
  { name: 'ds000210', root: join(BASE, 'ds000210') },
].filter((d) => existsSync(d.root));

const byNumeric = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

describe.each(datasets)('BIDS layout: $name', ({ root: bidsRoot }) => {
  // Index and discover once per dataset; all subsequent tests derive from this.
  const root = buildBidsIndex({ bidsRoot });
  const subjects = getSubjects(root);
  const scans = buildScans(root);
  const tasksOf = (sub: string, ses: string) => [
    ...new Set(scans.filter((s) => s.sub === sub && s.ses === ses).map((s) => s.task)),
  ];
  const runsOf = (sub: string, ses: string, task: string) =>
    scans.filter((s) => s.sub === sub && s.ses === ses && s.task === task && s.run !== '').map((s) => s.run);

  it('discovers at least one subject with readable physio', () => {
    expect(subjects.length).toBeGreaterThan(0);
  });

  it('every subject has a sorted, non-empty sessions array', () => {
    for (const subj of subjects) {
      expect(subj.sessions.length).toBeGreaterThan(0);
      // Sessions are either all non-empty strings (has ses- dirs)
      // or exactly [''] (session-less layout) — never mixed.
      const hasSessions = subj.sessions[0].length > 0;
      if (hasSessions) {
        expect(subj.sessions.every((s) => s.length > 0)).toBe(true);
        expect(subj.sessions).toEqual([...subj.sessions].sort(byNumeric));
      } else {
        expect(subj.sessions).toEqual(['']);
      }
    }
  });

  it('every subject/session pair yields at least one scan, tasks in sorted order', () => {
    for (const subj of subjects) {
      for (const ses of subj.sessions) {
        const tasks = tasksOf(subj.id, ses);
        expect(tasks.length).toBeGreaterThan(0);
        expect(tasks).toEqual([...tasks].sort(byNumeric));
      }
    }
  });

  it('runs of a task come in sorted order', () => {
    const first = subjects[0];
    const ses = first.sessions[0];
    for (const task of tasksOf(first.id, ses)) {
      const runs = runsOf(first.id, ses, task);
      expect(runs).toEqual([...runs].sort(byNumeric));
    }
  });

  it('findPhysioFiles locates a .tsv.gz and a .json sidecar for the first scan', () => {
    const found = findPhysioFiles(root, scans[0].id);
    expect(found).not.toBeNull();
    expect(found!.tsvGzPath).toMatch(/\.tsv\.gz$/);
    expect(found!.sidecarPath).not.toBeNull();
    expect(found!.sidecarPath).toMatch(/\.json$/);
  });

  it('readPhysio returns consistent column data for the first scan', () => {
    const result = readPhysio(root, scans[0].id);
    expect(result).not.toBeNull();
    expect(result!.samplingFrequency).toBeGreaterThan(0);
    expect(result!.columns.length).toBeGreaterThan(0);
    expect(result!.data.length).toBe(result!.columns.length);
    expect(result!.numSamples).toBeGreaterThan(0);
    for (const col of result!.data) {
      expect(col.length).toBe(result!.numSamples);
    }
  });

  it('every scan has a sub, an id that parses back to it, and a findable physio file', () => {
    expect(scans.length).toBeGreaterThan(0);
    for (const scan of scans) {
      expect(scan.sub).toBeTruthy();
      // ses, task and run can be '' (session-less, no task, no runs)
      expect(parseScanId(scan.id)).toEqual(scan);
      expect(findPhysioFiles(root, scan.id)).not.toBeNull();
    }
  });

  it('within a dataset, sessions are uniformly present or absent', () => {
    // BIDS datasets don't mix session-less and session-ful subjects
    const hasSessions = subjects[0].sessions[0].length > 0;
    for (const subj of subjects) {
      const subjHas = subj.sessions[0].length > 0;
      expect(subjHas).toBe(hasSessions);
    }
  });

  it('within a dataset, runs are consistent per task across subjects', () => {
    // Pick the first task from the first subject; check whether other subjects
    // with the same task also have runs (or also don't).
    const first = subjects[0];
    const ses = first.sessions[0];
    const task = tasksOf(first.id, ses)[0];
    const expectRuns = runsOf(first.id, ses, task).length > 0;

    for (const subj of subjects) {
      for (const s of subj.sessions) {
        if (!tasksOf(subj.id, s).includes(task)) continue;
        const runs = runsOf(subj.id, s, task);
        if (expectRuns) {
          expect(runs.length).toBeGreaterThan(0);
        } else {
          expect(runs.length).toBe(0);
        }
      }
    }
  });
});
