import { describe, it, expect } from 'vitest';
import { bareDoi, qualityBadgeLabel, TIMING_LABELS } from '../info';

describe('dataset info and badges', () => {
  it('normalises DOIs from dataset_description.json', () => {
    expect(bareDoi('doi:10.18112/openneuro.ds006644.v1.0.0')).toBe('10.18112/openneuro.ds006644.v1.0.0');
    expect(bareDoi('https://doi.org/10.1/x')).toBe('10.1/x');
    expect(bareDoi('http://dx.doi.org/10.1/x')).toBe('10.1/x');
    expect(bareDoi('10.1/x')).toBe('10.1/x');
  });

  it('labels quality badges with the assessment and percentage', () => {
    expect(qualityBadgeLabel('cardiac', 'pass', null)).toBe('cardiac: pass');
    expect(qualityBadgeLabel('cardiac', 'pass', 0.5)).toBe('cardiac: pass (50%)');
  });

  it('has a label for every timing status', () => {
    expect(Object.keys(TIMING_LABELS).sort()).toEqual(['corrected', 'mismatch', 'unverified', 'verified']);
  });
});
