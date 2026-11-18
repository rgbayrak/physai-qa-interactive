import { describe, it, expect } from 'vitest';
import {
  formatNumber,
  parseNumber,
  rowsToTsv,
  parseQualityTsv,
  scanId,
  METRIC_COLUMNS,
  TSV_HEADER,
} from '../metrics-tsv';
import type { MetricKey, QualityRow } from '../metrics-tsv';
import { minMaxEnvelope, roundSig } from '../envelope';
import { histogramBins, finiteMean, paddedExtent, percentileRank } from '../stats';
import { legendHtml } from '../scatter-panel';

describe('scatter colour legend', () => {
  const groups = [
    { label: '01', color: '#111111' },
    { label: '02', color: '#222222' },
  ];

  it('names what the colours mean before the groups, then the viewed scan', () => {
    const html = legendHtml('Session', groups, true);
    expect(html.indexOf('Session:')).toBeLessThan(html.indexOf('>01<'));
    expect(html.indexOf('>02<')).toBeLessThan(html.indexOf('Now viewing'));
    expect(html).toContain('legend-viewed');
  });

  it('lists no groups when every point has one colour, and escapes labels', () => {
    expect(legendHtml(null, groups, true)).not.toContain('>01<');
    expect(legendHtml(null, groups, false)).toBe('');
    expect(legendHtml('Task', [{ label: '<b>', color: '#000' }], false)).toContain('&lt;b&gt;');
  });
});
import { parseScanHash, scanHash, statsUrl, viewerUrl } from '../route';
import { makeScanKey } from '../../data/scan-key';
import {
  METRIC_DEFS,
  availableMetrics,
  channelSummaries,
  colorGroups,
  colorByOptions,
  colorKey,
  datasetSummaryText,
  humanList,
  defaultMetricPair,
  esc,
  ordinal,
  timingCounts,
  uniqueScans,
  labelRecordingChannels,
  recordingFiles,
  recordingRates,
  scanTimeReference,
} from '../model';

function row(over: Partial<QualityRow> = {}, metrics: Partial<Record<MetricKey, number>> = {}): QualityRow {
  const m = {} as Record<MetricKey, number>;
  for (const c of METRIC_COLUMNS) m[c.key] = NaN;
  // The scan key follows the sub/ses/task/run given ('' leaves the entity out)
  const { sub = '01', ses = '01', task = 'rest', run = '01', datatype = 'func' } = over;
  const key = makeScanKey(datatype, {
    sub,
    ...(ses ? { ses } : {}),
    ...(task ? { task } : {}),
    ...(run ? { run } : {}),
  });
  return {
    recording: '',
    t0Datatype: datatype,
    filename: 'sub-01_ses-01_task-rest_run-01_physio.tsv.gz',
    channel: 'cardiac',
    signalType: 'cardiac',
    samplingFrequency: 496,
    numSamples: 1000,
    durationS: 1000 / 496,
    timingStatus: 'verified',
    sidecarAssessment: 'Pass',
    sidecarPercentValid: 0.95,
    ...over,
    ...key,
    metrics: { ...m, ...metrics },
  };
}

