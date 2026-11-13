import { accessSync, constants, readdirSync, readFileSync } from 'fs';
import type { Dirent } from 'fs';
import { basename, dirname, join, relative, sep } from 'path';

// One walk over the BIDS folders, done once at start-up. Files are found by
// their names wherever they sit (any datatype folder, extra levels, raw or
// derivatives), not at fixed paths. Only names are read during the walk, plus
// each dataset_description.json's DatasetType and an access check on physio
// files, so it works on DataLad datasets whose files are not downloaded.
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
  if (/_physio\.tsv\.gz$/.test(name)) return 'physio';
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
  /** The file loaded for the scan */
  chosen: IndexedFile;
  /** Other readable physio files with the same sub/ses/task/run (e.g. recording-…), not loaded yet */
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
  /** The physio file loaded for each scan, by scanKey(sub, ses, task, run) */
  scans: Map<string, IndexedFile>;
  duplicates: DuplicatePhysio[];
  /** Readable physio without a sub- or task- entity: not a scan yet */
  unkeyed: IndexedFile[];
  stats: {
    dirs: number;
    ms: number;
    /** Readable physio files per datatype folder ('none' outside one) */
    physioByDatatype: Record<string, number>;
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

/** Map key of a scan; '' for no session or no run */
export function scanKey(sub: string, ses: string, task: string, run: string): string {
  return [sub, ses, task, normRun(run)].join('\0');
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
        readable: kind === 'physio' ? isReadable(path) : true,
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

  const { scans, duplicates, unkeyed } = selectScanFiles(files);
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
      unreadablePhysio: files.filter((f) => f.kind === 'physio' && !f.readable).length,
      physioEvents: files.filter((f) => f.kind === 'physioEvents').length,
    },
  };
}

/** Preference among physio files of one scan: func folder first, then desc-preproc, then name, then path */
function physioPreference(a: IndexedFile, b: IndexedFile): number {
  const func = Number(b.datatype === 'func') - Number(a.datatype === 'func');
  if (func) return func;
  const preproc = Number(b.entities.desc === 'preproc') - Number(a.entities.desc === 'preproc');
  if (preproc) return preproc;
  return byNumeric(a.name, b.name) || byNumeric(a.path, b.path);
}

/**
 * One physio file per sub/ses/task/run: readable files with sub- and task-.
 * The others of a scan (several recording- files, the same run in two
 * datatype folders) are kept in duplicates for the log.
 */
function selectScanFiles(files: IndexedFile[]) {
  const groups = new Map<string, IndexedFile[]>();
  const unkeyed: IndexedFile[] = [];
  for (const f of files) {
    if (f.kind !== 'physio' || !f.readable) continue;
    const { sub, ses = '', task, run = '' } = f.entities;
    if (!sub || !task) {
      unkeyed.push(f);
      continue;
    }
    const key = scanKey(sub, ses, task, run);
    const list = groups.get(key);
    if (list) list.push(f);
    else groups.set(key, [f]);
  }
  const scans = new Map<string, IndexedFile>();
  const duplicates: DuplicatePhysio[] = [];
  for (const [key, list] of groups) {
    const [chosen, ...others] = [...list].sort(physioPreference);
    scans.set(key, chosen);
    if (others.length) duplicates.push({ chosen, others });
  }
  return { scans, duplicates, unkeyed };
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
  if (index.stats.unreadablePhysio) lines.push(`${index.stats.unreadablePhysio} physio files listed but not downloaded (skipped)`);
  if (index.stats.physioEvents) lines.push(`${index.stats.physioEvents} physioevents files recognised and skipped`);
  if (index.unkeyed.length) {
    lines.push(
      `${index.unkeyed.length} physio files without sub- or task- not loaded (e.g. ${relative(index.unkeyed[0].root, index.unkeyed[0].path)})`,
    );
  }
  for (const d of index.duplicates) {
    lines.push(
      `${relative(d.chosen.root, d.chosen.path)} loaded; same scan not loaded yet: ${d.others.map((o) => relative(o.root, o.path)).join(', ')}`,
    );
  }
  return lines;
}
