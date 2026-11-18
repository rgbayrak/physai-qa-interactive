// Which physio.tsv columns are physiological signals. Every column is, unless
// its name is in NON_PHYSIO_CHANNELS (scanner triggers, markers, time stamps):
// those are excluded and reported. PHYSIO_CHANNELS only labels a column's
// signal type; a name it does not know is still shown, with no signal type.
// Relative imports only: this module is also loaded by Node scripts.

export type SignalType =
  | 'cardiac'
  | 'respiratory'
  | 'electrodermal'
  | 'gas'
  | 'blood_pressure'
  | 'muscle';

/**
 * Physiological column names (lower case, no separators; see channelKeys)
 * -> signal type. Labels only: it does not decide which columns are shown.
 * Covers the BIDS
 * recommended names (cardiac, respiratory) and common vendor/toolbox names
 * (e.g. PPG, ECG, RSP, EDA from physprep/NeuroKit).
 */
export const PHYSIO_CHANNELS: Record<string, SignalType> = {
  // cardiac
  cardiac: 'cardiac',
  ppg: 'cardiac',
  pleth: 'cardiac',
  plethysmograph: 'cardiac',
  pulse: 'cardiac',
  puls: 'cardiac',
  pulseox: 'cardiac',
  pulseoximeter: 'cardiac',
  bvp: 'cardiac',
  ecg: 'cardiac',
  ekg: 'cardiac',
  // respiratory
  respiratory: 'respiratory',
  respiration: 'respiratory',
  resp: 'respiratory',
  rsp: 'respiratory',
  breathing: 'respiratory',
  breath: 'respiratory',
  respbelt: 'respiratory',
  belt: 'respiratory',
  // electrodermal
  eda: 'electrodermal',
  edatonic: 'electrodermal',
  edaphasic: 'electrodermal',
  gsr: 'electrodermal',
  scr: 'electrodermal',
  scl: 'electrodermal',
  skinconductance: 'electrodermal',
  // exhaled gas
  co2: 'gas',
  o2: 'gas',
  etco2: 'gas',
  capnography: 'gas',
  // blood pressure
  bp: 'blood_pressure',
  abp: 'blood_pressure',
  bloodpressure: 'blood_pressure',
  // muscle
  emg: 'muscle',
};

/** Non-physiological columns, the only ones excluded (whole name, see channelKeys), each with its reason */
export const NON_PHYSIO_CHANNELS: Record<string, string> = {
  trigger: 'scanner trigger',
  trig: 'scanner trigger',
  ttl: 'scanner trigger',
  scanner: 'scanner trigger',
  scannertrigger: 'scanner trigger',
  volume: 'scanner trigger',
  slice: 'scanner trigger',
  mark: 'scanner/event marker',
  marker: 'scanner/event marker',
  event: 'scanner/event marker',
  stim: 'stimulus channel',
  stimulus: 'stimulus channel',
  digital: 'digital input',
  sync: 'sync signal',
  time: 'time stamp',
  timestamp: 'time stamp',
};

/**
 * Dictionary keys to try for a column name, most specific first: lower case
 * without separators (_ - space .), then also without trailing digits.
 * "ECG_2" -> ["ecg2", "ecg"], "CO2" -> ["co2", "co"].
 */
export function channelKeys(name: string): string[] {
  const full = name.toLowerCase().replace(/[\s_.-]+/g, '');
  const base = full.replace(/\d+$/, '');
  return base && base !== full ? [full, base] : [full];
}

type ChannelClass =
  /** signal is null for a name PHYSIO_CHANNELS does not know */
  | { physio: true; signal: SignalType | null }
  | { physio: false; reason: string };

/** Own-key lookup, so names like "constructor" never hit Object.prototype */
const has = (dict: object, key: string) => Object.prototype.hasOwnProperty.call(dict, key);

