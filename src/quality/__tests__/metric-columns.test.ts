import { describe, it, expect } from 'vitest';
import { SQI_COLUMNS, formatMetricValue } from '../metric-columns';
import { METRIC_GROUPS } from '../model';
import type { ChannelMetrics } from '@/data/sqi-metrics';

const metrics = (over: Partial<ChannelMetrics> = {}): ChannelMetrics => ({
  channelName: 'cardiac',
  mean: 0.123456,
  stdDev: 1,
  snr: Infinity,
  kurtosis: -1.5,
  skewness: 0,
  zeroCrossingRate: 2,
  svri: NaN,
  ipa: NaN,
  sqi: NaN,
  kurtosisWindowed: NaN,
  approxEntropy: NaN,
  beatCorrelation: 0.99,
  ...over,
});

describe('metric column definitions', () => {
  it('has a column definition for every metric', () => {
    const keys = Object.keys(metrics());
    expect(SQI_COLUMNS.map((c) => c.key).sort()).toEqual(keys.sort());
    for (const c of SQI_COLUMNS) {
      expect(c.group === 'always' || METRIC_GROUPS.includes(c.group)).toBe(true);
    }
  });

  it('formats infinite and undefined values readably', () => {
    expect(formatMetricValue(Infinity, 2)).toBe('Inf');
    expect(formatMetricValue(-Infinity, 2)).toBe('-Inf');
    expect(formatMetricValue(NaN, 2)).toBe('N/A');
    expect(formatMetricValue(0.123456, 3)).toBe('0.123');
  });
});
