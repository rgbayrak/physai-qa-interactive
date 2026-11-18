import { describe, it, expect } from 'vitest';
import {
  analysisSignalOf,
  channelKeys,
  channelTypeTableLines,
  ChannelTypeTable,
  explainChannel,
  classifyChannel,
  isPhysioChannel,
  NON_PHYSIO_CHANNELS,
  parseChannelOverrides,
  PHYSIO_CHANNELS,
} from '../channels';
import type { ChannelOverride, SignalType } from '../channels';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('physio channel dictionary', () => {
  it('accepts every column name found in the local datasets', () => {
    // ds000210, ds006644: cardiac, respiratory (+ trigger)
    // movie10, friends (physprep): PPG, ECG, RSP, EDA, EDATonic, EDAPhasic
    expect(['cardiac', 'respiratory'].map(classifyChannel)).toEqual([
      { physio: true, signal: 'cardiac' },
      { physio: true, signal: 'respiratory' },
    ]);
    expect(['PPG', 'ECG', 'RSP', 'EDA', 'EDATonic', 'EDAPhasic'].map((c) => classifyChannel(c))).toEqual([
      { physio: true, signal: 'cardiac' },
      { physio: true, signal: 'cardiac' },
      { physio: true, signal: 'respiratory' },
      { physio: true, signal: 'electrodermal' },
      { physio: true, signal: 'electrodermal' },
      { physio: true, signal: 'electrodermal' },
    ]);
  });

  it('excludes trigger and other scanner/event columns', () => {
    for (const name of ['trigger', 'Trigger', 'TTL', 'scanner_trigger', 'trigger2', 'stim', 'Marker', 'time', 'Trigger_1']) {
      expect(isPhysioChannel(name), name).toBe(false);
    }
    expect(classifyChannel('trigger')).toEqual({ physio: false, reason: 'scanner trigger' });
    expect(classifyChannel('')).toEqual({ physio: false, reason: 'no column name' });
  });

  it('shows every column not specifically excluded, with no signal type when the name is unknown', () => {
    for (const name of ['mystery', 'constructor', 'ch3', 'ppg_ecg']) {
      expect(classifyChannel(name), name).toEqual({ physio: true, signal: null });
    }
  });

  it('gives a name not known as a whole the one signal type its words say', () => {
    // ds003192 columns: time, respiratory_chest, trigger, cardiac, respiratory_CO2, respiratory_O2
    expect(classifyChannel('respiratory_chest')).toEqual({ physio: true, signal: 'respiratory' });
    expect(classifyChannel('respiratory_CO2')).toEqual({ physio: true, signal: 'gas' });
    expect(classifyChannel('respiratory_O2')).toEqual({ physio: true, signal: 'gas' });
  });

  it('excludes whole names only, so a name containing an excluded word is kept', () => {
    expect(isPhysioChannel('tidal_volume')).toBe(true);
    expect(isPhysioChannel('MR_trigger')).toBe(true);
  });

  it('tolerates case, separators and lead/channel numbers', () => {
    expect(channelKeys('ECG_2')).toEqual(['ecg2', 'ecg']);
    expect(classifyChannel('ECG_2')).toEqual({ physio: true, signal: 'cardiac' });
    expect(classifyChannel('Resp-Belt')).toEqual({ physio: true, signal: 'respiratory' });
    expect(classifyChannel('CO2')).toEqual({ physio: true, signal: 'gas' });
    expect(classifyChannel('etCO2')).toEqual({ physio: true, signal: 'gas' });
  });

  it('keeps the two dictionaries disjoint', () => {
    const overlap = Object.keys(PHYSIO_CHANNELS).filter((k) => k in NON_PHYSIO_CHANNELS);
    expect(overlap).toEqual([]);
  });
});

