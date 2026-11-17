import { describe, it, expect } from 'vitest';
import { shownDetector } from '../detected-peaks';
import { detectorPeakTimes } from '@/data/detected-peaks';
import type { DetectedPeaksFile } from '@/data/detected-peaks';

const file: DetectedPeaksFile = {
  scan: 'func/sub-01_task-rest',
  recording: '',
  channel: 'PPG',
  signal: 'ppg',
  sampling_rate: 100,
  physio_file: 'sub-01_task-rest_physio.tsv.gz',
  detectors: [
    { id: 'a', label: 'Detector A', library: 'lib 1.0', reference: 'Author 2020', params: {}, peaks: [0, 50, 150], error: null },
    { id: 'b', label: 'Detector B', library: 'lib 1.0', reference: 'Author 2021', params: {}, peaks: [], error: 'ValueError: too short' },
  ],
};

describe('detectorPeakTimes', () => {
  it('puts sample indices on the chart axis: start time + index / rate', () => {
    expect(detectorPeakTimes(file, 'a', -2)).toEqual([-2, -1.5, -0.5]);
  });

  it('is empty for an unknown detector, a failed one, or no rate', () => {
    expect(detectorPeakTimes(file, 'x', 0)).toEqual([]);
    expect(detectorPeakTimes(file, 'b', 0)).toEqual([]);
    expect(detectorPeakTimes({ ...file, sampling_rate: 0 }, 'a', 0)).toEqual([]);
  });
});

describe('shownDetector: whose peaks the BUILT-IN PEAK DETECTION row shows', () => {
  const def = { id: 'c', label: 'Detector C', library: 'lib', reference: 'R', params: {}, peaks: [5], error: null, default: true };

  it('shows the default detector', () => {
    expect(shownDetector({ ...file, detectors: [...file.detectors, def] })).toBe('c');
  });

  it('falls back to the first detector that ran when the default is missing or failed', () => {
    expect(shownDetector(file)).toBe('a');
    expect(shownDetector({ ...file, detectors: [{ ...def, error: 'boom' }, ...file.detectors] })).toBe('a');
  });

  it('shows nothing, so the row hides, when no detector ran or there is no file', () => {
    expect(shownDetector({ ...file, detectors: [file.detectors[1]] })).toBeNull();
    expect(shownDetector({ ...file, detectors: [] })).toBeNull();
    expect(shownDetector(null)).toBeNull();
  });
});
