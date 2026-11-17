import { describe, it, expect } from 'vitest';
import {
  firstScanFor,
  scanLevels,
  levelValues,
  levelText,
  levelDisplay,
  levelOptions,
  scanChannels,
  recordingFor,
} from '../controls';
import { parseScanId } from '@/data/scan-key';
import { channelLabel, clashingNames, parseRefKey, refKey } from '@/data/recordings';
import type { PhysioRaw, PhysioScan } from '@/data/bids-physio-reader';

const scan = (id: string) => parseScanId(id)!;

// Hierarchy order, as /api/bids/scans returns them
const scans = [
  scan('dwi/sub-01_dir-AP'),
  scan('eeg/sub-01_task-rest_run-1'),
  scan('func/sub-01_task-rest_run-1'),
  scan('func/sub-01_task-rest_run-2'),
  scan('func/sub-02_task-rest_acq-mb_run-1'),
  scan('func/sub-02_task-rest_acq-sb_run-1'),
];

describe('scanLevels: Subject, Task, Datatype, then the other entities', () => {
  const summary = (list: typeof scans) => scanLevels(list).map((l) => `${l.heading}${l.multi ? '' : '='}`);

  it('keeps the file-name order of the other entities', () => {
    // dir- and run- never appear in one file here, so their order is that of first appearance
    expect(summary(scans)).toEqual(['Subject', 'Task', 'Datatype', 'acq', 'Run', 'dir']);
    const both = [scan('func/sub-01_task-rest_dir-AP_run-1'), scan('func/sub-01_task-rest_dir-PA_run-2')];
    expect(summary(both)).toEqual(['Subject=', 'Task=', 'Datatype=', 'dir', 'Run']);
  });

  it('shows an entity with one value in the whole dataset as text, not a dropdown', () => {
    const one = [scan('func/sub-01_ses-01_task-rest_run-1'), scan('func/sub-02_ses-01_task-rest_run-1')];
    expect(summary(one)).toEqual(['Subject', 'Task=', 'Datatype=', 'Session=', 'Run=']);
  });

  it('puts Task and Datatype right after Subject, before Session', () => {
    const multi = [scan('func/sub-01_ses-1_task-DPX_run-1'), scan('eeg/sub-01_ses-2_task-ANT_run-1')];
    expect(summary(multi)).toEqual(['Subject=', 'Task', 'Datatype', 'Session', 'Run=']);
  });

  it('puts Datatype after Subject when no scan has a task', () => {
    const anat = [scan('anat/sub-01_ses-1'), scan('dwi/sub-01_ses-2')];
    expect(summary(anat)).toEqual(['Subject=', 'Datatype', 'Session']);
  });

  it('gives a dropdown to an entity only some scans have ("none" for the others)', () => {
    const some = [scan('func/sub-01_task-rest'), scan('func/sub-01_task-rest_run-1')];
    expect(summary(some)).toEqual(['Subject=', 'Task=', 'Datatype=', 'Run']);
    expect(levelText('run', '')).toBe('none');
    expect(levelText('datatype', '')).toBe('no datatype folder');
  });

  it('adds echo only for anat/ physio (BIDS allows echo- there, not in func/)', () => {
    const anat = [scan('anat/sub-01_task-rest_echo-1'), scan('anat/sub-01_task-rest_echo-2')];
    expect(summary(anat)).toEqual(['Subject=', 'Task=', 'Datatype=', 'echo']);
  });

  it('leaves out Datatype when no physio file is in a datatype folder', () => {
    expect(summary([scan('sub-01_task-rest'), scan('sub-02_task-rest')])).toEqual(['Subject', 'Task=']);
  });
});

describe('levelDisplay: a dropdown level for the current scan', () => {
  it('shows one value as text without a lock, like a level with one value in the dataset', () => {
    // ds004636: run-2 in two rest scans only, so Run is a dropdown level; every other scan has just run-1
    expect(levelDisplay(['1'], false)).toEqual({ show: 'text', lock: false });
  });

  it('keeps the dropdown and its lock for two or more values', () => {
    expect(levelDisplay(['1', '2'], false)).toEqual({ show: 'select', lock: true });
    expect(levelDisplay(['', '1'], false)).toEqual({ show: 'select', lock: true });
  });

  it('hides the level when its only value is "none"', () => {
    expect(levelDisplay([''], false)).toEqual({ show: 'hidden', lock: false });
  });

  it('keeps a lock that is on beside the text, so it can be undone', () => {
    expect(levelDisplay(['rest'], true)).toEqual({ show: 'text', lock: true });
  });
});