describe('analysisSignalOf: which metrics and peak detectors a column gets', () => {
  const type = (name: string, overrides?: Map<string, ChannelOverride>) => {
    const c = analysisSignalOf(name, overrides);
    return c.kind === 'signal' ? c.signal : c.kind;
  };

  it('types the common names by their one signal word', () => {
    for (const n of ['PPG', 'ppg2', 'pleth', 'pulse_ox', 'BVP']) expect(type(n)).toBe('ppg');
    for (const n of ['ECG', 'ekg', 'ECG2', 'ecg_1']) expect(type(n)).toBe('ecg');
    for (const n of ['respiratory', 'RSP', 'resp_belt', 'respiratory_chest', 'breathing']) expect(type(n)).toBe('resp');
  });

  it('takes BIDS cardiac (with no second signal word) as PPG, with a note to correct it', () => {
    for (const n of ['cardiac', 'cardiac2', 'cardiac_chest']) {
      const c = analysisSignalOf(n);
      expect(c).toMatchObject({ kind: 'signal', signal: 'ppg', source: 'name' });
      expect(c.kind === 'signal' && c.note).toMatch(/can also be ECG/);
    }
  });

  it('lets a specific cardiac word settle the generic one', () => {
    expect(type('ECG_cardiac')).toBe('ecg');
    expect(type('cardiac_ECG')).toBe('ecg');
    expect(type('cardiac_PPG')).toBe('ppg');
    const c = analysisSignalOf('ECG_cardiac');
    expect(c.kind === 'signal' && c.note).toBeFalsy(); // no assumption to check
  });

  it('calls names of two signal types ambiguous', () => {
    for (const n of ['ppg_ecg', 'pulse_resp', 'ECG_PPG_cardiac', 'ECG_CO2']) expect(type(n)).toBe('ambiguous');
  });

  it('lets a gas word settle a respiration one: CO2 and O2 in the breath are gas, not a belt', () => {
    // ds003192: respiratory_chest (a belt), respiratory_CO2, respiratory_O2
    expect(type('respiratory_chest')).toBe('resp');
    for (const n of ['respiratory_CO2', 'respiratory_O2', 'resp_O2', 'RSP_etCO2']) expect(type(n)).toBe('none');
    expect(analysisSignalOf('respiratory_CO2')).toMatchObject({ kind: 'none', reason: expect.stringMatching(/^gas signal/) });
  });

  it('calls names with no known word unknown', () => {
    for (const n of ['ch3', 'foo', 'chest']) expect(type(n)).toBe('unknown');
  });

  it('gives no analysis, without a warning, to non-physio columns and other known signals', () => {
    for (const n of ['trigger', 'EDA', 'CO2', 'emg']) expect(type(n)).toBe('none');
  });

  it('lets --channel win over the name, including none', () => {
    const o = parseChannelOverrides(['cardiac=ecg', 'respiratory_CO2=resp', 'ch3=none', 'PPG=none']);
    expect(type('cardiac', o)).toBe('ecg');
    expect(type('respiratory_CO2', o)).toBe('resp');
    expect(type('ch3', o)).toBe('none');
    expect(type('PPG', o)).toBe('none');
    expect(analysisSignalOf('cardiac', o)).toMatchObject({ source: 'override' });
  });

  it('rejects a malformed --channel value with the expected form', () => {
    for (const v of ['cardiac', 'cardiac=', '=ppg', 'cardiac=eeg']) {
      expect(() => parseChannelOverrides([v])).toThrow(/<column>=<ppg\|ecg\|resp\|none>/);
    }
    expect(parseChannelOverrides(['a=b=PPG']).get('a=b')).toBe('ppg'); // the last = splits; type is case-insensitive
  });
});

