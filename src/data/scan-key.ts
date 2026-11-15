// Scan identity shared by the dev server, the quality metrics script and the
// pages. Relative imports only: this module is also loaded by Node scripts.
//
// A scan is a physio file's datatype folder plus its entities, without
// recording- and desc- (BIDS physio files: sub-<label>/[ses-<label>/]<datatype>/
// <data file entities>[_recording-<label>]_physio.tsv.gz,
// https://bids-specification.readthedocs.io/en/stable/modality-specific-files/physiological-recordings.html).
// So acq-mb / acq-sb, dir-, and scans without a task (anat, dwi, perf) are
// told apart, and physio in func/ and eeg/ for the same run are two scans.

export interface ScanKeyLike {
  /** datatype/prefix, e.g. func/sub-01_ses-02_task-rest_acq-mb_run-01; the prefix alone outside a datatype folder */
  id: string;
  /** Datatype folder (func, eeg, beh, …); '' when the physio file is in none */
  datatype: string;
  sub: string;
  /** '' when the scan has none, as for task and run */
  ses: string;
  task: string;
  run: string;
  /** Every entity of the scan, in file-name order (recording- and desc- left out) */
  entities: Record<string, string>;
}

/** Entities that name a recording or a processed copy of one scan, not a different scan */
const NOT_SCAN_ENTITIES = new Set(['recording', 'desc']);

/** The scan's entities from a physio file's entities: recording- and desc- removed, order kept */
export function scanEntities(entities: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(entities).filter(([k]) => !NOT_SCAN_ENTITIES.has(k)));
}

/** BIDS-style prefix, e.g. sub-01_ses-02_task-rest_run-01 */
export function scanPrefix(entities: Record<string, string>): string {
  return Object.entries(entities)
    .map(([k, v]) => `${k}-${v}`)
    .join('_');
}

export function makeScanKey(datatype: string, entities: Record<string, string>): ScanKeyLike {
  const prefix = scanPrefix(entities);
  return {
    id: datatype ? `${datatype}/${prefix}` : prefix,
    datatype,
    sub: entities.sub ?? '',
    ses: entities.ses ?? '',
    task: entities.task ?? '',
    run: entities.run ?? '',
    entities: { ...entities },
  };
}

/** A scan from its id; null when the id is not datatype/prefix with a sub- entity */
export function parseScanId(id: string): ScanKeyLike | null {
  const slash = id.indexOf('/');
  const datatype = slash === -1 ? '' : id.slice(0, slash);
  const prefix = slash === -1 ? id : id.slice(slash + 1);
  if (datatype && !/^[a-z]+$/.test(datatype)) return null;
  if (!prefix || prefix.includes('/')) return null;
  const entities: Record<string, string> = {};
  for (const part of prefix.split('_')) {
    const i = part.indexOf('-');
    if (i <= 0 || i === part.length - 1) return null;
    entities[part.slice(0, i)] = part.slice(i + 1);
  }
  return entities.sub ? makeScanKey(datatype, entities) : null;
}

/** The scan's id, e.g. func/sub-01_ses-02_task-rest_run-01 (labels, file names) */
export function scanId(s: ScanKeyLike): string {
  return s.id;
}

export function sameScanKey(a: ScanKeyLike, b: ScanKeyLike): boolean {
  return a.id === b.id;
}

/** Only the key fields of a scan (e.g. of a quality row) */
export function toScanKey(s: ScanKeyLike): ScanKeyLike {
  return makeScanKey(s.datatype, s.entities);
}

// What t = 0 is. BIDS defines a physio file's StartTime "in relation to the
// start of acquisition of the first data sample in the corresponding (neural)
// dataset" (BIDS specification, physiological recordings, StartTime; checked
// on the stable spec page and src/schema/objects/metadata.yaml). The spec does
// not say which data file corresponds; it is taken here to be the data in the
// physio file's own datatype folder: the first BOLD volume for func/, the
// first EEG sample for eeg/, and so on.

/** Datatypes whose data are MRI or PET scans: t = 0 is the scan onset */
const SCAN_DATATYPES = new Set(['func', 'anat', 'dwi', 'perf', 'fmap', 'pet']);

/** Recording names for the other datatypes, as written in the time axis label */
const RECORDING_NAMES: Record<string, string> = {
  eeg: 'EEG',
  meg: 'MEG',
  ieeg: 'iEEG',
  nirs: 'NIRS',
  emg: 'EMG',
  motion: 'motion',
  beh: 'behavioural',
};

/** What t = 0 is for physio in this datatype folder, for axis labels and the t = 0 marker */
export function timeReference(datatype: string): { axisLabel: string; marker: string } {
  if (SCAN_DATATYPES.has(datatype)) return { axisLabel: 'Time from scan onset (s)', marker: 'scan onset (t = 0)' };
  const name = RECORDING_NAMES[datatype];
  const what = name ? `start of the ${name} recording` : 'start of the recording';
  return { axisLabel: `Time from ${what} (s)`, marker: `${what} (t = 0)` };
}
