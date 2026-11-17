import type { PhysioRaw, PhysioScan, ScanEntry } from '@/data/bids-physio-reader';
import { isPhysioChannel } from '@/quality/channels';
import { channelLabel, clashingNames, parseRefKey, refKey } from '@/data/recordings';
import type { ChannelRef } from '@/data/recordings';
import { levelValue } from '@/data/scan-key';
import type { ScanLocks } from '@/data/scan-key';
import { lockedScans } from './navigation';

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

// ── Scan levels: one control per entity of the dataset, then Datatype ──
// Built from the scan list (/api/bids/scans, hierarchy order). Every entity
// the dataset's scans have and the datatype folder is a level: Subject, Task,
// Datatype, then Session, acq, run, … in BIDS file-name order (scanLevels). A level with two or more values
// in the dataset is a dropdown; one with a single value is shown as text
// ("Task rest"), as nothing can be picked. A scan without the entity shows
// "none" (e.g. Task for anat/ physio). So a sub/ses/task/run dataset gets just
// those four, and acq-mb / acq-sb or physio in func/ and eeg/ add acq or
// Datatype.

export interface ScanLevel {
  /** Entity key (sub, ses, acq, …) or 'datatype' */
  key: string;
  /** Shown name: Subject, Session, Task, Run, Datatype; any other entity by its key (acq, dir, echo) */
  heading: string;
  /** Two or more values in the dataset: a dropdown (and a lock); else text */
  multi: boolean;
}

const HEADINGS: Record<string, string> = { sub: 'Subject', ses: 'Session', task: 'Task', run: 'Run', datatype: 'Datatype' };

/**
 * Entity keys in BIDS file-name order: each scan's entities are already in that
 * order (scanEntities, src/data/scan-key.ts), so the orders are merged, a new key
 * going after the key it follows in the scan that has it
 */
function entityOrder(scans: ScanEntry[]): string[] {
  const order: string[] = [];
  for (const s of scans) {
    let after = -1;
    for (const k of Object.keys(s.entities)) {
      const at = order.indexOf(k);
      if (at === -1) order.splice(++after, 0, k);
      else after = Math.max(after, at);
    }
  }
  return order;
}

/**
 * The dataset's scan levels, in order: Subject, Task, Datatype (what was
 * recorded, and in which folder), then Session and the other entities in BIDS
 * file-name order. Datatype only when scans have a datatype folder. The order
 * is also the order firstScanFor keeps values in.
 */
export function scanLevels(scans: ScanEntry[]): ScanLevel[] {
  const keys = entityOrder(scans);
  if (keys.includes('task') && keys.includes('sub')) {
    keys.splice(keys.indexOf('task'), 1);
    keys.splice(keys.indexOf('sub') + 1, 0, 'task');
  }
  const after = keys.includes('task') ? 'task' : 'sub';
  keys.splice(keys.indexOf(after) + 1, 0, 'datatype');
  return keys.flatMap((key) => {
    const values = new Set(scans.map((s) => levelValue(s, key)));
    if (values.size === 1 && values.has('')) return []; // e.g. no scan in a datatype folder
    return [{ key, heading: HEADINGS[key] ?? key, multi: values.size > 1 }];
  });
}

/** Shown text of a level value: "none" for a scan without the entity */
export function levelText(level: string, value: string): string {
  if (value) return value;
  return level === 'datatype' ? 'no datatype folder' : 'none';
}

/** Distinct values of one level, in the scans' (hierarchy) order */
function distinct(scans: ScanEntry[], level: string): string[] {
  return [...new Set(scans.map((s) => levelValue(s, level)))];
}

/** Scans with `wanted`'s values on the given levels */
function matching(scans: ScanEntry[], wanted: Record<string, string>, levels: ScanLevel[]): ScanEntry[] {
  return scans.filter((s) => levels.every((l) => levelValue(s, l.key) === wanted[l.key]));
}

/**
 * Levels whose values narrow a level's dropdown: none, so every dropdown lists
 * all the dataset's values (only locks narrow them; a session never hides a
 * task). Run is the exception: every other level, as runs are repeats of one
 * acquisition (one run there shows as text, levelDisplay).
 */
function scopeLevels(levels: ScanLevel[], key: string): ScanLevel[] {
  return key === 'run' ? levels.filter((l) => l.key !== 'run') : [];
}

/**
 * Values a level's dropdown lists for `wanted` (the shown scan): those of the
 * scans with `wanted`'s values on its scope levels (scopeLevels) and the locks
 * of the other levels (so Subject lists only subjects with the locked task),
 * in hierarchy order
 */
export function levelOptions(
  scans: ScanEntry[],
  levels: ScanLevel[],
  wanted: Record<string, string>,
  key: string,
  locks: ScanLocks = {},
): string[] {
  const { [key]: _own, ...otherLocks } = locks;
  return distinct(matching(lockedScans(scans, otherLocks), wanted, scopeLevels(levels, key)), key);
}

/**
 * What a change of `level`'s dropdown opens: the closest scan with the new
 * value and every lock. It keeps as many of `wanted`'s other values as it can,
 * level by level in order (Subject first), and takes the first in hierarchy
 * order. So a task only in another session opens that session of the same
 * subject, and a task the subject lacks opens the first subject that has it.
 */
export function firstScanFor(
  scans: ScanEntry[],
  levels: ScanLevel[],
  wanted: Record<string, string>,
  level: string,
  locks: ScanLocks = {},
): ScanEntry | undefined {
  let found = lockedScans(scans, locks).filter((s) => levelValue(s, level) === wanted[level]);
  for (const l of levels) {
    if (l.key === level) continue;
    const kept = found.filter((s) => levelValue(s, l.key) === wanted[l.key]);
    if (kept.length > 0) found = kept;
  }
  return found[0];
}

