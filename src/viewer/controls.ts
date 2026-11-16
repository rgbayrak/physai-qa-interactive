import type { PhysioRaw, PhysioScan, ScanEntry } from '@/data/bids-physio-reader';
import { isPhysioChannel } from '@/quality/channels';
import { channelLabel, clashingNames, parseRefKey, refKey } from '@/data/recordings';
import type { ChannelRef } from '@/data/recordings';

/**
 * Columns of a physio file to offer as channels: every column except those
 * the quality metrics script also excludes (trigger, time and other names in
 * NON_PHYSIO_CHANNELS, src/quality/channels.ts). If that leaves none, every
 * column is offered so the viewer still shows something.
 */
export function physioColumns(columns: string[]): string[] {
  const physio = columns.filter(isPhysioChannel);
  return physio.length > 0 ? physio : columns;
}

/** The channels a scan offers, across its recordings (in recording order), with their keys and shown names */
export function scanChannels(scan: PhysioScan): { key: string; ref: ChannelRef; label: string }[] {
  const perRecording = scan.recordings.map((r) => ({ recording: r.recording ?? '', channels: physioColumns(r.columns) }));
  const clashes = clashingNames(perRecording);
  return perRecording.flatMap(({ recording, channels }) =>
    channels.map((channel) => {
      const ref = { recording, channel };
      return { key: refKey(ref), ref, label: channelLabel(ref, clashes) };
    }),
  );
}

/** The recording a channel key is in, or undefined when the scan has none such */
export function recordingFor(scan: PhysioScan, key: string): PhysioRaw | undefined {
  const ref = parseRefKey(key);
  return scan.recordings.find((r) => (r.recording ?? '') === ref.recording && r.columns.includes(ref.channel));
}

/** Options with their values; `labels` gives the shown text where it differs from the value */
export function populateSelect(
  el: HTMLSelectElement,
  values: string[],
  selected?: string,
  labels?: (value: string) => string,
): void {
  el.innerHTML = '';
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = labels ? labels(v) : v;
    if (v === selected) opt.selected = true;
    el.appendChild(opt);
  }
}

// ── Scan dropdowns: Subject, Session, Task, Run, then Datatype / Scan ──
// Filled from the scan list (/api/bids/scans, hierarchy order). A scan without
// a task (e.g. anat/ physio) shows "none" in Task. Scans that share sub, ses,
// task and run (acq-mb / acq-sb, physio in func/ and eeg/) are told apart by
// the last dropdown, shown only then.

/** The dropdown fields, in order */
const LEVELS = ['sub', 'ses', 'task', 'run'] as const;
type Level = (typeof LEVELS)[number];

/** Scans that match `scan` on the given levels */
function matching(scans: ScanEntry[], scan: ScanEntry, levels: readonly Level[]): ScanEntry[] {
  return scans.filter((s) => levels.every((l) => s[l] === scan[l]));
}

/** Distinct values of one level, in the scans' (hierarchy) order */
function distinct(scans: ScanEntry[], level: Level): string[] {
  return [...new Set(scans.map((s) => s[level]))];
}

/** First scan (hierarchy order) that matches `scan` on the levels above and including `level` */
export function firstScanFor(scans: ScanEntry[], scan: ScanEntry, level: Level): ScanEntry | undefined {
  return matching(scans, scan, LEVELS.slice(0, LEVELS.indexOf(level) + 1))[0];
}

/**
 * How the scans that share sub/ses/task/run differ, for the last dropdown:
 * the datatype folder and the other entities that are not the same in all of
 * them. Its heading is Datatype when only the folder differs, else Scan.
 */
export function variantOptions(variants: ScanEntry[]): { heading: string; label: (s: ScanEntry) => string } {
  const keys = [...new Set(variants.flatMap((s) => Object.keys(s.entities)))].filter(
    (k) => !(LEVELS as readonly string[]).includes(k) && new Set(variants.map((s) => s.entities[k] ?? '')).size > 1,
  );
  const datatypes = new Set(variants.map((s) => s.datatype)).size > 1;
  return {
    heading: keys.length === 0 ? 'Datatype' : 'Scan',
    label: (s) =>
      [
        ...(datatypes || keys.length === 0 ? [s.datatype || 'no datatype folder'] : []),
        ...keys.map((k) => (k in s.entities ? `${k}-${s.entities[k]}` : `no ${k}-`)),
      ].join(' · '),
  };
}