/** Physiological unless the name is in NON_PHYSIO_CHANNELS (or empty) */
export function classifyChannel(name: string): ChannelClass {
  const keys = channelKeys(name);
  if (keys[0] === '') return { physio: false, reason: 'no column name' };
  for (const key of keys) {
    if (has(NON_PHYSIO_CHANNELS, key)) return { physio: false, reason: NON_PHYSIO_CHANNELS[key] };
  }
  for (const key of keys) {
    if (has(PHYSIO_CHANNELS, key)) return { physio: true, signal: PHYSIO_CHANNELS[key] };
  }
  // Not a known whole name: its words may still say one type (respiratory_CO2 -> gas)
  return { physio: true, signal: signalTypeFromWords(name) };
}

export function isPhysioChannel(name: string): boolean {
  return classifyChannel(name).physio;
}

// ── Analysis signal: which metrics and peak detectors a column gets ──
// One rule for the quality metrics and the peak detectors. The name is split
// into words (separators _ - . and spaces); each word is looked up as above.
// Exactly one analysed type -> that type; words of two types -> ambiguous;
// no known word -> unknown. Ambiguous and unknown columns are skipped with a
// warning, and the user types them per run with --channel <column>=<type>.

/** Signal types that get metrics or peak detectors */
export type AnalysisSignal = 'ppg' | 'ecg' | 'resp';

/** --channel values: an analysis type, or none to skip the column */
export const CHANNEL_OVERRIDE_TYPES = ['ppg', 'ecg', 'resp', 'none'] as const;
export type ChannelOverride = (typeof CHANNEL_OVERRIDE_TYPES)[number];

export type AnalysisClass =
  /** An analysis type; `note` when it is an assumption the user should check (BIDS cardiac) */
  | { kind: 'signal'; signal: AnalysisSignal; source: 'name' | 'override'; note?: string }
  /** Not analysed and nothing to ask: non-physio columns, other known signals (EDA, gas, …), or --channel …=none */
  | { kind: 'none'; source: 'name' | 'override'; reason: string }
  /** Skipped until the user says what it is */
  | { kind: 'ambiguous' | 'unknown'; reason: string };

/** ECG names among the cardiac ones; the other cardiac names are pulse (PPG) recordings */
const ECG_KEYS = new Set(['ecg', 'ekg']);

/** The generic BIDS name: says cardiac, not whether ECG or PPG */
const GENERIC_CARDIAC = 'cardiac';

/**
 * Word or whole-name keys -> a signal type, splitting cardiac into ECG and PPG
 * ('cardiac' for the generic BIDS word); null for an unknown word
 */
function wordType(word: string): AnalysisSignal | typeof GENERIC_CARDIAC | Exclude<SignalType, 'cardiac' | 'respiratory'> | null {
  for (const key of channelKeys(word)) {
    if (!has(PHYSIO_CHANNELS, key)) continue;
    const t = PHYSIO_CHANNELS[key];
    if (key === GENERIC_CARDIAC) return GENERIC_CARDIAC;
    if (t === 'cardiac') return ECG_KEYS.has(key) ? 'ecg' : 'ppg';
    if (t === 'respiratory') return 'resp';
    return t;
  }
  return null;
}

const isAnalysed = (t: string): t is AnalysisSignal => t === 'ppg' || t === 'ecg' || t === 'resp';

type NameType = NonNullable<ReturnType<typeof wordType>>;

/** The known words of a name with their types: the whole name when it is in the list, else each word */
function nameWords(name: string): { word: string; type: NameType }[] {
  const whole = wordType(name);
  if (whole) return [{ word: name, type: whole }];
  return name
    .split(/[\s_.-]+/)
    .map((word) => ({ word, type: wordType(word) }))
    .filter((h): h is { word: string; type: NameType } => h.type !== null);
}

/**
 * The signal types a column name says, after two rules: a specific cardiac
 * word settles the generic one (ECG_cardiac is ECG, cardiac_PPG is PPG), and a
 * gas word settles a respiration one (respiratory_CO2, resp_O2: gas measured
 * in the breath, not a belt). A whole name in the list (pulseox, respbelt)
 * decides on its own; else each word counts. One entry = a clear type.
 */
