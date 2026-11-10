import { lastViewedKey, readLastViewed, saveLastViewed } from '@/viewer/persistence';
import type { ScanKeyLike } from './metrics-tsv';

// Shares the scan between Stats and Explore and Annotate through the viewer's
// "last viewed" entry in localStorage (src/viewer/persistence.ts). Stats opens
// the viewer's last scan when its own link names none, and writes the scan it
// shows back to that entry. Which scan the viewer opens is decided by its link
// (`#scan?…`, see viewerUrl in route.ts) and pickStartScan
// (src/viewer/navigation.ts), where the first unannotated scan comes before
// the last-viewed one; the entry written here mainly carries the channel,
// confound, events column and stacked channels across.

/** Scan last shown in Explore and Annotate for this dataset, if any */
export function viewerScan(datasetName: string | null, store?: Storage | null): ScanKeyLike | null {
  const saved = readLastViewed(lastViewedKey(datasetName), store);
  if (!saved || typeof saved.sub !== 'string' || typeof saved.task !== 'string') return null;
  return { sub: saved.sub, ses: saved.ses ?? '', task: saved.task, run: saved.run ?? '' };
}

/**
 * Make Explore and Annotate open `scan` next time. Keeps the viewer's channel,
 * confound, events column and stacked channels; the viewer falls back to its defaults if they
 * don't exist for this scan.
 */
export function shareScanWithViewer(datasetName: string | null, scan: ScanKeyLike, store?: Storage | null): void {
  const key = lastViewedKey(datasetName);
  const prev = readLastViewed(key, store);
  saveLastViewed(
    key,
    {
      sub: scan.sub,
      ses: scan.ses,
      task: scan.task,
      run: scan.run,
      channel: prev?.channel ?? '',
      confound: prev?.confound ?? '',
      event: prev?.event ?? '',
      stacked: prev?.stacked ?? [],
    },
    store,
  );
}