describe('metrics TSV', () => {
  it('formats special numbers BIDS-style and parses them back', () => {
    expect(formatNumber(NaN)).toBe('n/a');
    expect(formatNumber(Infinity)).toBe('inf');
    expect(formatNumber(-Infinity)).toBe('-inf');
    expect(formatNumber(0.1 + 0.2)).toBe('0.30000000000000004');
    for (const v of [NaN, Infinity, -Infinity, 1.5e-12, -3]) {
      expect(Object.is(parseNumber(formatNumber(v)), v)).toBe(true);
    }
  });

  it('round-trips rows, empty fields included', () => {
    const rows = [
      row({}, { snr: 1.25, perfusion: 0.9 }),
      row({ ses: '', run: '', channel: 'respiratory', sidecarAssessment: '', sidecarPercentValid: NaN }, { snr: Infinity }),
    ];
    const text = rowsToTsv(rows);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.split('\n')[2].split('\t')[1]).toBe('n/a');
    expect(parseQualityTsv(text)).toEqual(rows);
  });

  it('finds columns by name, in any order', () => {
    const text = rowsToTsv([row({}, { snr: 2 })]);
    const [header, line] = text.trim().split('\n').map((l) => l.split('\t'));
    const order = header.map((_, i) => i).reverse();
    const shuffled = [order.map((i) => header[i]).join('\t'), order.map((i) => line[i]).join('\t')].join('\n');
    expect(parseQualityTsv(shuffled)[0].metrics.snr).toBe(2);
  });

  it('rejects a TSV without the expected columns', () => {
    expect(() => parseQualityTsv('sub\tchannel\n01\tcardiac\n')).toThrow(/missing columns/);
  });

  it('keeps tabs out of text cells', () => {
    const text = rowsToTsv([row({ filename: 'a\tb' })]);
    expect(text.split('\n')[1].split('\t')).toHaveLength(TSV_HEADER.length);
  });

  it('keys each row by its scan id, with the datatype and the other entities', () => {
    const text = rowsToTsv([row({ datatype: 'eeg', ses: '' })]);
    const [header, line] = text.trim().split('\n').map((l) => l.split('\t'));
    expect(line[header.indexOf('datatype')]).toBe('eeg');
    expect(line[header.indexOf('scan')]).toBe('eeg/sub-01_task-rest_run-01');
    expect(scanId(parseQualityTsv(text)[0])).toBe('eeg/sub-01_task-rest_run-01');
  });

  it('says to compute the metrics again when the TSV is from before scan ids', () => {
    const old = rowsToTsv([row()])
      .split('\n')
      .map((l) => l.split('\t').filter((_, i) => i !== TSV_HEADER.indexOf('scan')).join('\t'))
      .join('\n');
    expect(() => parseQualityTsv(old)).toThrow(/missing columns: scan .*compute-quality-metrics/);
  });

  it('keeps which folder t = 0 refers to (beh/ physio timed by func/ events), and needs that column', () => {
    const beh = row({ datatype: 'beh', t0Datatype: 'func' });
    const text = rowsToTsv([beh]);
    expect(parseQualityTsv(text)[0].t0Datatype).toBe('func');
    const old = text
      .split('\n')
      .map((l) => l.split('\t').filter((_, i) => i !== TSV_HEADER.indexOf('t0_datatype')).join('\t'))
      .join('\n');
    expect(() => parseQualityTsv(old)).toThrow(/missing columns: t0_datatype/);
  });
});

describe('scanTimeReference: what t = 0 is on the Stats waveforms and in the PDF', () => {
  it('follows t0_datatype: scan onset for func/ (and beh/ timed by func/), the recording start otherwise', () => {
    expect(scanTimeReference([row()]).axisLabel).toBe('Time from scan onset (s)');
    expect(scanTimeReference([row({ datatype: 'beh', t0Datatype: 'func' })]).marker).toBe('scan onset (t = 0)');
    expect(scanTimeReference([row({ datatype: 'eeg' })]).axisLabel).toBe('Time from start of the EEG recording (s)');
    expect(scanTimeReference([row({ datatype: 'beh' })]).marker).toBe('start of the behavioural recording (t = 0)');
  });
});

describe('minMaxEnvelope', () => {
  it('keeps each bucket min and max (peaks survive)', () => {
    const values = [0, 0, 10, 0, 0, -5, 0, 0];
    const env = minMaxEnvelope(values, 2);
    expect(env.max).toEqual([10, 0]);
    expect(env.min).toEqual([0, -5]);
    expect(env.centres).toEqual([1.5, 5.5]);
  });

  it('never makes more buckets than samples, and nulls all-NaN buckets', () => {
    expect(minMaxEnvelope([1, 2], 10).max).toEqual([1, 2]);
    expect(minMaxEnvelope([NaN, NaN, 3, 4], 2).min).toEqual([null, 3]);
    expect(minMaxEnvelope([], 5).centres).toEqual([]);
  });

  it('rounds to significant digits', () => {
    expect(roundSig(1.23456789, 3)).toBe(1.23);
    expect(roundSig(NaN)).toBeNaN();
  });
});

describe('stats', () => {
  it('bins finite values with the last bin closed', () => {
    const bins = histogramBins([0, 1, 2, 3, 4, NaN, Infinity], 4);
    expect(bins.map((b) => b.count)).toEqual([1, 1, 1, 2]);
    expect(bins[0].x0).toBe(0);
    expect(bins[3].x1).toBe(4);
  });

  it('widens the range to include a marker', () => {
    const bins = histogramBins([0, 1], 2, 10);
    expect(bins[bins.length - 1].x1).toBe(10);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(2);
  });

  it('handles flat and empty inputs', () => {
    expect(histogramBins([3, 3, 3])).toEqual([{ x0: 2.5, x1: 3.5, count: 3 }]);
    expect(histogramBins([NaN])).toEqual([]);
    expect(paddedExtent([])).toBeNull();
    expect(paddedExtent([2, 2])).toEqual([1.5, 2.5]);
    expect(finiteMean([1, 3, NaN])).toBe(2);
  });

  it('ranks a value with ties counted as half', () => {
    expect(percentileRank([1, 2, 3, 4], 3)).toBe(62.5);
    expect(percentileRank([1, 2], NaN)).toBeNaN();
  });
});