describe('firstScanFor: the scan a dropdown change opens', () => {
  const levels = scanLevels(scans);
  const wanted = (s: (typeof scans)[number], change: Record<string, string>) => ({ ...levelValues(s, levels), ...change });

  it('takes the first scan under the new choice, keeping the levels before it', () => {
    expect(firstScanFor(scans, levels, wanted(scans[2], { sub: '02' }), 'sub')?.id).toBe(
      'func/sub-02_task-rest_acq-mb_run-1',
    );
    expect(firstScanFor(scans, levels, wanted(scans[0], { task: 'rest' }), 'task')?.id).toBe('eeg/sub-01_task-rest_run-1');
    expect(firstScanFor(scans, levels, wanted(scans[2], { run: '2' }), 'run')?.id).toBe('func/sub-01_task-rest_run-2');
    expect(firstScanFor(scans, levels, wanted(scans[2], { task: '' }), 'task')?.id).toBe('dwi/sub-01_dir-AP');
    expect(firstScanFor(scans, levels, wanted(scans[1], { datatype: 'func' }), 'datatype')?.id).toBe(
      'func/sub-01_task-rest_run-1',
    );
  });

  it('keeps every lock: a new subject opens its scan with the locked values', () => {
    const locks = { acq: 'sb' };
    expect(firstScanFor(scans, levels, wanted(scans[2], { sub: '02' }), 'sub', locks)?.id).toBe(
      'func/sub-02_task-rest_acq-sb_run-1',
    );
    expect(firstScanFor(scans, levels, wanted(scans[4], { sub: '01' }), 'sub', locks)).toBeUndefined();
  });

  it('finds nothing for a choice no scan has', () => {
    expect(firstScanFor(scans, levels, wanted(scans[2], { sub: '99' }), 'sub')).toBeUndefined();
  });
});

describe('levelOptions: a session never hides a task (ds004636 layout: tasks split over sessions)', () => {
  const sessions = [
    scan('func/sub-01_ses-1_task-DPX_run-1'),
    scan('func/sub-01_ses-1_task-rest_run-1'),
    scan('func/sub-01_ses-1_task-rest_run-2'),
    scan('func/sub-01_ses-2_task-ANT_run-1'),
    scan('func/sub-01_ses-2_task-rest_run-1'),
    scan('func/sub-02_ses-1_task-stroop_run-1'),
  ];
  const levels = scanLevels(sessions);
  const at = (s: (typeof sessions)[number]) => levelValues(s, levels);

  it('lists every task of the dataset, whatever the shown subject and session', () => {
    const all = ['DPX', 'rest', 'ANT', 'stroop'];
    expect(levelOptions(sessions, levels, at(sessions[0]), 'task')).toEqual(all);
    expect(levelOptions(sessions, levels, at(sessions[5]), 'task')).toEqual(all);
    expect(levelOptions(sessions, levels, at(sessions[5]), 'ses')).toEqual(['1', '2']);
  });

  it('lists the runs of the shown acquisition only', () => {
    expect(levelOptions(sessions, levels, at(sessions[1]), 'run')).toEqual(['1', '2']);
    expect(levelOptions(sessions, levels, at(sessions[4]), 'run')).toEqual(['1']);
  });

  it('opens the session that has a task picked from another session, else keeps the session', () => {
    expect(firstScanFor(sessions, levels, { ...at(sessions[0]), task: 'ANT' }, 'task')?.id).toBe(
      'func/sub-01_ses-2_task-ANT_run-1',
    );
    expect(firstScanFor(sessions, levels, { ...at(sessions[3]), task: 'rest' }, 'task')?.id).toBe(
      'func/sub-01_ses-2_task-rest_run-1',
    );
  });

  it('opens the first subject that has a task the shown subject lacks; a subject change keeps what it can', () => {
    expect(firstScanFor(sessions, levels, { ...at(sessions[0]), task: 'stroop' }, 'task')?.id).toBe(
      'func/sub-02_ses-1_task-stroop_run-1',
    );
    expect(firstScanFor(sessions, levels, { ...at(sessions[5]), sub: '01' }, 'sub')?.id).toBe(
      'func/sub-01_ses-1_task-DPX_run-1',
    );
    expect(firstScanFor(sessions, levels, { ...at(sessions[3]), sub: '01', task: 'ANT' }, 'sub')?.id).toBe(
      'func/sub-01_ses-2_task-ANT_run-1',
    );
  });

  it('still narrows by the locks of the other levels', () => {
    expect(levelOptions(sessions, levels, at(sessions[0]), 'task', { ses: '2' })).toEqual(['ANT', 'rest']);
  });
});

