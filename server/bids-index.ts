import { accessSync, closeSync, constants, openSync, readdirSync, readFileSync, readSync } from 'fs';
import type { Dirent } from 'fs';
import { basename, dirname, join, relative, resolve, sep } from 'path';
import { makeScanKey, scanEntities } from '../src/data/scan-key';
import type { ScanKeyLike } from '../src/data/scan-key';

// One walk over the BIDS folders, done once at start-up. Files are found by
// their names wherever they sit (any datatype folder, extra levels, raw or
// derivatives), not at fixed paths. Only names are read during the walk, plus
// each dataset_description.json's DatasetType and the first bytes of each
// physio file (hasPhysioContent), so it works on DataLad datasets whose files
// are not downloaded: only physio files whose content is here become scans.
// Spec: https://bids-specification.readthedocs.io/en/stable/modality-specific-files/physiological-recordings.html

/** BIDS datatype folders; a file's datatype is the nearest of these above it */
const DATATYPES = new Set([
  'anat', 'beh', 'dwi', 'eeg', 'emg', 'fmap', 'func', 'ieeg', 'meg', 'micr', 'motion', 'mrs', 'nirs', 'perf', 'pet',
]);

/** Folders never walked: hidden ones (.git, .datalad) are skipped by name */
const SKIP_DIRS = new Set(['sourcedata', 'code']);

/**
 * Per-volume confounds TSVs (plain or gzipped), in order of preference:
 * fMRIPrep ≥ 20.2, fMRIPrep 1.4–20.1, fMRIPrep < 1.4, then MRIQC's
 * *_timeseries.tsv (same column names: framewise_displacement, rot_x, …).
 */
export const CONFOUNDS_PATTERNS = [
  /_desc-confounds_timeseries\.tsv(\.gz)?$/,
  /_desc-confounds_regressors\.tsv(\.gz)?$/,
  /_bold_confounds\.tsv(\.gz)?$/,
  /_timeseries\.tsv(\.gz)?$/,
];

export type FileKind = 'physio' | 'physioSidecar' | 'physioEvents' | 'quality' | 'bold' | 'confounds' | 'events';

function classify(name: string): FileKind | null {
  // BIDS names physio files *_physio.tsv.gz; an uncompressed *_physio.tsv (outside BIDS) is read too
  if (/_physio\.tsv(\.gz)?$/.test(name)) return 'physio';
  if (/_physio\.json$/.test(name)) return 'physioSidecar';
  if (/_physioevents\.(tsv\.gz|json)$/.test(name)) return 'physioEvents';
  if (/_desc-quality\.json$/.test(name)) return 'quality';
  if (/_bold\.json$/.test(name)) return 'bold';
  if (/_events\.tsv$/.test(name)) return 'events';
  if (CONFOUNDS_PATTERNS.some((p) => p.test(name))) return 'confounds';
  return null;
}

export interface IndexedDataset {
  /** Folder with the dataset_description.json, or a given root / derivatives/<pipeline> folder without one */
  root: string;
  /** DatasetType from the description; without one, derivative inside derivatives/ or for BIDSDER_ROOT, else raw */
  type: 'raw' | 'derivative';
  /** The BIDS_ROOT dataset */
  main: boolean;
}

export interface IndexedFile {
  path: string;
  name: string;
  dir: string;
  /** The given folder whose walk found this file */
  root: string;
  kind: FileKind;
  /** key-label pairs from the name (run-1 → { run: '1' }); parts without a '-' are left out */
  entities: Record<string, string>;
  suffix: string;
  extension: string;
  /** Nearest datatype folder above the file (func, eeg, beh, …), or null */
  datatype: string | null;
  dataset: IndexedDataset;
  /** Physio only: the content can be read (not a dangling git-annex link). Other kinds are checked when read */
  readable: boolean;
}

export interface IndexRoots {
  /** Main BIDS folder (BIDS_ROOT) */
  bidsRoot: string;
  /** Extra folder walked for physio stored outside the main folder (BIDSPHYS_ROOT) */
  physioRoot?: string;
  /** Extra folder walked for derivatives stored outside the main folder (BIDSDER_ROOT) */
  derivRoot?: string;
}

export interface DuplicatePhysio {
  /** The file loaded for one recording of the scan */
  chosen: IndexedFile;
  /** Other readable physio files of the same scan and recording (a desc-preproc copy, another folder), not loaded */
  others: IndexedFile[];
}

