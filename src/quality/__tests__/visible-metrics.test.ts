import { describe, it, expect } from 'vitest';
import { METRIC_COLUMNS } from '../metrics-tsv';
import { makeScanKey } from '../../data/scan-key';
import type { MetricKey, QualityRow } from '../metrics-tsv';
import {
  ALL_METRICS,
  METRIC_DEFS,
  availableMetrics,
  defaultMetricPair,
  metricDef,
  metricNameWithSource,
  metricTooltip,
  metricAxisChoices,
  metricAxisLabel,
  metricUnit,
  parseVisibleMetrics,
  serializeVisibleMetrics,
  xAxisChoices,
  yAxisChoices,
} from '../model';

function row(metrics: Partial<Record<MetricKey, number>>): QualityRow {
  const m = {} as Record<MetricKey, number>;
  for (const c of METRIC_COLUMNS) m[c.key] = NaN;
  return {
    ...makeScanKey('func', { sub: '01', task: 'rest' }),
    recording: '',
    t0Datatype: 'func',
    filename: 'f',
    channel: 'cardiac',
    signalType: 'cardiac',
    samplingFrequency: 100,
    numSamples: 100,
    durationS: 1,
    timingStatus: 'verified',
    sidecarAssessment: '',
    sidecarPercentValid: NaN,
    metrics: { ...m, ...metrics },
  };
}

describe('metric names and sources (no groups)', () => {
  it('lists every metric once, in TSV order', () => {
    expect(METRIC_DEFS.map((d) => d.key)).toEqual(METRIC_COLUMNS.map((c) => c.key));
    expect(new Set(ALL_METRICS).size).toBe(ALL_METRICS.length);
  });

  it('names a metric with its paper, and shows description then paper on hover', () => {
    expect(metricNameWithSource(metricDef('perfusion'))).toBe('Perfusion (Elgendi 2016)');
    expect(metricNameWithSource(metricDef('stdDev'))).toBe('Std Dev'); // plain statistic: no paper
    const tip = metricTooltip(metricDef('perfusion'));
    expect(tip.startsWith(metricDef('perfusion').description!)).toBe(true);
    expect(tip.endsWith('Source: Elgendi 2016.')).toBe(true);
    expect(metricTooltip(metricDef('stdDev'))).toBe(metricDef('stdDev').description);
  });
});

describe('stored choice', () => {
  it('defaults to every metric', () => {
    expect([...parseVisibleMetrics(null)]).toEqual(ALL_METRICS);
    expect([...parseVisibleMetrics('not json')]).toEqual(ALL_METRICS);
    expect([...parseVisibleMetrics('{"a":1}')]).toEqual(ALL_METRICS);
  });

  it('round-trips, drops unknown keys and keeps an empty choice', () => {
    const chosen = new Set<MetricKey>(['perfusion', 'snr']);
    const stored = serializeVisibleMetrics(chosen);
    expect(stored).toBe('["snr","perfusion"]');
    expect(parseVisibleMetrics(stored)).toEqual(chosen);
    expect([...parseVisibleMetrics('["snr","removedMetric"]')]).toEqual(['snr']);
    expect(parseVisibleMetrics('[]').size).toBe(0);
  });
});

describe('axis units', () => {
  const units = { cardiac: 'mV' };

  it('uses the channel unit for mean and SD, a fixed unit for perfusion, none otherwise', () => {
    expect(metricUnit('mean', 'cardiac', units)).toBe('mV');
    expect(metricUnit('stdDev', 'cardiac', units)).toBe('mV');
    expect(metricUnit('stdDevFiltered', 'cardiac', units)).toBe('mV');
    expect(metricUnit('mean', 'respiratory', units)).toBeNull();
    expect(metricUnit('mean', 'cardiac')).toBeNull();
    expect(metricUnit('perfusion', 'cardiac')).toBe('%');
    expect(metricUnit('zeroCrossing', 'cardiac')).toBeNull(); // a fraction
    expect(metricUnit('snr', 'cardiac', units)).toBeNull();
  });

  it('adds the unit to axis labels', () => {
    expect(metricAxisLabel('mean', 'cardiac', units)).toBe('Mean (mV)');
    expect(metricAxisLabel('mean', 'respiratory', units)).toBe('Mean');
    expect(metricAxisLabel('perfusion', 'cardiac')).toBe('Perfusion (%)');
    const rows = [row({ mean: 1, snr: 2 })];
    expect(metricAxisChoices(rows, units).map((c) => c.label)).toEqual(['Mean (mV)', 'SNR']);
  });
});

describe('hidden metrics', () => {
  const rows = [row({ snr: 1, kurtosis: 2, perfusion: 0.9 })];

  it('leave the Stats tables and histograms (availableMetrics)', () => {
    const visible = new Set<MetricKey>(['snr', 'kurtosis']);
    expect(availableMetrics(rows)).toEqual(['snr', 'kurtosis', 'perfusion']);
    expect(availableMetrics(rows, visible)).toEqual(['snr', 'kurtosis']);
    expect(availableMetrics(rows, new Set())).toEqual([]);
  });

  it('never affect the scatter axis menus or their default pair', () => {
    const all = ['snr', 'kurtosis', 'perfusion'];
    expect(metricAxisChoices(rows).map((c) => c.value)).toEqual(all);
    expect(yAxisChoices(rows).map((c) => c.value)).toEqual(all);
    expect(xAxisChoices(rows, null, rows).map((c) => c.value)).toEqual(all);
    expect(defaultMetricPair(rows)).toEqual(['snr', 'kurtosis']);
  });
});
