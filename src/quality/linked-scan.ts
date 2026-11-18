import { lastViewedKey, readLastViewed, saveLastViewed } from '@/viewer/persistence';
import { matchesLocks, parseScanId, toScanKey } from '@/data/scan-key';
import type { ScanLocks } from '@/data/scan-key';
import { sameScanKey } from './metrics-tsv';
import type { ScanKeyLike } from './metrics-tsv';

// Shares the scan and the locks between Stats and Explore and Annotate through
// the visit's entry in sessionStorage (src/viewer/persistence.ts, keyed by
// dataset and dev server launch). Stats opens the viewer's last scan when its
// own link names none, steps only through scans with the viewer's locked
// values, and writes the scan it shows back to that entry. Which scan the
// viewer opens is decided by its link (`#scan?…`, see viewerUrl in route.ts)
// and pickStartScan (src/viewer/navigation.ts); the entry written here also
// carries the channel, confound, events column, stacked channels and locks across.

/** Scan last shown in Explore and Annotate for this dataset in this visit, if any */
export function viewerScan(datasetName: string | null, store?: Storage | null, launch = ''): ScanKeyLike | null {
  const saved = readLastViewed(lastViewedKey(datasetName, launch), store);
  // Entries saved before scans had ids (sub/ses/task/run only) are ignored
  return saved && typeof saved.id === 'string' ? parseScanId(saved.id) : null;
}

/** The viewer's locked scan levels in this visit (e.g. { task: 'rest' }); none when nothing is locked */
export function viewerLocks(datasetName: string | null, store?: Storage | null, launch = ''): ScanLocks {
  const locks = readLastViewed(lastViewedKey(datasetName, launch), store)?.locks;
  if (!locks || typeof locks !== 'object' || Array.isArray(locks)) return {};
  return Object.fromEntries(Object.entries(locks).filter(([, v]) => typeof v === 'string')) as ScanLocks;
}

/**
 * Stats Prev/Next with the viewer's locks: the nearest scan `delta` steps
 * before or after `current` (in `scans` order) that has every locked value;
 * undefined at either end. `current` itself may lack them (a scatter
 * double-click can open any scan): stepping still starts from it.
 */
export function stepWithinLocks<S extends ScanKeyLike>(
  scans: S[],
  current: ScanKeyLike | null,
  delta: -1 | 1,
  locks: ScanLocks,
): S | undefined {
  const i = current ? scans.findIndex((s) => sameScanKey(s, current)) : -1;
  if (i === -1) return undefined;
  for (let j = i + delta; j >= 0 && j < scans.length; j += delta) {
    if (matchesLocks(scans[j], locks)) return scans[j];
  }
  return undefined;
}

/**
 * Make Explore and Annotate open `scan` next time. Keeps the viewer's channel,
 * confound, events column, stacked channels and locks; the viewer falls back to
 * its defaults if they don't exist for this scan.
 */
export function shareScanWithViewer(
  datasetName: string | null,
  scan: ScanKeyLike,
  store?: Storage | null,
  launch = '',
): void {
  const key = lastViewedKey(datasetName, launch);
  const prev = readLastViewed(key, store);
  saveLastViewed(
    key,
    {
      // Everything else the viewer keeps (Show peaks boxes, scatter axes, …) carries across too
      ...prev,
      ...toScanKey(scan),
      channel: prev?.channel ?? '',
      confound: prev?.confound ?? '',
      event: prev?.event ?? '',
      stacked: prev?.stacked ?? [],
      ...(prev?.locks ? { locks: prev.locks } : {}),
    },
    store,
  );
}
