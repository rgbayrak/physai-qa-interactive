import type { ScanEntry } from '@/data/bids-physio-reader';
import type { RestoredSelection } from './state';
import { findScan, lockedScans } from './navigation';
import type { ScanLocks } from '@/data/scan-key';

// The visit's choices (scan, channel, confound, events column, stacked
// channels, locks) in sessionStorage (user decision, 2026-11-16): they last
// while switching between Explore and Annotate and Stats in one browser tab,
// and are gone when the tab closes. The key carries the dev server launch
// (/api/bids/launch), so a new launch starts clean, on the first scan without
// annotations. Storage can be unavailable (private mode, blocked site data), so
// every access is wrapped and failures are ignored.

export interface LastViewed extends ScanEntry {
  /** Channel key (refKey, src/data/recordings.ts): the column name, prefixed by its recording in a split scan */
  channel: string;
  confound: string;
  /** Events column; absent in entries saved before the events figure existed */
  event?: string;
  /** Absent in entries saved before stacked channels existed */
  stacked?: string[];
  /** Locked scan levels (e.g. { task: 'rest' }); absent in entries saved before locks existed */
  locks?: ScanLocks;
}

/** Saved locks that still apply: string values only, and kept only when some scan has them all */
function validLocks(saved: unknown, scans: ScanEntry[]): ScanLocks {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
  const locks = Object.fromEntries(Object.entries(saved).filter(([, v]) => typeof v === 'string')) as ScanLocks;
  return lockedScans(scans, locks).length > 0 ? locks : {};
}

/** Key used until dataset info has loaded */
export const DEFAULT_LAST_VIEWED_KEY = 'bids-physio-viewer:last-viewed';

/**
 * Storage key scoped per dataset (switching datasets doesn't resume a scan
 * that isn't there) and per dev server launch (a new launch starts clean)
 */
export function lastViewedKey(datasetName: string | null | undefined, launch = ''): string {
  return `${DEFAULT_LAST_VIEWED_KEY}:${datasetName ?? 'unnamed'}${launch ? `:${launch}` : ''}`;
}

/** This browser tab's storage for the visit (sessionStorage), or null when unavailable */
export function sessionStore(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

const storage = sessionStore;

/**
 * Remove what earlier versions kept in localStorage (last-viewed entries, the
 * Stats "Metrics shown" ticks), so no choice outlives a visit
 */
export function clearOldLocalStorage(prefixes: string[], store: Storage | null = localStore()): void {
  try {
    if (!store) return;
    const old: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key && prefixes.some((p) => key.startsWith(p))) old.push(key);
    }
    old.forEach((key) => store.removeItem(key));
  } catch {
    // ignore: storage unavailable
  }
}

function localStore(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function saveLastViewed(key: string, value: LastViewed, store: Storage | null = storage()): void {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    // ignore: storage unavailable or full
  }
}

export function readLastViewed(key: string, store: Storage | null = storage()): LastViewed | null {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as LastViewed) : null;
  } catch {
    return null;
  }
}

/** The saved scan if it still exists in the dataset, plus the selection and locks to restore with it */
export function resumeFrom(
  saved: LastViewed | null,
  scans: ScanEntry[],
): { scan: ScanEntry; selection: RestoredSelection; locks: ScanLocks } | null {
  if (!saved) return null;
  const scan = findScan(scans, saved);
  if (!scan) return null;
  return {
    scan,
    locks: validLocks(saved.locks, scans),
    selection: {
      channel: saved.channel,
      confound: saved.confound,
      event: typeof saved.event === 'string' ? saved.event : '',
      stacked: Array.isArray(saved.stacked) ? saved.stacked : [],
    },
  };
}