export interface BidsIndex extends IndexRoots {
  /** Folders walked, in order */
  walked: string[];
  /** Missing folders and similar, for the start-up log */
  notes: string[];
  datasets: IndexedDataset[];
  files: IndexedFile[];
  /** Files by kind, sub and ses ('' when the name has none) */
  byKey: Map<string, IndexedFile[]>;
  /**
   * The physio files loaded for each scan, by scan id (scanOf(file).id): one
   * per recording- label ('' for a file without one first, then label order).
   * Never empty. See scanFile for the file that stands for the whole scan.
   */
  scans: Map<string, IndexedFile[]>;
  duplicates: DuplicatePhysio[];
  /** Readable physio without a sub- entity: not a scan */
  unkeyed: IndexedFile[];
  stats: {
    dirs: number;
    ms: number;
    /** Readable physio files per datatype folder ('none' outside one) */
    physioByDatatype: Record<string, number>;
    /**
     * Physio recordings the dataset lists, downloaded or not: distinct scan +
     * recording- label among physio files with sub- (BIDS: one file per
     * recording; copies of one recording, e.g. raw and desc-preproc, count once)
     */
    physioRecordings: number;
    unreadablePhysio: number;
    physioEvents: number;
  };
}

/** Check if a path is actually readable (resolves symlinks, not a broken annex pointer) */
export function isReadable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * True when a physio file's content is on disk: readable (not a dangling
 * git-annex symlink, DataLad's default for a file never fetched with datalad
 * get), not empty, and for *.tsv.gz starting with the gzip magic bytes 1f 8b
 * (RFC 1952); a plain *.tsv must not be a git-annex pointer file, the small
 * text file "/annex/objects/<key>" an unlocked dataset keeps in place of
 * content not fetched (git-annex documentation, "unlocked files"; unverified,
 * from memory). Sidecars (*.json) are not checked: DataLad keeps them in git,
 * so they are always here and never tell whether the data is.
 */