describe('scan links to the Stats tab', () => {
  it('round-trips a scan and builds the Stats address', () => {
    const scan = makeScanKey('eeg', { sub: '01', ses: '02', task: 'rest' });
    expect(scanHash(scan)).toBe('#scan?id=eeg%2Fsub-01_ses-02_task-rest');
    expect(parseScanHash(scanHash(scan))).toEqual(scan);
    expect(statsUrl(scan)).toBe('/quality.html#scan?id=eeg%2Fsub-01_ses-02_task-rest');
    // Explore and Annotate's link names the scan too, so switching tabs keeps it
    expect(viewerUrl(scan)).toBe('/#scan?id=eeg%2Fsub-01_ses-02_task-rest');
    expect(parseScanHash(viewerUrl(scan).slice(1))).toEqual(scan);
  });

  it('has no scan without a valid id (older sub/task links included)', () => {
    expect(parseScanHash('')).toBeNull();
    expect(parseScanHash('#scan')).toBeNull();
    expect(parseScanHash('#group')).toBeNull();
    expect(parseScanHash('#scan?id=../x')).toBeNull();
    expect(parseScanHash('#subject?sub=03&task=rest&run=01')).toBeNull();
  });
});

describe('recordings in the Stats tab', () => {
  const belts = [
    row({ recording: 'belt1', channel: 'respiratory', filename: 'a_recording-belt1_physio.tsv.gz', samplingFrequency: 100 }),
    row({ recording: 'belt2', channel: 'respiratory', filename: 'a_recording-belt2_physio.tsv.gz', samplingFrequency: 100 }),
    row({ recording: 'cardiac', channel: 'cardiac', filename: 'a_recording-cardiac_physio.tsv.gz', samplingFrequency: 25 }),
    row({ sub: '02', recording: 'belt1', channel: 'respiratory' }), // another scan: only one belt
  ];

  it('names a column two recordings of one scan share by its recording, like Explore and Annotate', () => {
    const labelled = labelRecordingChannels(belts);
    expect(labelled.map((r) => r.channel)).toEqual([
      'respiratory (recording-belt1)',
      'respiratory (recording-belt2)',
      'cardiac',
      'respiratory',
    ]);
    expect(labelled[0].column).toBe('respiratory');
    expect(labelled[2].column).toBeUndefined();
  });

  it('lists every file and rate of a split scan', () => {
    const scanRows = belts.slice(0, 3);
    expect(recordingFiles(scanRows)).toBe(
      'a_recording-belt1_physio.tsv.gz, a_recording-belt2_physio.tsv.gz, a_recording-cardiac_physio.tsv.gz',
    );
    expect(recordingRates(scanRows)).toBe('100 Hz, 25 Hz');
  });

  it('round-trips the recording column', () => {
    expect(parseQualityTsv(rowsToTsv(belts)).map((r) => r.recording)).toEqual(['belt1', 'belt2', 'cardiac', 'belt1']);
  });
});