function nameTypes(name: string): NameType[] {
  let distinct = [...new Set(nameWords(name).map((h) => h.type))];
  if (distinct.includes(GENERIC_CARDIAC) && (distinct.includes('ecg') || distinct.includes('ppg'))) {
    distinct = distinct.filter((t) => t !== GENERIC_CARDIAC);
  }
  if (distinct.includes('gas') && distinct.includes('resp')) distinct = distinct.filter((t) => t !== 'resp');
  return distinct;
}

/**
 * Signal type of a name not in PHYSIO_CHANNELS as a whole, from its words
 * (nameTypes), so the Stats tab groups e.g. respiratory_CO2 with gas and
 * respiratory_chest with respiratory; null when the words give none or two
 */
function signalTypeFromWords(name: string): SignalType | null {
  const t = nameTypes(name);
  if (t.length !== 1) return null;
  const only = t[0];
  if (only === 'ppg' || only === 'ecg' || only === GENERIC_CARDIAC) return 'cardiac';
  if (only === 'resp') return 'respiratory';
  return only;
}

/**
 * Which analysis a column gets (see the rule above). `overrides` (column name ->
 * type, from --channel) wins. The BIDS `cardiac` column, which BIDS defines
 * only as "continuous pulse measurement", is taken as PPG with a note, so the
 * user can correct it (--channel cardiac=ecg).
 */
export function analysisSignalOf(name: string, overrides: ReadonlyMap<string, ChannelOverride> = new Map()): AnalysisClass {
  const o = overrides.get(name);
  if (o === 'none') return { kind: 'none', source: 'override', reason: 'set to none with --channel' };
  if (o) return { kind: 'signal', signal: o, source: 'override' };

  const c = classifyChannel(name);
  if (!c.physio) return { kind: 'none', source: 'name', reason: c.reason };

  const distinct = nameTypes(name);
  if (distinct.length === 0) return { kind: 'unknown', reason: 'not recognised by name' };
  if (distinct.length > 1) return { kind: 'ambiguous', reason: `name matches more than one signal type (${distinct.join(', ')})` };
  const t = distinct[0];
  if (t === GENERIC_CARDIAC) {
    return { kind: 'signal', signal: 'ppg', source: 'name', note: 'taken as PPG: BIDS "cardiac" is a "continuous pulse measurement", which can also be ECG' };
  }
  if (!isAnalysed(t)) return { kind: 'none', source: 'name', reason: `${t.replace('_', ' ')} signal: no metrics or peak detectors` };
  return { kind: 'signal', signal: t, source: 'name' };
}

/** The analysis type, or null when the column is not analysed (none, ambiguous, unknown) */
export function signalOrNull(c: AnalysisClass): AnalysisSignal | null {
  return c.kind === 'signal' ? c.signal : null;
}

/**
 * Parse --channel values ("<column>=<ppg|ecg|resp|none>"), one per flag.
 * Throws with the expected form for a malformed value or an unknown type.
 */
export function parseChannelOverrides(values: string[]): Map<string, ChannelOverride> {
  const out = new Map<string, ChannelOverride>();
  for (const v of values) {
    const i = v.lastIndexOf('=');
    const column = i > 0 ? v.slice(0, i) : '';
    const type = (i > 0 ? v.slice(i + 1) : '').toLowerCase();
    if (!column || !(CHANNEL_OVERRIDE_TYPES as readonly string[]).includes(type)) {
      throw new Error(`--channel needs <column>=<${CHANNEL_OVERRIDE_TYPES.join('|')}>, got "${v}"`);
    }
    out.set(column, type as ChannelOverride);
  }
  return out;
}

// ── Channel types table: what each column was taken as, and why ──
// Printed by compute-quality-metrics.ts and compute-peaks.ts before computing,
// and saved with their outputs, so a run's mapping can be checked afterwards.

/** One row of the table: a column name as the sidecars list it */
export interface ChannelTypeRow {
  column: string;
  /** PPG, ECG, respiration, gas, …; "skipped" for ambiguous or unknown; "—" for non-physio or --channel …=none */
  type: string;
  /** Why, in words, with the --channel fix where the user may need it */
  why: string;
  /** Whether the user should look at it: an assumption (cardiac) or a skipped column */
  check: boolean;
  /** Recordings (physio files) with this column in the scans of the run */
  recordings: number;
}

