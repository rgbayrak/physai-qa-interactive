import { describe, it, expect } from 'vitest';
import { firstScanFor, variantOptions, scanChannels, recordingFor } from '../controls';
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

describe('firstScanFor: the scan a Subject / Session / Task / Run change opens', () => {
  it('takes the first scan under the new choice, keeping the levels above', () => {
    expect(firstScanFor(scans, { ...scans[2], sub: '02' }, 'sub')?.id).toBe('func/sub-02_task-rest_acq-mb_run-1');
    expect(firstScanFor(scans, { ...scans[0], task: 'rest' }, 'task')?.id).toBe('eeg/sub-01_task-rest_run-1');
    expect(firstScanFor(scans, { ...scans[2], run: '2' }, 'run')?.id).toBe('func/sub-01_task-rest_run-2');
    expect(firstScanFor(scans, { ...scans[2], task: '' }, 'task')?.id).toBe('dwi/sub-01_dir-AP');
  });

  it('finds nothing for a choice no scan has', () => {
    expect(firstScanFor(scans, { ...scans[2], sub: '99' }, 'sub')).toBeUndefined();
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
    skipped: [],
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
    const plain: PhysioScan = { recordings: [rec('', ['cardiac', 'respiratory', 'trigger'])], skipped: [] };
    expect(scanChannels(plain).map((c) => c.key)).toEqual(['cardiac', 'respiratory']);
    expect(recordingFor(plain, 'cardiac')).toBe(plain.recordings[0]);
  });

  it('names two respiratory belts (two devices, two rates) by their recordings', () => {
    const belts: PhysioScan = {
      recordings: [rec('belt1', ['respiratory']), rec('belt2', ['respiratory', 'trigger'])],
      skipped: [],
    };
    expect(scanChannels(belts).map((c) => c.label)).toEqual([
      'respiratory (recording-belt1)',
      'respiratory (recording-belt2)',
    ]);
  });

  it('keeps plain names when each recording has its own columns (cardiac and respiratory files)', () => {
    const own: PhysioScan = {
      recordings: [rec('cardiac', ['cardiac']), rec('respiratory', ['respiratory'])],
      skipped: [],
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

describe('variantOptions: the Datatype / Scan dropdown', () => {
  it('is headed Datatype and lists the folders when only the datatype differs (EEG-fMRI)', () => {
    const { heading, label } = variantOptions([scans[1], scans[2]]);
    expect(heading).toBe('Datatype');
    expect([scans[1], scans[2]].map(label)).toEqual(['eeg', 'func']);
  });

  it('is headed Scan and lists the entities that differ otherwise', () => {
    const { heading, label } = variantOptions([scans[4], scans[5]]);
    expect(heading).toBe('Scan');
    expect([scans[4], scans[5]].map(label)).toEqual(['acq-mb', 'acq-sb']);
  });

  it('shows the folder too when both differ, and names a missing entity', () => {
    const a = scan('func/sub-01_task-rest_acq-mb');
    const b = scan('eeg/sub-01_task-rest');
    expect([a, b].map(variantOptions([a, b]).label)).toEqual(['func · acq-mb', 'eeg · no acq-']);
  });
});