describe('channel types table for a run report', () => {
  it('explains every column: type, why, and whether to check it', () => {
    expect(explainChannel('PPG')).toEqual({ column: 'PPG', type: 'PPG', why: 'name "PPG"', check: false });
    expect(explainChannel('respiratory_chest')).toMatchObject({ type: 'respiration', why: 'word "respiratory"' });
    expect(explainChannel('respiratory_CO2')).toMatchObject({ type: 'gas', why: 'word "CO2" settles "respiratory"; not analysed' });
    expect(explainChannel('ECG_cardiac')).toMatchObject({ type: 'ECG', why: 'word "ECG" settles "cardiac"', check: false });
    expect(explainChannel('cardiac')).toMatchObject({ type: 'PPG', check: true, why: expect.stringContaining('--channel cardiac=ecg') });
    expect(explainChannel('ch3')).toMatchObject({ type: 'skipped', check: true, why: 'no known word; add --channel ch3=ppg|ecg|resp|none' });
    expect(explainChannel('pulse_resp')).toMatchObject({ type: 'skipped', why: expect.stringMatching(/^words of two types: "pulse" \(PPG\), "resp" \(respiration\)/) });
    expect(explainChannel('trigger')).toMatchObject({ type: '—', why: 'non-physio (scanner trigger)', check: false });
    expect(explainChannel('EDA')).toMatchObject({ type: 'electrodermal', why: 'name "EDA"; not analysed' });
    expect(explainChannel('cardiac', new Map([['cardiac', 'ecg']]))).toMatchObject({ type: 'ECG', why: 'set with --channel cardiac=ecg' });
  });

  it('counts each column once per recording, in the order first seen, and prints it aligned with "!" marks', () => {
    const table = new ChannelTypeTable();
    for (const n of ['cardiac', 'trigger', 'cardiac', 'respiratory_CO2']) table.add(n);
    const rows = table.list();
    expect(rows.map((r) => [r.column, r.recordings])).toEqual([['cardiac', 2], ['trigger', 1], ['respiratory_CO2', 1]]);
    const lines = channelTypeTableLines(rows);
    expect(lines[0]).toMatch(/^\s+column\s+type\s+recordings\s+why$/);
    expect(lines[1]).toMatch(/^! cardiac\s+PPG\s+2  assumed:/);
    expect(lines[2]).toMatch(/^  trigger\s+—\s+1  non-physio/);
    // Columns line up: "type" starts at the same place on every line
    const at = lines[0].indexOf('type');
    expect(lines.slice(1).map((l) => l.slice(at, at + 1))).toEqual(['P', '—', 'g']);
    expect(channelTypeTableLines([])).toEqual([]);
  });
});

describe('docs vocabulary table (docs/user-guide/metric-definitions.md, "Recognised words")', () => {
  // The table between the channel-vocabulary markers must list exactly the words of the code
  const doc = readFileSync(join(process.cwd(), 'docs', 'user-guide', 'metric-definitions.md'), 'utf-8');
  const block = doc.split('<!-- channel-vocabulary:start -->')[1]?.split('<!-- channel-vocabulary:end -->')[0] ?? '';
  const documented = new Map<string, string[]>();
  for (const line of block.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 4 || cells[1] === 'Type' || cells[1].startsWith('---')) continue;
    documented.set(cells[1], [...cells[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]).sort());
  }

  const keysOf = (t: SignalType) => Object.keys(PHYSIO_CHANNELS).filter((k) => PHYSIO_CHANNELS[k] === t);
  const expected = new Map<string, string[]>([
    ['PPG', keysOf('cardiac').filter((k) => !['ecg', 'ekg', 'cardiac'].includes(k))],
    ['PPG (assumed)', ['cardiac']],
    ['ECG', ['ecg', 'ekg']],
    ['respiration', keysOf('respiratory')],
    ['electrodermal', keysOf('electrodermal')],
    ['gas', keysOf('gas')],
    ['blood pressure', keysOf('blood_pressure')],
    ['muscle (EMG)', keysOf('muscle')],
    ['non-physio (excluded)', Object.keys(NON_PHYSIO_CHANNELS)],
  ]);

  it('has the table between its markers', () => {
    expect(documented.size).toBeGreaterThan(0);
  });

  it('lists every word of the code under its type, and nothing else', () => {
    expect([...documented.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [type, words] of expected) expect(documented.get(type), type).toEqual([...words].sort());
  });

  it('covers every signal type of the code', () => {
    const signalTypes = new Set(Object.values(PHYSIO_CHANNELS));
    const covered = new Set(['cardiac', 'respiratory', 'electrodermal', 'gas', 'blood_pressure', 'muscle']);
    expect([...signalTypes].filter((t) => !covered.has(t))).toEqual([]);
  });
});