const TYPE_LABEL: Record<string, string> = {
  ppg: 'PPG',
  ecg: 'ECG',
  resp: 'respiration',
  [GENERIC_CARDIAC]: 'PPG',
  gas: 'gas',
  electrodermal: 'electrodermal',
  blood_pressure: 'blood pressure',
  muscle: 'muscle (EMG)',
};

const fix = (column: string) => `add --channel ${column}=ppg|ecg|resp|none`;

/** The type and the reason for one column name (no recordings count); see analysisSignalOf */
export function explainChannel(
  column: string,
  overrides: ReadonlyMap<string, ChannelOverride> = new Map(),
): Omit<ChannelTypeRow, 'recordings'> {
  const o = overrides.get(column);
  if (o) return { column, type: o === 'none' ? '—' : TYPE_LABEL[o], why: `set with --channel ${column}=${o}`, check: false };
  const c = classifyChannel(column);
  if (!c.physio) return { column, type: '—', why: `non-physio (${c.reason})`, check: false };

  const hits = nameWords(column);
  const types = nameTypes(column);
  if (types.length === 0) return { column, type: 'skipped', why: `no known word; ${fix(column)}`, check: true };
  if (types.length > 1) {
    const words = hits.map((h) => `"${h.word}" (${TYPE_LABEL[h.type]})`).join(', ');
    return { column, type: 'skipped', why: `words of two types: ${words}; ${fix(column)}`, check: true };
  }
  const t = types[0];
  const label = TYPE_LABEL[t];
  const notAnalysed = isAnalysed(t) || t === GENERIC_CARDIAC ? '' : '; not analysed';
  if (t === GENERIC_CARDIAC) {
    return { column, type: label, why: `assumed: BIDS "cardiac" can be PPG or ECG; add --channel ${column}=ecg if ECG`, check: true };
  }
  const deciding = hits.filter((h) => h.type === t).map((h) => `"${h.word}"`);
  const settled = hits.filter((h) => h.type !== t).map((h) => `"${h.word}"`);
  const what = hits.length === 1 && hits[0].word === column ? `name ${deciding[0]}` : `word ${deciding.join(', ')}`;
  return { column, type: label, why: `${what}${settled.length ? ` settles ${settled.join(', ')}` : ''}${notAnalysed}`, check: false };
}

/** Collects a run's table: one row per column name, counting the recordings, in the order first seen */
export class ChannelTypeTable {
  private readonly rows = new Map<string, ChannelTypeRow>();

  constructor(private readonly overrides: ReadonlyMap<string, ChannelOverride> = new Map()) {}

  add(column: string): void {
    const prev = this.rows.get(column);
    if (prev) prev.recordings++;
    else this.rows.set(column, { ...explainChannel(column, this.overrides), recordings: 1 });
  }

  list(): ChannelTypeRow[] {
    return [...this.rows.values()];
  }
}

/** The table as aligned text lines, with a header; "!" marks the rows to check */
export function channelTypeTableLines(rows: ChannelTypeRow[]): string[] {
  if (rows.length === 0) return [];
  const head = { column: 'column', type: 'type', recordings: 'recordings', why: 'why' };
  const w = {
    column: Math.max(head.column.length, ...rows.map((r) => r.column.length)),
    type: Math.max(head.type.length, ...rows.map((r) => r.type.length)),
    recordings: head.recordings.length,
  };
  const line = (mark: string, column: string, type: string, rec: string, why: string) =>
    `${mark} ${column.padEnd(w.column)}  ${type.padEnd(w.type)}  ${rec.padStart(w.recordings)}  ${why}`;
  return [
    line(' ', head.column, head.type, head.recordings, head.why),
    ...rows.map((r) => line(r.check ? '!' : ' ', r.column, r.type, String(r.recordings), r.why)),
  ];
}