describe('model', () => {
  const rows = [
    row({ sub: '01', channel: 'cardiac', task: 'rest' }, { snr: 1, perfusion: 0.9 }),
    row({ sub: '01', channel: 'respiratory', task: 'rest' }, { snr: 2 }),
    row({ sub: '02', channel: 'cardiac', task: 'motor', sidecarAssessment: 'Fail', timingStatus: 'mismatch' }, { snr: 3 }),
    row({ sub: '02', channel: 'trigger', task: 'motor', sidecarAssessment: '', timingStatus: 'mismatch' }),
  ];

  it('labels every metric from the metric column definitions', () => {
    expect(METRIC_DEFS).toHaveLength(METRIC_COLUMNS.length);
    expect(METRIC_DEFS.find((d) => d.key === 'perfusion')!.label).toBe('Perfusion');
  });

  it('lists scans once each, in order', () => {
    expect(uniqueScans(rows).map((s) => s.sub)).toEqual(['01', '02']);
  });

  it('picks scatter axes that have values', () => {
    expect(availableMetrics(rows)).toEqual(['snr', 'perfusion']);
    expect(defaultMetricPair(rows)).toEqual(['snr', 'perfusion']);
    const onlySnr = rows.filter((r) => r.channel === 'respiratory');
    const [x, y] = defaultMetricPair(onlySnr);
    expect(x).toBe('snr');
    expect(y).not.toBe('snr');
  });

  it('summarises channels and timing per scan', () => {
    expect(channelSummaries(rows, ['cardiac', 'trigger'])).toEqual([
      { channel: 'cardiac', scans: 2, pass: 1, fail: 1, noValues: 0 },
      { channel: 'trigger', scans: 1, pass: 0, fail: 0, noValues: 1 },
    ]);
    expect(timingCounts(rows)).toEqual({ verified: 1, mismatch: 1 });
    expect(colorGroups(rows, 'task')).toEqual(['motor', 'rest']);
    expect(colorGroups(rows, 'sidecarAssessment')).toEqual(['(none)', 'Fail', 'Pass']);
  });

  it('offers only the Colour by choices the dataset has', () => {
    // No sessions, one task, one timing status, no sidecar: nothing to colour by
    const plain = [row({ sub: '01', ses: '', task: 'rest' }), row({ sub: '02', ses: '', task: 'rest' })];
    expect(colorByOptions(plain)).toEqual([]);
    // Two tasks and two sessions: both offered, in the usual order
    const varied = [row({ sub: '01', ses: '01', task: 'rest' }), row({ sub: '01', ses: '02', task: 'motor' })];
    expect(colorByOptions(varied).map((o) => o.key)).toEqual(expect.arrayContaining(['task', 'ses']));
    expect(colorByOptions(varied).map((o) => o.key).slice(0, 2)).toEqual(['task', 'ses']);
    expect(colorKey(plain[0], 'none')).toBe('All recordings');
  });

  it('describes a uniform dataset in one short paragraph', () => {
    const uniform = [
      row({ sub: '01', channel: 'cardiac' }),
      row({ sub: '01', channel: 'respiratory' }),
      row({ sub: '02', channel: 'cardiac' }),
      row({ sub: '02', channel: 'respiratory' }),
    ];
    const text = datasetSummaryText(
      { nSubjects: 2, nScans: 2, tasks: ['rest'], samplingFrequencies: [496], channels: ['cardiac', 'respiratory'] },
      uniform,
    );
    expect(text).toBe(
      'This dataset has 2 scans from 2 subjects, all from the rest task. ' +
        'Physiological signals were sampled at 496 Hz. ' +
        'Cardiac and respiratory are recorded in every scan. ' +
        'Scan-onset timing was confirmed by scanner trigger pulses for all 2 scans.',
    );
  });

  it('ends with the last metrics run when the run log has one', () => {
    const text = datasetSummaryText(
      { nSubjects: 2, nScans: 2, tasks: ['rest'], samplingFrequencies: [496], channels: ['cardiac'] },
      [row({ sub: '01', channel: 'cardiac' }), row({ sub: '02', channel: 'cardiac' })],
      { runDate: '2026-11-05T15:40:12', scansComputed: 2, scansAvailable: 5, scansFailed: 0, countSource: 'git-annex' },
    );
    expect(
      text.endsWith(' Quality metrics were last computed on 2026-11-05 for 2 of 5 physio recordings (3 not downloaded).'),
    ).toBe(true);
  });

  it('spells out mixed tasks, rates, channel coverage and timing', () => {
    const text = datasetSummaryText(
      { nSubjects: 2, nScans: 2, tasks: ['motor', 'rest'], samplingFrequencies: [50, 496], channels: ['cardiac', 'respiratory', 'trigger'] },
      rows,
    );
    expect(text).toContain('2 scans from 2 subjects across 2 tasks (motor and rest).');
    expect(text).toContain('Sampling rates vary between scans (50 Hz and 496 Hz).');
    expect(text).toContain('Recorded channels: cardiac (2 scans), respiratory (1 scan) and trigger (1 scan).');
    expect(text).toContain(
      'Scan-onset timing was confirmed by scanner trigger pulses for 1 scan and inconsistent with the scanner trigger pulses (sidecar timing kept) for 1 scan.',
    );
  });

  it('joins lists in plain English', () => {
    expect(humanList([])).toBe('');
    expect(humanList(['a'])).toBe('a');
    expect(humanList(['a', 'b', 'c'])).toBe('a, b and c');
  });

  it('escapes HTML and formats ordinals', () => {
    expect(esc('<a href="x">')).toBe('&lt;a href=&quot;x&quot;&gt;');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st',
    ]);
  });
});