export function hasPhysioContent(path: string): boolean {
  if (!isReadable(path)) return false;
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(15);
    const n = readSync(fd, buf, 0, buf.length, 0);
    if (path.endsWith('.gz')) return n >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
    return n > 0 && !buf.subarray(0, n).toString('latin1').startsWith('/annex/objects/');
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * Entities, suffix and extension of a file name. Lenient, unlike
 * parseBidsName (server/bids-structure.ts), which validates: parts without a
 * '-' (preproc_physio.json, …_bold_confounds.tsv) do not reject the name, and
 * the suffix is the last of them ('' for …_desc-quality.json).
 */
export function nameEntities(name: string): { entities: Record<string, string>; suffix: string; extension: string } {
  const dot = name.indexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  const entities: Record<string, string> = {};
  let suffix = '';
  for (const part of stem.split('_')) {
    const i = part.indexOf('-');
    if (i > 0 && i < part.length - 1) entities[part.slice(0, i)] = part.slice(i + 1);
    else suffix = part;
  }
  return { entities, suffix, extension };
}

/** run is a BIDS index: run-01 and run-1 are the same run */
export function normRun(run: string): string {
  return /^\d+$/.test(run) ? String(Number(run)) : run;
}

function sameLabel(key: string, a: string, b: string): boolean {
  return key === 'run' ? normRun(a) === normRun(b) : a === b;
}

/**
 * Every entity of `sub` is in `sup` with the same label (whole labels, so
 * task-rest never matches task-resting; run compared as a number, so run-1
 * matches run-01 but not run-10).
 */
export function entitiesMatch(sub: Record<string, string>, sup: Record<string, string>): boolean {
  return Object.entries(sub).every(([k, v]) => k in sup && sameLabel(k, v, sup[k]));
}

/** The scan a physio file belongs to: its datatype folder and entities without recording- and desc- */
export function scanOf(file: IndexedFile): ScanKeyLike {
  return makeScanKey(file.datatype ?? '', scanEntities(file.entities));
}

/** Grouping key of a scan: like its id, but run compared as a number (run-1 and run-01 are one scan) */
function groupKey(scan: ScanKeyLike): string {
  const parts = Object.entries(scan.entities).map(([k, v]) => `${k}-${k === 'run' ? normRun(v) : v}`);
  return [scan.datatype, ...parts].join('\0');
}

const fileKey = (kind: FileKind, sub: string, ses: string) => `${kind}\0${sub}\0${ses}`;

const byNumeric = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** DatasetType of a dataset_description.json, or null when it is missing, not downloaded or has none */
function declaredType(descriptionPath: string): string | null {
  if (!isReadable(descriptionPath)) return null;
  try {
    const t = JSON.parse(readFileSync(descriptionPath, 'utf-8')).DatasetType;
    return typeof t === 'string' ? t : null;
  } catch {
    return null;
  }
}

/**
 * Walk the main BIDS folder, then the extra physio and derivatives folders
 * (each walked once, even when one is inside another), and index the files
 * the viewer reads. Folder symlinks are not followed; file symlinks (git-annex)
 * are indexed by name.
 */
export function buildBidsIndex(roots: IndexRoots): BidsIndex {
  const started = Date.now();
  const files: IndexedFile[] = [];
  const datasets: IndexedDataset[] = [];
  const notes: string[] = [];
  const walked: string[] = [];
  const visited = new Set<string>();
  let dirs = 0;

  const given: [string, string | undefined][] = [
    ['BIDS_ROOT', roots.bidsRoot],
    ['BIDSPHYS_ROOT', roots.physioRoot],
    ['BIDSDER_ROOT', roots.derivRoot],
  ];

  const walk = (dir: string, root: string, dataset: IndexedDataset | null, datatype: string | null) => {
    if (visited.has(dir)) return;
    visited.add(dir);
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    dirs++;
    const hasDescription = entries.some((e) => e.name === 'dataset_description.json' && !e.isDirectory());
    if (!dataset || hasDescription || basename(dirname(dir)) === 'derivatives') {
      const declared = hasDescription ? declaredType(join(dir, 'dataset_description.json')) : null;
      const derivative = declared
        ? declared === 'derivative'
        : basename(dirname(dir)) === 'derivatives' || dir === roots.derivRoot;
      dataset = { root: dir, type: derivative ? 'derivative' : 'raw', main: dir === roots.bidsRoot };
      datasets.push(dataset);
      datatype = null;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const path = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path, root, dataset, DATATYPES.has(e.name) ? e.name : datatype);
        continue;
      }
      // Files and symlinks: a folder symlink is never walked, and is only indexed if named like a data file
      const kind = classify(e.name);
      if (!kind) continue;
      files.push({
        path,
        name: e.name,
        dir,
        root,
        kind,
        ...nameEntities(e.name),
        datatype,
        dataset,
        readable: kind === 'physio' ? hasPhysioContent(path) : true,
      });
    }
  };

  for (const [label, root] of given) {
    if (!root) continue;
    if (visited.has(root)) continue;
    let exists = true;
    try {
      readdirSync(root);
    } catch {
      exists = false;
    }
    if (!exists) {
      notes.push(`${label} ${root} does not exist (check the path, or install the DataLad subdataset with datalad get -n)`);
      if (label === 'BIDS_ROOT') datasets.push({ root, type: 'raw', main: true });
      continue;
    }
    walked.push(root);
    walk(root, root, null, null);
  }

  files.sort((a, b) => byNumeric(a.path, b.path));
  const byKey = new Map<string, IndexedFile[]>();
  for (const f of files) {
    const key = fileKey(f.kind, f.entities.sub ?? '', f.entities.ses ?? '');
    const list = byKey.get(key);
    if (list) list.push(f);
    else byKey.set(key, [f]);
  }

  const { scans, duplicates, unkeyed } = selectScanFiles(files, roots.physioRoot);
  const physioByDatatype: Record<string, number> = {};
  for (const f of files) {
    if (f.kind === 'physio' && f.readable) {
      const dt = f.datatype ?? 'none';
      physioByDatatype[dt] = (physioByDatatype[dt] ?? 0) + 1;
    }
  }

  return {
    ...roots,
    walked,
    notes,
    datasets,
    files,
    byKey,
    scans,
    duplicates,
    unkeyed,
    stats: {
      dirs,
      ms: Date.now() - started,
      physioByDatatype,
      physioRecordings: new Set(
        files
          .filter((f) => f.kind === 'physio' && f.entities.sub)
          .map((f) => `${groupKey(scanOf(f))}\0${recordingOf(f)}`),
      ).size,
      unreadablePhysio: files.filter((f) => f.kind === 'physio' && !f.readable).length,
      physioEvents: files.filter((f) => f.kind === 'physioEvents').length,
    },
  };
}

/**
 * Preference among physio files of one scan and recording (user decision,
 * 2026-11-16): the physio folder the user gave wins. With BIDSPHYS_ROOT, a file
 * under it first (e.g. CNeuroMod physprep over the raw copy); then a file of
 * the BIDS_ROOT dataset itself, over copies in its derivatives/ (so with
 * BIDS_ROOT alone, its own raw file wins). Ties: desc-preproc, then .tsv.gz
 * (the BIDS extension) over .tsv, then name, then path.
 */
