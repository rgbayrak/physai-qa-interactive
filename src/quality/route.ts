import { parseScanId } from '../data/scan-key';
import type { ScanKeyLike } from './metrics-tsv';

// Link to one scan on the Stats page (the dataset is whatever the dev server serves):
//   /quality.html#scan?id=func/sub-01_ses-01_task-rest_run-01
// The id is the scan's datatype folder and entities (src/data/scan-key.ts).
// Only the part after "?" is read.

/** The scan named in a quality.html hash, or null (Stats then opens the scan last shown in either tab) */
export function parseScanHash(hash: string): ScanKeyLike | null {
  const h = hash.replace(/^#/, '');
  const q = h.indexOf('?');
  if (q === -1) return null;
  const id = new URLSearchParams(h.slice(q + 1)).get('id');
  return id ? parseScanId(id) : null;
}

export function scanHash(scan: ScanKeyLike): string {
  return `#scan?${new URLSearchParams({ id: scan.id }).toString()}`;
}

/** Address of the Stats page for one scan, e.g. for a double-click in Explore and Annotate */
export function statsUrl(scan: ScanKeyLike): string {
  return `/quality.html${scanHash(scan)}`;
}

/**
 * Address of Explore and Annotate for one scan, for the links from Stats (its
 * folder tab and "Open this scan…"). Without a scan in the link, Explore and
 * Annotate opens the earliest scan not annotated yet.
 */
export function viewerUrl(scan: ScanKeyLike): string {
  return `/${scanHash(scan)}`;
}