/** A recording with the given columns (only what the channel list reads) */
const rec = (recording: string, columns: string[]) => ({ recording, columns }) as unknown as PhysioRaw;

describe('channels of a scan split into recordings', () => {
  const split: PhysioScan = {
    recordings: [
      rec('belt1', ['respiratory', 'temperature']),
      rec('belt2', ['respiratory', 'temperature']),
      rec('cardiac', ['cardiac', 'trigger']),
      rec('pulse', ['ppg', 'trigger']),
    ],
    skipped: [], timeDatatype: 'func',
  };

  it('lists every recording physiological columns; a shared column carries its recording', () => {
    expect(scanChannels(split).map((c) => c.label)).toEqual([
      'respiratory (recording-belt1)',
      'temperature (recording-belt1)',
      'respiratory (recording-belt2)',
      'temperature (recording-belt2)',
      'cardiac',
      'ppg',
    ]);
  });

  it('keys each channel by recording and column, and finds the recording it is in', () => {
    const belt2 = scanChannels(split).find((c) => c.label === 'respiratory (recording-belt2)')!;
    expect(belt2.ref).toEqual({ recording: 'belt2', channel: 'respiratory' });
    expect(recordingFor(split, belt2.key)).toBe(split.recordings[1]);
    expect(recordingFor(split, refKey({ recording: 'belt3', channel: 'respiratory' }))).toBeUndefined();
  });

  it('keeps plain column names (and old saved keys) for a scan that is not split', () => {
    const plain: PhysioScan = { recordings: [rec('', ['cardiac', 'respiratory', 'trigger'])], skipped: [], timeDatatype: 'func' };
    expect(scanChannels(plain).map((c) => c.key)).toEqual(['cardiac', 'respiratory']);
    expect(recordingFor(plain, 'cardiac')).toBe(plain.recordings[0]);
  });

  it('names two respiratory belts (two devices, two rates) by their recordings', () => {
    const belts: PhysioScan = {
      recordings: [rec('belt1', ['respiratory']), rec('belt2', ['respiratory', 'trigger'])],
      skipped: [], timeDatatype: 'func',
    };
    expect(scanChannels(belts).map((c) => c.label)).toEqual([
      'respiratory (recording-belt1)',
      'respiratory (recording-belt2)',
    ]);
  });

  it('keeps plain names when each recording has its own columns (cardiac and respiratory files)', () => {
    const own: PhysioScan = {
      recordings: [rec('cardiac', ['cardiac']), rec('respiratory', ['respiratory'])],
      skipped: [], timeDatatype: 'func',
    };
    expect(scanChannels(own).map((c) => c.label)).toEqual(['cardiac', 'respiratory']);
  });

  it('round-trips keys and names a clash only when two recordings share a column', () => {
    for (const ref of [{ recording: '', channel: 'cardiac' }, { recording: 'belt1', channel: 'respiratory' }]) {
      expect(parseRefKey(refKey(ref))).toEqual(ref);
    }
    const clashes = clashingNames([
      { recording: 'a', channels: ['x', 'y'] },
      { recording: 'b', channels: ['x'] },
    ]);
    expect([...clashes]).toEqual(['x']);
    expect(channelLabel({ recording: 'a', channel: 'y' }, clashes)).toBe('y');
  });
});
