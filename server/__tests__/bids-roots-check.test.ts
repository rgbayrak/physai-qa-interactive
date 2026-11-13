import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { checkRootSettings, noPhysioLines } from '../bids-roots-check';

let cwd: string;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'bids-roots-check-'));
  // A BIDS folder, one without dataset_description.json, and one whose
  // dataset_description.json is a git-annex link with no content downloaded
  mkdirSync(join(cwd, 'data', 'good'), { recursive: true });
  writeFileSync(join(cwd, 'data', 'good', 'dataset_description.json'), '{}');
  mkdirSync(join(cwd, 'data', 'not-bids'), { recursive: true });
  mkdirSync(join(cwd, 'data', 'annexed'), { recursive: true });
  symlinkSync('.git/annex/objects/missing', join(cwd, 'data', 'annexed', 'dataset_description.json'));
  mkdirSync(join(cwd, 'physprep'));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const text = (check: ReturnType<typeof checkRootSettings>) => (check.ok ? '' : check.lines.join('\n'));

describe('checkRootSettings', () => {
  it('has no default dataset: without BIDS_ROOT it says what to set', () => {
    const check = checkRootSettings({}, cwd);
    expect(check.ok).toBe(false);
    expect(text(check)).toContain('No BIDS dataset given.');
    expect(text(check)).toContain('BIDS_ROOT=data/<dataset> npm run dev');
    expect(text(check)).toContain('BIDSPHYS_ROOT=');
    expect(text(check)).toContain('BIDSDER_ROOT=');
  });

  it('accepts a BIDS folder and makes relative paths absolute from cwd', () => {
    expect(checkRootSettings({ bidsRoot: 'data/good', physioRoot: 'physprep' }, cwd)).toEqual({
      ok: true,
      bidsRoot: join(cwd, 'data', 'good'),
      physioRoot: join(cwd, 'physprep'),
      derivRoot: undefined,
    });
  });

  it('counts a dataset_description.json link that is not downloaded', () => {
    expect(checkRootSettings({ bidsRoot: 'data/annexed' }, cwd).ok).toBe(true);
  });

  it('names a BIDS_ROOT folder that does not exist', () => {
    const check = checkRootSettings({ bidsRoot: 'data/typo' }, cwd);
    expect(text(check)).toContain(`BIDS_ROOT folder not found: ${join(cwd, 'data', 'typo')}`);
  });

  it('says when the folder is not a BIDS dataset', () => {
    const check = checkRootSettings({ bidsRoot: 'data/not-bids' }, cwd);
    expect(text(check)).toContain('BIDS-compliant dataset not found');
    expect(text(check)).toContain('dataset_description.json is missing');
  });

  it('names BIDSPHYS_ROOT and BIDSDER_ROOT folders that do not exist', () => {
    const check = checkRootSettings({ bidsRoot: 'data/good', physioRoot: 'nope', derivRoot: 'nope2' }, cwd);
    expect(text(check)).toContain(`BIDSPHYS_ROOT folder not found: ${join(cwd, 'nope')}`);
    expect(text(check)).toContain(`BIDSDER_ROOT folder not found: ${join(cwd, 'nope2')}`);
  });
});

describe('noPhysioLines', () => {
  it('suggests BIDSPHYS_ROOT unless it was given, and datalad get', () => {
    expect(noPhysioLines(['/x'], false).join('\n')).toContain('set BIDSPHYS_ROOT=');
    expect(noPhysioLines(['/x'], true).join('\n')).toContain('Check that BIDSPHYS_ROOT');
    expect(noPhysioLines(['/x'], true).join('\n')).toContain('datalad get');
    expect(noPhysioLines(['/x', '/y'], true)[0]).toBe('No readable physio files under /x, /y.');
  });
});
