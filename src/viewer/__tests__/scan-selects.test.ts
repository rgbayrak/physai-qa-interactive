import { describe, it, expect } from 'vitest';
import { firstScanFor, variantOptions } from '../controls';
import { parseScanId } from '@/data/scan-key';

const scan = (id: string) => parseScanId(id)!;

// Hierarchy order, as /api/bids/scans returns them
const scans = [
  scan('anat/sub-01_acq-mprage'),
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
    expect(firstScanFor(scans, { ...scans[2], task: '' }, 'task')?.id).toBe('anat/sub-01_acq-mprage');
  });

  it('finds nothing for a choice no scan has', () => {
    expect(firstScanFor(scans, { ...scans[2], sub: '99' }, 'sub')).toBeUndefined();
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
