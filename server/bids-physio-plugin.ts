import { basename, join, relative, sep } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import type { Plugin } from 'vite';
import { METRICS_TSV_NAME, REPORT_PDF_NAME } from '../src/quality/metrics-tsv';
import {
  getSubjects,
  readPhysio,
  readConfounds,
  readEvents,
  readPeaks,
  readAnnotations,
  writeAnnotations,
  buildScans,
  readDatasetInfo,
  validateChannel,
  annotationProgress,
} from './bids-layout';
import type { AnnotationsFile } from './bids-layout';
import { buildBidsIndex, indexSummaryLines, recordingOf, scanRecordings } from './bids-index';
import type { BidsIndex } from './bids-index';
import { countPhysioFiles } from './availability';
import { checkStructure } from './bids-structure';
import { checkRootSettings, noPhysioLines } from './bids-roots-check';
import { bannerLines, readAppVersion } from './startup-banner';
import { descriptionNoticeLines, noticeText } from '../src/data/dataset-notice';
import { structureLine, structureText } from '../src/data/bids-structure';
import type { ServerResponse } from 'http';

function replyError(res: ServerResponse, status: number, error: string): void {
  res.statusCode = status;
  res.end(JSON.stringify({ error }));
}

/**
 * The scan id given in the request (`scan`, e.g. func/sub-01_task-rest_run-01)
 * when it names a scan in the index; otherwise reply 400 (missing) or 404
 * (unknown) and return null. Only ids from the index are used from here on.
 */
function knownScan(res: ServerResponse, scan: string | null | undefined): string | null {
  if (!scan) {
    replyError(res, 400, 'Missing scan parameter');
    return null;
  }
  if (!INDEX.scans.has(scan)) {
    replyError(res, 404, `Unknown scan: ${JSON.stringify(scan)}`);
    return null;
  }
  return scan;
}

/** True when `recording` ('' for a file without a recording- label) is a recording of the scan; else reply 404 */
function knownRecording(res: ServerResponse, scan: string, recording: string): boolean {
  if (scanRecordings(INDEX, scan).some((f) => recordingOf(f) === recording)) return true;
  replyError(res, 404, `Unknown recording of ${scan}: ${JSON.stringify(recording)}`);
  return false;
}

// BIDS_ROOT is always the main BIDS folder (dataset_description.json,
// participants.tsv, events, BOLD sidecars). It is walked once at start-up and
// every physio, sidecar, confounds and events file in it is indexed wherever
// it sits (server/bids-index.ts). BIDSPHYS_ROOT and BIDSDER_ROOT are extra
// folders walked too, for physio or derivatives stored outside BIDS_ROOT.
// There is no default dataset: BIDS_ROOT must be set. The folders are set
// when the dev server starts (resolveRoots), not when this file loads,
// because scripts run with vite-node load this plugin too.
let BIDS_ROOT = '';
let BIDSPHYS_ROOT: string | undefined;
let BIDSDER_ROOT: string | undefined;
let INDEX: BidsIndex;

const DATA_DIR = join(process.cwd(), 'data');

/** Print each message line, tagging the ones that start a new message */
function printLines(lines: string[], print: (line: string) => void) {
  for (const line of lines) print(line.startsWith(' ') ? line : `[bids-physio] ${line}`);
}

/**
 * Print the welcome banner the first time the dev server starts. Vite
 * re-bundles this file on each restart, resetting module state, so the
 * "already printed" flag is kept on globalThis.
 */
function printBannerOnce() {
  const g = globalThis as { __physaiBannerShown?: boolean };
  if (g.__physaiBannerShown) return;
  g.__physaiBannerShown = true;
  console.log(['', ...bannerLines(readAppVersion(process.cwd())), ''].join('\n'));
}

/**
 * Check BIDS_ROOT, BIDSPHYS_ROOT and BIDSDER_ROOT and set the folders. If one
 * is missing or wrong, tell the user what to set and stop the dev server.
 */
function resolveRoots() {
  const check = checkRootSettings(
    {
      bidsRoot: process.env.BIDS_ROOT,
      physioRoot: process.env.BIDSPHYS_ROOT,
      derivRoot: process.env.BIDSDER_ROOT,
    },
    process.cwd(),
  );
  if (!check.ok) {
    printLines(check.lines, console.error);
    process.exit(1);
  }
  BIDS_ROOT = check.bidsRoot;
  BIDSPHYS_ROOT = check.physioRoot;
  BIDSDER_ROOT = check.derivRoot;
  ANNOTATIONS_ROOT = join(process.env.ANNOTATIONS_ROOT ?? join(DATA_DIR, 'annotations'), datasetName());
}

// Dataset name = first folder under data/ (data/friends/friends → friends,
// data/ds006644 → ds006644); outside data/, fall back to BIDS_ROOT's basename.
function datasetName(): string {
  if (process.env.DATASET_NAME) return process.env.DATASET_NAME;
  const rel = relative(DATA_DIR, BIDS_ROOT);
  if (rel && !rel.startsWith('..')) return rel.split(sep)[0];
  return basename(BIDS_ROOT);
}

