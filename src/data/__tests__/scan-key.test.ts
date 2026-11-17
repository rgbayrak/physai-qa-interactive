import { describe, it, expect } from 'vitest';
import {
  levelValue,
  locksFromQuery,
  locksToQuery,
  makeScanKey,
  matchesLocks,
  parseScanId,
  sameScanKey,
  scanEntities,
  scanPrefix,
  timeReference,
} from '../scan-key';

describe('scan levels and locks', () => {
  const s = parseScanId('func/sub-01_task-rest_acq-mb')!;

  it('reads an entity or the datatype folder; a missing entity is empty', () => {
    expect(levelValue(s, 'acq')).toBe('mb');
    expect(levelValue(s, 'datatype')).toBe('func');
    expect(levelValue(s, 'run')).toBe('');
  });

  it('matches a scan that has every locked value', () => {
    expect(matchesLocks(s, {})).toBe(true);
    expect(matchesLocks(s, { task: 'rest', datatype: 'func' })).toBe(true);
    expect(matchesLocks(s, { task: 'rest', acq: 'sb' })).toBe(false);
    expect(matchesLocks(s, { run: '' })).toBe(true); // locked on "none"
  });

  it('round-trips locks through query parameters, dropping malformed ones', () => {
    const locks = { task: 'rest', datatype: 'func' };
    const params = new URLSearchParams(locksToQuery(locks)).getAll('lock');
    expect(locksFromQuery(params)).toEqual(locks);
    expect(locksFromQuery(['task', ':rest', 'run:'])).toEqual({ run: '' });
    expect(locksToQuery({})).toBe('');
  });
});

describe('scan key', () => {
  it('is the datatype folder plus every entity but recording- and desc-, in file-name order', () => {
    const entities = scanEntities({ sub: '01', ses: '2', task: 'rest', acq: 'mb', run: '1', recording: 'cardiac', desc: 'preproc' });
    expect(entities).toEqual({ sub: '01', ses: '2', task: 'rest', acq: 'mb', run: '1' });
    expect(scanPrefix(entities)).toBe('sub-01_ses-2_task-rest_acq-mb_run-1');
    expect(makeScanKey('func', entities)).toEqual({
      id: 'func/sub-01_ses-2_task-rest_acq-mb_run-1',
      datatype: 'func',
      sub: '01',
      ses: '2',
      task: 'rest',
      run: '1',
      entities,
    });
  });

  it('has empty ses/task/run when the scan has none, and no folder in the id outside a datatype folder', () => {
    expect(makeScanKey('dwi', { sub: '01', dir: 'AP' })).toMatchObject({ id: 'dwi/sub-01_dir-AP', task: '', run: '' });
    expect(makeScanKey('', { sub: '01', task: 'rest' }).id).toBe('sub-01_task-rest');
  });

  it('parses an id back to the same key', () => {
    for (const id of ['func/sub-01_ses-2_task-rest_acq-mb_run-1', 'eeg/sub-01_task-rest', 'sub-01_task-rest', 'dwi/sub-01']) {
      expect(parseScanId(id)?.id).toBe(id);
    }
    expect(parseScanId('func/sub-01_task-rest')).toEqual(makeScanKey('func', { sub: '01', task: 'rest' }));
  });

  it('rejects ids that are not datatype/prefix with a sub- entity', () => {
    for (const id of ['', 'func/', 'func/task-rest', 'Func/sub-01', 'a/b/sub-01', 'func/sub-01_rest', 'func/sub-']) {
      expect(parseScanId(id)).toBeNull();
    }
  });

  it('tells func/ and eeg/ recordings of one run apart', () => {
    expect(sameScanKey(parseScanId('func/sub-01_task-rest')!, parseScanId('eeg/sub-01_task-rest')!)).toBe(false);
    expect(sameScanKey(parseScanId('func/sub-01_task-rest')!, makeScanKey('func', { sub: '01', task: 'rest' }))).toBe(true);
  });
});

describe('timeReference: what t = 0 is', () => {
  it('is the scan onset for MRI datatypes, the start of the recording otherwise', () => {
    expect(timeReference('func')).toEqual({ axisLabel: 'Time from scan onset (s)', marker: 'scan onset (t = 0)' });
    expect(timeReference('eeg')).toEqual({
      axisLabel: 'Time from start of the EEG recording (s)',
      marker: 'start of the EEG recording (t = 0)',
    });
    expect(timeReference('').axisLabel).toBe('Time from start of the recording (s)');
  });
});