function physioPreference(physioRoot: string | undefined) {
  const physioDir = physioRoot ? resolve(physioRoot) + sep : null;
  const given = (f: IndexedFile) => Number(physioDir !== null && resolve(f.path).startsWith(physioDir));
  const main = (f: IndexedFile) => Number(f.dataset?.main === true);
  return (a: IndexedFile, b: IndexedFile): number =>
    given(b) - given(a) ||
    main(b) - main(a) ||
    Number(b.entities.desc === 'preproc') - Number(a.entities.desc === 'preproc') ||
    Number(b.name.endsWith('.gz')) - Number(a.name.endsWith('.gz')) ||
    byNumeric(a.name, b.name) ||
    byNumeric(a.path, b.path);
}

/** A physio file's recording- label; '' when it has none */
export const recordingOf = (f: IndexedFile): string => f.entities.recording ?? '';

/**
 * The physio files of each scan (see scanOf): readable files with a sub-
 * entity. Physio in two datatype folders (func/ and eeg/ in EEG-fMRI) is two
 * scans. Within a scan, BIDS splits signals with different sampling rates or
 * devices into recording-<label> files: every recording is loaded, one file
 * each. Other files of the same recording (a desc-preproc copy, the same file
 * in another folder) are kept in duplicates for the log; which one is loaded:
 * physioPreference (BIDSPHYS_ROOT, when given, wins).
 */
function selectScanFiles(files: IndexedFile[], physioRoot?: string) {
  const preference = physioPreference(physioRoot);
  const groups = new Map<string, IndexedFile[]>();
  const unkeyed: IndexedFile[] = [];
  for (const f of files) {
    if (f.kind !== 'physio' || !f.readable) continue;
    if (!f.entities.sub) {
      unkeyed.push(f);
      continue;
    }
    const key = groupKey(scanOf(f));
    const list = groups.get(key);
    if (list) list.push(f);
    else groups.set(key, [f]);
  }
  const scans = new Map<string, IndexedFile[]>();
  const duplicates: DuplicatePhysio[] = [];
  for (const list of groups.values()) {
    const byRecording = new Map<string, IndexedFile[]>();
    for (const f of list) {
      const files = byRecording.get(recordingOf(f));
      if (files) files.push(f);
      else byRecording.set(recordingOf(f), [f]);
    }
    const recordings: IndexedFile[] = [];
    for (const label of [...byRecording.keys()].sort(byNumeric)) {
      const [chosen, ...others] = byRecording.get(label)!.sort(preference);
      recordings.push(chosen);
      if (others.length) duplicates.push({ chosen, others });
    }
    scans.set(scanOf(recordings[0]).id, recordings);
  }
  return { scans, duplicates, unkeyed };
}

/** The scan's physio files, one per recording; empty for an unknown id */
export function scanRecordings(index: BidsIndex, scanId: string): IndexedFile[] {
  return index.scans.get(scanId) ?? [];
}

/**
 * The file that stands for the whole scan where one is needed (its folder,
 * datatype and dataset, shared by its recordings): the first recording
 */
export function scanFile(index: BidsIndex, scanId: string): IndexedFile | undefined {
  return index.scans.get(scanId)?.[0];
}

/**
 * Files of one kind whose sub and ses can apply to the given ones: the same
 * sub/ses, subject-level files (no ses), and top-level files (no sub).
 */
export function candidates(index: BidsIndex, kind: FileKind, sub: string, ses: string): IndexedFile[] {
  const keys = new Set([fileKey(kind, sub, ses), fileKey(kind, sub, ''), fileKey(kind, '', ses), fileKey(kind, '', '')]);
  return [...keys].flatMap((k) => index.byKey.get(k) ?? []);
}

/** dir is `ancestor` or inside it */
function isWithin(dir: string, ancestor: string): boolean {
  return dir === ancestor || dir.startsWith(ancestor + sep);
}

const depth = (dir: string) => dir.split(sep).length;

/**
 * The physio file's sidecar by BIDS inheritance: every *_physio.json of the
 * same dataset in the file's folder or above whose entities are a subset of
 * the file's (recording- and desc- included, so a recording-cardiac sidecar
 * applies only to that recording). Values are merged from the top-level file
 * down to the nearest, most specific one, which wins. Null if there is none.
 */
export function inheritedSidecar(
  index: BidsIndex,
  file: IndexedFile,
): { paths: string[]; values: Record<string, unknown> } | null {
  const { sub = '', ses = '' } = file.entities;
  const applicable = candidates(index, 'physioSidecar', sub, ses)
    .filter(
      (s) =>
        s.dataset === file.dataset &&
        isWithin(file.dir, s.dir) &&
        entitiesMatch(s.entities, file.entities) &&
        isReadable(s.path),
    )
    .sort(
      (a, b) =>
        depth(a.dir) - depth(b.dir) ||
        Object.keys(a.entities).length - Object.keys(b.entities).length ||
        byNumeric(a.name, b.name),
    );
  if (applicable.length === 0) return null;
  const values: Record<string, unknown> = {};
  for (const s of applicable) Object.assign(values, JSON.parse(readFileSync(s.path, 'utf-8')));
  return { paths: applicable.map((s) => s.path), values };
}

