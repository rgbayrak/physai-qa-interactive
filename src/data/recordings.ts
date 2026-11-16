// Channels of a scan split into recording-<label> files (BIDS: signals with
// different sampling rates or devices MUST be in separate files). A channel
// is named by its recording and column; shared by the viewer and the Stats
// tab, so both name channels the same way. Relative imports only: this module
// is also loaded by Node scripts.

/** One column of one recording ('' for a physio file without a recording- label) */
export interface ChannelRef {
  recording: string;
  channel: string;
}

/**
 * Column names that more than one recording of a scan has, e.g. respiratory
 * in both belt1 and belt2 (two belts, two devices or rates: one file each)
 */
export function clashingNames(recordings: { recording: string; channels: string[] }[]): Set<string> {
  const count = new Map<string, number>();
  for (const r of recordings) for (const c of new Set(r.channels)) count.set(c, (count.get(c) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n > 1).map(([c]) => c));
}

/**
 * Shown name: the column name, with its recording written out the BIDS way
 * only when another recording of the scan has the same column, e.g.
 * "respiratory (recording-belt1)" for two respiratory belts
 */
export function channelLabel(ref: ChannelRef, clashes: Set<string>): string {
  return ref.recording && clashes.has(ref.channel) ? `${ref.channel} (recording-${ref.recording})` : ref.channel;
}

/** Dropdown value and storage key: the column name, prefixed by recording and a tab for a split scan */
export function refKey(ref: ChannelRef): string {
  return ref.recording ? `${ref.recording}\t${ref.channel}` : ref.channel;
}

/** A ChannelRef from refKey; a key without a tab is a column of a file without a recording- label */
export function parseRefKey(key: string): ChannelRef {
  const tab = key.indexOf('\t');
  return tab === -1 ? { recording: '', channel: key } : { recording: key.slice(0, tab), channel: key.slice(tab + 1) };
}
