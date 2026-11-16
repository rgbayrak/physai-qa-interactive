import { DATASET_JSON_NAME, METRICS_TSV_NAME, WAVEFORMS_DIR, parseQualityTsv, waveformFileName } from './metrics-tsv';
import type { DatasetQualityFile, QualityRow, ScanKeyLike, WaveformFile } from './metrics-tsv';
import { RUN_LOG_NAME, parseLastRun } from './run-log';
import { labelRecordingChannels } from './model';
import type { QualityRun } from './run-log';

// Loads the static files written by scripts/compute-quality-metrics.ts. The
// dev server serves them from data/quality/ directly; no API endpoint needed.
// Which dataset to show comes from the dev server (/api/bids/dataset), so the
// Stats tab always matches Explore and Annotate.

const QUALITY_BASE = '/data/quality';

/**
 * Fetch text, treating the dev server's HTML fallback (served for missing
 * files) as "not found".
 */
async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  if ((res.headers.get('content-type') ?? '').includes('text/html')) return null;
  return res.text();
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const text = await fetchText(url);
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export interface ServedDataset {
  /** Folder name under data/ (e.g. ds006644): where its quality metrics live */
  id: string;
  /** Name from dataset_description.json; the viewer keys its remembered scan on it */
  name: string | null;
}

/** The dataset the dev server is serving (BIDS_ROOT); null if the server can't say */
export async function fetchServedDataset(): Promise<ServedDataset | null> {
  const info = await fetchJson<{ id?: unknown; name?: unknown }>('/api/bids/dataset');
  if (!info || typeof info.id !== 'string' || info.id === '') return null;
  return { id: info.id, name: typeof info.name === 'string' ? info.name : null };
}

export interface LoadedDataset {
  summary: DatasetQualityFile;
  rows: QualityRow[];
  /** Last line of quality_runs.tsv; null for metrics computed before the run log existed */
  lastRun: QualityRun | null;
}

/**
 * The metrics files are there but cannot be read: written by an older version
 * of the script (e.g. a TSV without the scan or recording column). Computing
 * the metrics again fixes it.
 */
export class OutdatedMetricsError extends Error {}

/** The served dataset's metrics; null when none were computed. Throws OutdatedMetricsError when they are too old to read */
export async function fetchDatasetQuality(dataset: string): Promise<LoadedDataset | null> {
  const base = `${QUALITY_BASE}/${encodeURIComponent(dataset)}`;
  const [summary, tsv, runLog] = await Promise.all([
    fetchJson<DatasetQualityFile>(`${base}/${DATASET_JSON_NAME}`),
    fetchText(`${base}/${METRICS_TSV_NAME}`),
    fetchText(`${base}/${RUN_LOG_NAME}`).catch(() => null),
  ]);
  if (!summary || tsv == null) return null;
  // Channels two recordings share get their recording label; their units follow them
  let parsed: QualityRow[];
  try {
    parsed = parseQualityTsv(tsv);
  } catch (err) {
    throw new OutdatedMetricsError(err instanceof Error ? err.message : String(err));
  }
  const rows = labelRecordingChannels(parsed);
  const units = { ...summary.channelUnits };
  for (const r of rows) if (r.column && units[r.column] && !units[r.channel]) units[r.channel] = units[r.column];
  return { summary: { ...summary, channelUnits: units }, rows, lastRun: runLog ? parseLastRun(runLog) : null };
}

/** Whether the served dataset's PDF report is saved, and where to open it */
interface ReportStatus {
  exists: boolean;
  url: string;
}

export async function fetchReportStatus(): Promise<ReportStatus | null> {
  const res = await fetch('/api/quality-report').catch(() => null);
  if (!res?.ok) return null;
  return res.json();
}

/** Send the PDF the Stats tab built; the dev server saves it next to the metrics */
export async function saveReport(pdf: Blob): Promise<ReportStatus> {
  const res = await fetch('/api/quality-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: pdf,
  });
  if (!res.ok) throw new Error(`The server did not save the PDF (${res.status})`);
  return res.json();
}

/** One channel's whole-recording envelope, on its recording's own time bins */
export interface ChannelWaveform {
  /** Shown name, as in labelRecordingChannels */
  channel: string;
  /** Column name, for units */
  column: string;
  times: number[];
  min: (number | null)[];
  max: (number | null)[];
}

/**
 * A scan's waveforms: one file per recording (the recordings of the scan's
 * rows, '' for a file without a recording- label), each channel kept on its
 * own recording's time bins. Null when none of the files is there.
 */
export async function fetchWaveforms(
  dataset: string,
  scan: ScanKeyLike,
  scanRows: { recording: string; channel: string; column?: string }[],
): Promise<ChannelWaveform[] | null> {
  const recordings = [...new Set(scanRows.map((r) => r.recording))];
  const files = await Promise.all(
    recordings.map((recording) => {
      const file = waveformFileName(scan, recording).split('/').map(encodeURIComponent).join('/');
      return fetchJson<WaveformFile>(`${QUALITY_BASE}/${encodeURIComponent(dataset)}/${WAVEFORMS_DIR}/${file}`);
    }),
  );
  if (files.every((f) => !f)) return null;
  return files.flatMap((wf, i) =>
    (wf?.channels ?? []).map((ch) => {
      // The row of this column in this recording gives its shown name
      const row = scanRows.find((r) => r.recording === recordings[i] && (r.column ?? r.channel) === ch.channel);
      return { channel: row?.channel ?? ch.channel, column: ch.channel, times: wf!.times, min: ch.min, max: ch.max };
    }),
  );
}