/** Entities without desc- (desc-preproc physio, desc-confounds, desc-quality) */
export function withoutDesc(entities: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(entities).filter(([k]) => k !== 'desc'));
}

/**
 * The physio file's *_desc-quality.json: same dataset, entities (desc- aside)
 * a subset of the file's; the most specific wins (run-level before run-less),
 * then the nearest. Null if there is none.
 */
export function qualitySidecar(index: BidsIndex, file: IndexedFile): string | null {
  const { sub = '', ses = '' } = file.entities;
  const own = withoutDesc(file.entities);
  const found = candidates(index, 'quality', sub, ses)
    .filter((q) => q.dataset === file.dataset && entitiesMatch(withoutDesc(q.entities), own) && isReadable(q.path))
    .sort(
      (a, b) =>
        Object.keys(b.entities).length - Object.keys(a.entities).length ||
        Number(b.dir === file.dir) - Number(a.dir === file.dir) ||
        byNumeric(a.path, b.path),
    );
  return found[0]?.path ?? null;
}

/**
 * Physio files not downloaded, one line per folder setting, e.g.
 * "in BIDS_ROOT = 354 physio files listed but not downloaded (skipped)" and
 * "in BIDSPHYS_ROOT = 235 …": with BIDSPHYS_ROOT the folders add up, so one
 * total would hide which folder is missing files. A file counts for the
 * innermost folder setting it is under (BIDSPHYS_ROOT inside BIDS_ROOT counts
 * as BIDSPHYS_ROOT); a setting with none missing gets no line. When some of
 * the setting's physio files are downloaded, the count says "other" ("235
 * other physio files …"): those are skipped, the rest are loaded.
 */
function notDownloadedLines(index: BidsIndex): string[] {
  const settings = (
    [
      ['BIDS_ROOT', index.bidsRoot],
      ['BIDSPHYS_ROOT', index.physioRoot],
      ['BIDSDER_ROOT', index.derivRoot],
    ] as const
  ).flatMap(([label, root]) => (root ? [{ label, dir: resolve(root) + sep, listed: 0, missing: 0 }] : []));
  for (const f of index.files) {
    if (f.kind !== 'physio') continue;
    const path = resolve(f.path);
    const inside = settings.filter((s) => path.startsWith(s.dir));
    if (!inside.length) continue;
    const s = inside.reduce((a, b) => (b.dir.length > a.dir.length ? b : a));
    s.listed++;
    if (!f.readable) s.missing++;
  }
  return settings
    .filter((s) => s.missing > 0)
    .map(
      (s) =>
        `in ${s.label} = ${s.missing} ${s.missing < s.listed ? 'other ' : ''}physio files listed but not downloaded (skipped)`,
    );
}

/** Start-up log lines: folders walked, walk time, physio per datatype, files skipped or not loaded */
export function indexSummaryLines(index: BidsIndex): string[] {
  const lines = [
    `Walked ${index.walked.length ? index.walked.join(', ') : 'no folders'} (${index.stats.dirs} folders, ${index.stats.ms} ms)`,
    ...index.notes,
  ];
  const perType = Object.entries(index.stats.physioByDatatype)
    .sort((a, b) => byNumeric(a[0], b[0]))
    .map(([dt, n]) => `${n} in ${dt === 'none' ? 'no datatype folder' : `${dt}/`}`);
  lines.push(`Readable physio files: ${perType.length ? perType.join(', ') : 'none'}`);
  if (index.stats.unreadablePhysio) lines.push(...notDownloadedLines(index));
  if (index.stats.physioEvents) lines.push(`${index.stats.physioEvents} physioevents files recognised and skipped`);
  if (index.unkeyed.length) {
    lines.push(
      `${index.unkeyed.length} physio files without sub- not loaded (e.g. ${relative(index.unkeyed[0].root, index.unkeyed[0].path)})`,
    );
  }
  const split = [...index.scans.values()].filter((r) => r.length > 1).length;
  if (split) lines.push(`${split} scans split into recording- files (each recording loaded)`);
  for (const d of index.duplicates) {
    lines.push(
      `${relative(d.chosen.root, d.chosen.path)} loaded; same recording not loaded: ${d.others.map((o) => relative(o.root, o.path)).join(', ')}`,
    );
  }
  return lines;
}
