import { describe, it, expect } from 'vitest';
import { SQI_COLUMNS, formatMetricValue } from '../metric-columns';
import type { ChannelMetrics } from '@/data/sqi-metrics';

const metrics = (over: Partial<ChannelMetrics> = {}): ChannelMetrics => ({
  channelName: 'cardiac',
  mean: 0.123456,
  stdDev: 1,
  stdDevFiltered: NaN,
  snr: Infinity,
  kurtosis: -1.5,
  skewness: 0,
  entropy: NaN,
  zeroCrossing: 0.5,
  perfusion: NaN,
  relativePower: NaN,
  ...over,
});

describe('metric column definitions', () => {
  it('has a column definition for every metric', () => {
    const keys = Object.keys(metrics());
    expect(SQI_COLUMNS.map((c) => c.key).sort()).toEqual(keys.sort());
    // A source, where given, is "Author Year"
    for (const c of SQI_COLUMNS) {
      if (c.source !== undefined) expect(c.source).toMatch(/^\S+ \d{4}$/);
    }
  });

  it('formats infinite and undefined values readably', () => {
    expect(formatMetricValue(Infinity, 2)).toBe('Inf');
    expect(formatMetricValue(-Infinity, 2)).toBe('-Inf');
    expect(formatMetricValue(NaN, 2)).toBe('N/A');
    expect(formatMetricValue(0.123456, 3)).toBe('0.123');
  });
});
