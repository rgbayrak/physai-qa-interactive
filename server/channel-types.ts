import { findRecordings } from './bids-layout';
import type { BidsIndex } from './bids-index';
import type { ScanEntry } from './bids-layout';
import { ChannelTypeTable } from '../src/quality/channels';
import type { ChannelOverride, ChannelTypeRow } from '../src/quality/channels';

/**
 * What every column of the scans' readable recordings is taken as, and why
 * (src/quality/channels.ts, explainChannel), from the physio.json Columns
 * only: nothing is read from the data files. Printed before a run computes.
 */
export function channelTypesOfScans(
  index: BidsIndex,
  scans: ScanEntry[],
  overrides: ReadonlyMap<string, ChannelOverride> = new Map(),
): ChannelTypeRow[] {
  const table = new ChannelTypeTable(overrides);
  for (const scan of scans) {
    for (const found of findRecordings(index, scan.id)) {
      if (!found.file.readable) continue;
      const columns = (found.sidecar as { Columns?: unknown } | null)?.Columns;
      if (Array.isArray(columns)) for (const c of columns) if (typeof c === 'string') table.add(c);
    }
  }
  return table.list();
}
