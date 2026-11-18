import { readFileSync } from 'fs';
import { channelFilePath, findRecordings, isReadable } from './bids-layout';
import type { BidsIndex } from './bids-index';
import type { ScanEntry } from './bids-layout';
import { analysisSignalOf, ChannelTypeTable, signalOrNull } from '../src/quality/channels';
import type { ChannelOverride, ChannelTypeRow } from '../src/quality/channels';
import type { DetectedPeaksFile, PeakSignal } from '../src/data/detected-peaks';

// Detected peaks: written by scripts/compute-peaks.ts (manifest) and
// scripts/detect_peaks.py (the detectors), one file per channel under
// data/peaks/<dataset>/, laid out like the annotations (channelFilePath).

/** File name ending of a channel's detected peaks */
export const PEAKS_SUFFIX = '_peaks.json';

/**
 * Which detector family a column gets by its name, the same rule as the
 * quality metrics (analysisSignalOf in src/quality/channels.ts); null when
 * none, ambiguous or unknown
 */
export function peakSignalOf(channel: string): PeakSignal | null {
  return signalOrNull(analysisSignalOf(channel));
}

/** One channel for detect_peaks.py to process */
export interface PeaksJob {
  scan: string;
  recording: string;
  channel: string;
  signal: PeakSignal;
  /** Where the type came from: the column name, or --channel */
  signal_source: 'name' | 'override';
  physio_path: string;
  /** Column of the channel in the physio file (0-based), and how many the sidecar lists */
  column_index: number;
  n_columns: number;
  /** Rate in the file (sidecar SamplingFrequency), before any downsampling for display */
  sampling_rate: number;
  out_path: string;
}

export interface PeaksManifest {
  jobs: PeaksJob[];
  /** Physio files that could not be used, with the reason */
  skipped: { file: string; reason: string }[];
  /** What every column of the readable recordings was taken as, and why (printed and saved by compute-peaks.ts) */
  channelTypes: ChannelTypeRow[];
}

/**
 * The channels of `scans` that get detectors, with their output paths under
 * `outDir`. Unreadable files (not downloaded) and sidecars without Columns or
 * SamplingFrequency are listed in `skipped`. Channels that already have a peaks
 * file are listed too: detect_peaks.py reuses the results it already has
 * (unless --force) and writes the file with the run's detectors only.
 */
export function buildPeaksManifest(
  index: BidsIndex,
  scans: ScanEntry[],
  outDir: string,
  opts: {
    /** --channel types for this run (column -> type) */
    overrides?: ReadonlyMap<string, ChannelOverride>;
  } = {},
): PeaksManifest {
  const table = new ChannelTypeTable(opts.overrides);
  const jobs: PeaksJob[] = [];
  const skipped: { file: string; reason: string }[] = [];
  for (const scan of scans) {
    for (const found of findRecordings(index, scan.id)) {
      if (!found.file.readable) {
        skipped.push({ file: found.tsvGzName, reason: 'not downloaded (datalad get)' });
        continue;
      }
      const sidecar = found.sidecar as { Columns?: unknown; SamplingFrequency?: unknown } | null;
      if (!sidecar || !Array.isArray(sidecar.Columns) || typeof sidecar.SamplingFrequency !== 'number') {
        skipped.push({ file: found.tsvGzName, reason: 'sidecar not found or without Columns and SamplingFrequency' });
        continue;
      }
      const columns = sidecar.Columns as string[];
      columns.forEach((channel, i) => {
        table.add(channel);
        const c = analysisSignalOf(channel, opts.overrides);
        if (c.kind !== 'signal') return;
        const signal = c.signal;
        let out: string;
        try {
          out = channelFilePath(outDir, index, scan.id, found.recording, channel, PEAKS_SUFFIX);
        } catch (err) {
          skipped.push({ file: `${found.tsvGzName} (${channel})`, reason: err instanceof Error ? err.message : String(err) });
          return;
        }
        jobs.push({
          scan: scan.id,
          recording: found.recording,
          channel,
          signal,
          signal_source: c.source,
          physio_path: found.tsvGzPath,
          column_index: i,
          n_columns: columns.length,
          sampling_rate: sidecar.SamplingFrequency as number,
          out_path: out,
        });
      });
    }
  }
  return { jobs, skipped, channelTypes: table.list() };
}

/**
 * The detected peaks of one channel of one recording, or null when none were
 * computed or the file cannot be parsed. Throws for an unknown scan or
 * recording, or an invalid channel name (see channelFilePath).
 */
export function readDetectedPeaks(
  root: string,
  index: BidsIndex,
  scanId: string,
  recording: string,
  channel: string,
): DetectedPeaksFile | null {
  const path = channelFilePath(root, index, scanId, recording, channel, PEAKS_SUFFIX);
  if (!isReadable(path)) return null;
  try {
    const file = JSON.parse(readFileSync(path, 'utf-8')) as DetectedPeaksFile;
    return Array.isArray(file?.detectors) ? file : null;
  } catch {
    return null;
  }
}