/** A scan's value on every level, e.g. { sub: '01', task: 'rest', datatype: 'func' } */
export function levelValues(scan: ScanEntry, levels: ScanLevel[]): Record<string, string> {
  return Object.fromEntries(levels.map((l) => [l.key, levelValue(scan, l.key)]));
}

/** The built controls: one label per level, with its dropdown (multi) or value text, and a lock button */
export interface ScanSelects {
  levels: ScanLevel[];
  labels: Map<string, HTMLElement>;
  selects: Map<string, HTMLSelectElement>;
  texts: Map<string, HTMLElement>;
  lockButtons: Map<string, HTMLButtonElement>;
}

/** Levels without a lock: runs are repeats of one acquisition, so stepping through them is the point */
const NO_LOCK = new Set(['run']);

/**
 * Build the scan controls in `container` (replacing what was there). Every
 * dropdown but Run gets a lock (e.g. lock Subject to step through only that
 * subject's scans). `onChange` gets the level whose dropdown changed, `onLock`
 * the level whose lock was toggled.
 */
export function buildScanSelects(
  container: HTMLElement,
  levels: ScanLevel[],
  onChange: (level: string) => void,
  onLock: (level: string) => void,
): ScanSelects {
  container.innerHTML = '';
  const ui: ScanSelects = { levels, labels: new Map(), selects: new Map(), texts: new Map(), lockButtons: new Map() };
  for (const l of levels) {
    const label = document.createElement('label');
    label.append(`${l.heading} `);
    // Value as text: the level's only form when it has one value in the dataset;
    // a dropdown level shows it instead of the dropdown when the scan leaves one choice (levelDisplay)
    const text = document.createElement('span');
    // A BIDS label from the file names: the shared code style, like channel names
    text.className = 'scan-level-value channel-name';
    label.appendChild(text);
    ui.texts.set(l.key, text);
    if (l.multi) {
      const select = document.createElement('select');
      select.addEventListener('change', () => onChange(l.key));
      label.appendChild(select);
      ui.selects.set(l.key, select);
      if (!NO_LOCK.has(l.key)) {
        const lock = document.createElement('button');
        lock.type = 'button';
        lock.className = 'lock-btn';
        lock.addEventListener('click', (e) => {
          e.preventDefault(); // inside the label: do not open the dropdown
          onLock(l.key);
        });
        label.appendChild(lock);
        ui.lockButtons.set(l.key, lock);
      }
    }
    container.appendChild(label);
    ui.labels.set(l.key, label);
  }
  return ui;
}

/** Padlock icons in the button's colour: open and thin, or closed and bold (red, see .lock-btn.active) when locked */
const LOCK_ICON = (closed: boolean) =>
  `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="${closed ? 2.2 : 1.6}">` +
  `<rect x="3" y="7" width="10" height="7" rx="1.5"/>` +
  `<path d="${closed ? 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2' : 'M5.5 7V5a2.5 2.5 0 0 1 5 0'}"/></svg>`;

/**
 * How a dropdown level shows for the current scan, from the values it could
 * take there: hidden when the only one is "none" (e.g. Session for a subject
 * without sessions), text when there is one value (like a level with one value
 * in the dataset; e.g. Run for a task with only run-1), else the dropdown. A
 * lock that is on stays shown with the text, so it can be undone.
 */
export function levelDisplay(options: string[], locked: boolean): { show: 'hidden' | 'text' | 'select'; lock: boolean } {
  if (!options.some((v) => v !== '')) return { show: 'hidden', lock: false };
  if (options.length === 1) return { show: 'text', lock: locked };
  return { show: 'select', lock: true };
}

/**
 * Set every scan control to `scan`. Each dropdown lists levelOptions (all the
 * dataset's values, Run the shown scan's runs); levelDisplay decides whether it
 * shows as a dropdown, as text or not at all.
 */
export function showScanInSelects(ui: ScanSelects, scans: ScanEntry[], scan: ScanEntry, locks: ScanLocks = {}): void {
  const wanted = levelValues(scan, ui.levels);
  ui.levels.forEach((l) => {
    const value = wanted[l.key];
    const text = ui.texts.get(l.key);
    if (text) text.textContent = levelText(l.key, value);
    const select = ui.selects.get(l.key);
    if (!select) return;
    const options = levelOptions(scans, ui.levels, wanted, l.key, locks);
    // Filled even when shown as text: scanInSelects reads its value
    populateSelect(select, options, value, (v) => levelText(l.key, v));
    const on = l.key in locks;
    const display = levelDisplay(options, on);
    ui.labels.get(l.key)!.style.display = display.show === 'hidden' ? 'none' : '';
    select.style.display = display.show === 'select' ? '' : 'none';
    if (text) text.style.display = display.show === 'text' ? '' : 'none';
    const lock = ui.lockButtons.get(l.key);
    if (lock) {
      lock.style.display = display.lock ? '' : 'none';
      lock.classList.toggle('active', on);
      lock.setAttribute('aria-pressed', String(on));
      lock.innerHTML = LOCK_ICON(on);
      const what = `${l.heading} ${levelText(l.key, on ? locks[l.key] : value)}`;
      lock.title = on ? `Unlock ${what}` : `Keep ${what} when changing the other dropdowns or pressing ←/→`;
      lock.setAttribute('aria-label', lock.title);
    }
  });
}

/** The scan the controls show, or undefined when they name none */
export function scanInSelects(ui: ScanSelects, scans: ScanEntry[]): ScanEntry | undefined {
  return scans.find((s) => [...ui.selects].every(([level, select]) => levelValue(s, level) === select.value));
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