// Quality metrics written by scripts/compute-quality-metrics.ts (default output root)
const QUALITY_ROOT = join(DATA_DIR, 'quality');
/** Largest PDF report the server accepts (one page per scan; JPEG pages) */
const MAX_REPORT_BYTES = 500 * 1024 * 1024;

// Annotations are grouped per dataset, in each physio file's folder relative to
// its dataset: <annotations>/<dataset>/sub-XX/[ses-YY/]<datatype>/
// (set in resolveRoots, once the dataset is known)
let ANNOTATIONS_ROOT = '';

export function bidsPhysioPlugin(): Plugin {
  let cachedSubjectsJson: string;
  let cachedScansJson: string;
  let cachedDatasetJson: string;
  let scans: ReturnType<typeof buildScans> = [];

  /** Index the folders once, then cache subjects, scans and dataset info, and log what was found */
  function cacheDataset() {
    printBannerOnce();
    resolveRoots();
    INDEX = buildBidsIndex({ bidsRoot: BIDS_ROOT, physioRoot: BIDSPHYS_ROOT, derivRoot: BIDSDER_ROOT });
    const subjects = getSubjects(INDEX);
    cachedSubjectsJson = JSON.stringify({ subjects });
    scans = buildScans(INDEX);
    cachedScansJson = JSON.stringify({ scans });
    console.log(`[bids-physio] BIDS root: ${BIDS_ROOT}`);
    if (BIDSPHYS_ROOT) console.log(`[bids-physio] Physio root: ${BIDSPHYS_ROOT}`);
    if (BIDSDER_ROOT) console.log(`[bids-physio] Derivatives root: ${BIDSDER_ROOT}`);
    for (const line of indexSummaryLines(INDEX)) console.log(`[bids-physio]   ${line}`);
    console.log(`[bids-physio] Cached ${subjects.length} subjects, ${scans.length} scans`);
    if (scans.length === 0) printLines(noPhysioLines(INDEX.walked, !!BIDSPHYS_ROOT), console.warn);
    // Downloaded vs listed physio files, counted once (git-annex when it can answer)
    const physioFiles = countPhysioFiles(INDEX);
    console.log(
      `[bids-physio] Physio files: ${physioFiles.downloaded} of ${physioFiles.onDisk} downloaded (${physioFiles.source})`,
    );
    const info = readDatasetInfo(INDEX);
    for (const line of descriptionNoticeLines(info.description)) console.warn(`[bids-physio] ${noticeText(line)}`);
    // File and folder names against the rules of the declared BIDSVersion (names only, nothing downloaded)
    const structure = checkStructure(BIDS_ROOT, info.bidsVersion);
    const structureMsg = structureLine(structure);
    if (structureMsg) console.log(`[bids-physio] ${structureText(structureMsg)}`);
    cachedDatasetJson = JSON.stringify({
      ...info,
      // The folder name under data/ (e.g. ds006644); the Stats tab uses it to find data/quality/<id>/
      id: datasetName(),
      physioFiles,
      structure,
    });
  }

  return {
    name: 'bids-physio',
    configureServer(server) {
      // Scan the dataset only when the dev server starts listening. Scripts run
      // with vite-node (e.g. scripts/compute-quality-metrics.ts) also load this
      // plugin but never listen, so they skip this scan, the BIDS_ROOT check
      // and its log lines. The work is synchronous, so it finishes before the
      // first request is handled. No HTTP server (middleware mode): scan now.
      if (server.httpServer) server.httpServer.once('listening', cacheDataset);
      else cacheDataset();

      server.middlewares.use((req, res, next) => {
        if (req.url === '/api/bids/subjects') {
          res.setHeader('Content-Type', 'application/json');
          res.end(cachedSubjectsJson);
          return;
        }

        if (req.url === '/api/bids/dataset') {
          res.setHeader('Content-Type', 'application/json');
          res.end(cachedDatasetJson);
          return;
        }

        if (req.url === '/api/bids/scans') {
          res.setHeader('Content-Type', 'application/json');
          res.end(cachedScansJson);
          return;
        }

        // Per-scan data, each named by ?scan=<id> (see knownScan)
        if (req.url?.startsWith('/api/bids/physio')) {
          const scan = knownScan(res, new URL(req.url, 'http://localhost').searchParams.get('scan'));
          if (!scan) return;
          const result = readPhysio(INDEX, scan);
          if (!result) {
            replyError(res, 404, 'Physio sidecar not found or without Columns and SamplingFrequency');
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
          return;
        }

        if (req.url?.startsWith('/api/bids/confounds')) {
          const scan = knownScan(res, new URL(req.url, 'http://localhost').searchParams.get('scan'));
          if (!scan) return;
          // Many scans have no fMRIPrep confounds (and physio outside func/ has
          // none): not an error, so reply null (200) rather than 404, which the
          // browser logs as a failure
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(readConfounds(INDEX, scan) ?? null));
          return;
        }

        if (req.url?.startsWith('/api/bids/events')) {
          const scan = knownScan(res, new URL(req.url, 'http://localhost').searchParams.get('scan'));
          if (!scan) return;
          // Events come from the raw datasets (BIDS_ROOT first), never the derivatives.
          // No events file (e.g. rest) is not an error: reply null (200), not 404
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(readEvents(INDEX, scan) ?? null));
          return;
        }

        // TRIAL: detected/corrected peaks from the events file in the physio
        // file's own dataset (e.g. physprep/). null if none.
        if (req.url?.startsWith('/api/bids/peaks')) {
          const scan = knownScan(res, new URL(req.url, 'http://localhost').searchParams.get('scan'));
          if (!scan) return;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(readPeaks(INDEX, scan) ?? null));
          return;
        }

        // How many scans are annotated for one channel, e.g. { annotated: 24, total: 80 }
        if (req.url?.startsWith('/api/bids/annotation-progress')) {
          const url = new URL(req.url, 'http://localhost');
          const channel = url.searchParams.get('channel');
          const error = channel ? validateChannel(channel) : 'Missing channel parameter';
          if (error || !channel) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error }));
            return;
          }
          // recording: only for a channel name two recordings share (e.g. respiratory of belt1)
          const recording = url.searchParams.get('recording') ?? undefined;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(annotationProgress(ANNOTATIONS_ROOT, INDEX, scans, channel, recording)));
          return;
        }

        if (req.url?.startsWith('/api/bids/annotations')) {
          if (req.method === 'GET') {
            const url = new URL(req.url, 'http://localhost');
            const scan = knownScan(res, url.searchParams.get('scan'));
            if (!scan) return;
            const channel = url.searchParams.get('channel');
            const error = channel ? validateChannel(channel) : 'Missing channel parameter';
            if (error || !channel) {
              replyError(res, 400, error ?? 'Missing channel parameter');
              return;
            }

            const recording = url.searchParams.get('recording') ?? '';
            if (!knownRecording(res, scan, recording)) return;
            const result = readAnnotations(ANNOTATIONS_ROOT, INDEX, scan, recording, channel);
            const key = scans.find((s) => s.id === scan)!;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify(
                result ?? {
                  scan,
                  datatype: key.datatype,
                  sub: key.sub,
                  ses: key.ses,
                  task: key.task,
                  run: key.run,
                  recording,
                  channel,
                  sampling_rate: 0,
                  annotations: [],
                },
              ),
            );
            return;
          }

          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
              try {
                const payload = JSON.parse(body) as AnnotationsFile;
                const scan = knownScan(res, typeof payload.scan === 'string' ? payload.scan : null);
                if (!scan) return;
                if (!knownRecording(res, scan, typeof payload.recording === 'string' ? payload.recording : '')) return;
                const error = typeof payload.channel === 'string' ? validateChannel(payload.channel) : 'Missing channel in payload';
                if (error) {
                  replyError(res, 400, error);
                  return;
                }
                writeAnnotations(ANNOTATIONS_ROOT, INDEX, payload);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: true }));
              } catch {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Invalid annotation payload' }));
              }
            });
            return;
          }

          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        // PDF report of the served dataset's quality metrics, saved next to them.
        // GET: is it there? POST: the Stats tab sends the PDF it built. Only the
        // served dataset, at a fixed file name: nothing from the request picks the path.
        if (req.url?.startsWith('/api/quality-report')) {
          const dataset = datasetName();
          const dir = join(QUALITY_ROOT, dataset);
          const file = join(dir, REPORT_PDF_NAME);
          const url = `/data/quality/${encodeURIComponent(dataset)}/${REPORT_PDF_NAME}`;
          res.setHeader('Content-Type', 'application/json');

          if (req.method === 'GET') {
            res.end(JSON.stringify({ exists: existsSync(file), url }));
            return;
          }

          if (req.method === 'POST') {
            if (!existsSync(join(dir, METRICS_TSV_NAME))) {
              res.statusCode = 409;
              res.end(JSON.stringify({ error: 'No quality metrics computed for this dataset' }));
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            let tooLarge = false;
            req.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > MAX_REPORT_BYTES) tooLarge = true;
              else chunks.push(chunk);
            });
            req.on('end', () => {
              const body = Buffer.concat(chunks);
              if (tooLarge || body.subarray(0, 5).toString('latin1') !== '%PDF-') {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: tooLarge ? 'PDF too large' : 'Not a PDF' }));
                return;
              }
              mkdirSync(dir, { recursive: true });
              writeFileSync(file, body);
              res.end(JSON.stringify({ exists: true, url }));
            });
            return;
          }

          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        next();
      });
    },
  };
}