export interface ScanSelectElements {
  subjectSelect: HTMLSelectElement;
  sessionSelect: HTMLSelectElement;
  sessionLabel: HTMLElement;
  taskSelect: HTMLSelectElement;
  runSelect: HTMLSelectElement;
  runLabel: HTMLElement;
  variantSelect: HTMLSelectElement;
  variantLabel: HTMLElement;
  variantHeading: HTMLElement;
}

/**
 * Set every scan dropdown to `scan`: each lists the values found under the
 * levels above it. Session is hidden when the subject has no sessions, Run
 * when those scans have no run, the last dropdown when only one scan is left.
 */
export function showScanInSelects(els: ScanSelectElements, scans: ScanEntry[], scan: ScanEntry): void {
  populateSelect(els.subjectSelect, distinct(scans, 'sub'), scan.sub);
  const sessions = distinct(matching(scans, scan, ['sub']), 'ses');
  populateSelect(els.sessionSelect, sessions, scan.ses, (v) => v || 'none');
  // Like Run: no dropdown for a subject without sessions
  els.sessionLabel.style.display = sessions.some((s) => s !== '') ? '' : 'none';
  populateSelect(els.taskSelect, distinct(matching(scans, scan, ['sub', 'ses']), 'task'), scan.task, (v) => v || 'none');
  const runs = distinct(matching(scans, scan, ['sub', 'ses', 'task']), 'run');
  populateSelect(els.runSelect, runs, scan.run, (v) => v || 'none');
  els.runLabel.style.display = runs.some((r) => r !== '') ? '' : 'none';

  const variants = matching(scans, scan, LEVELS);
  const { heading, label } = variantOptions(variants);
  const byId = new Map(variants.map((s) => [s.id, s]));
  populateSelect(els.variantSelect, [...byId.keys()], scan.id, (id) => label(byId.get(id)!));
  els.variantHeading.textContent = heading;
  els.variantLabel.style.display = variants.length > 1 ? '' : 'none';
}

/** The scan the dropdowns show, or undefined when they name none */
export function scanInSelects(els: ScanSelectElements, scans: ScanEntry[]): ScanEntry | undefined {
  return scans.find((s) => s.id === els.variantSelect.value);
}

/** Stacked channels that remain valid for a scan: present in it, and not the main channel */
export function validStacked(stacked: string[], columns: string[], mainChannel: string): string[] {
  return stacked.filter((c) => c !== mainChannel && columns.includes(c));
}

/** Toggle one channel in the stack, keeping column order regardless of click order */
export function toggleStacked(stacked: string[], columns: string[], channel: string, checked: boolean): string[] {
  const set = new Set(stacked);
  if (checked) set.add(channel);
  else set.delete(channel);
  return columns.filter((c) => set.has(c));
}

/**
 * One checkbox per channel except the main one. The row is hidden when there
 * is nothing to stack. onToggle receives the channel and its new checked state.
 */
export function renderStackControls(
  els: { stackRow: HTMLElement; stackChannels: HTMLElement },
  columns: string[],
  mainChannel: string,
  stacked: string[],
  onToggle: (channel: string, checked: boolean) => void,
  /** Shown name of a channel key (see scanChannels); the key itself when not given */
  labelOf: (channel: string) => string = (c) => c,
): void {
  els.stackChannels.innerHTML = '';
  const options = columns.filter((c) => c !== mainChannel);
  els.stackRow.style.display = options.length > 0 ? '' : 'none';

  for (const ch of options) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = stacked.includes(ch);
    cb.addEventListener('change', () => onToggle(ch, cb.checked));
    const name = document.createElement('span');
    name.className = 'channel-name'; // channel names look like code, as file names do
    name.textContent = labelOf(ch);
    label.append(cb, name);
    els.stackChannels.appendChild(label);
  }
}
