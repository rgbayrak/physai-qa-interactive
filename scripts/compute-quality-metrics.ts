// Compute quality metrics for every scan of a dataset and write them to
// data/quality/<dataset>/ (quality_metrics.tsv, dataset.json, waveforms/), and
// add a line to quality_runs.tsv there for each run. The
// PDF report (quality_report.pdf) is saved there by the Stats tab when it next opens.
//
//   npx vite-node scripts/compute-quality-metrics.ts -- <dataset> [options]
//
//   <dataset>              folder name under data/ (e.g. ds006644, friends)
//   --bids-root <path>     main BIDS folder (default: data/<dataset>)
//   --physio-root <path>   folder holding the physio files, when stored outside the main folder
//                          (walked too; physio anywhere inside the main folder is always found)
//   --deriv-root <path>    derivatives folder with the confounds, when stored outside the main folder
//                          (walked too; confounds anywhere inside the main folder are always found)
//   --out <path>           output root (default: data/quality)
//   --max-scans <N>        compute only the first N readable scans, in Prev/Next order (subject,
//                          session, task, run), e.g. 10 for sub-01's first scans: a quick subset for
//                          a look or the user study. Replaces the last results like a full run;
//                          the pages say it is a subset. N is the user's choice: no default

import { join, resolve } from 'path';
import { runQualityMetrics } from '../server/quality-metrics';
import { appendQualityRun } from '../server/quality-run-log';
import { localTimestamp, notDownloaded, subsetNote } from '../src/quality/run-log';

const USAGE =
  'Usage: compute-quality-metrics <dataset> [--bids-root <path>] [--physio-root <path>] [--deriv-root <path>] [--out <path>] [--max-scans <N>]';

function parseArgs(argv: string[]) {
  const opts: {
    dataset?: string;
    bidsRoot?: string;
    physioRoot?: string;
    derivRoot?: string;
    out?: string;
    maxScans?: number;
  } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a value\n${USAGE}`);
      return resolve(v);
    };
    if (a === '--help' || a === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (a === '--bids-root') opts.bidsRoot = value();
    else if (a === '--physio-root') opts.physioRoot = value();
    else if (a === '--deriv-root') opts.derivRoot = value();
    else if (a === '--out') opts.out = value();
    else if (a === '--max-scans') {
      const v = argv[++i];
      const n = Number(v);
      if (!v || !Number.isInteger(n) || n < 1) throw new Error(`--max-scans needs a whole number of at least 1\n${USAGE}`);
      opts.maxScans = n;
    } else if (a.startsWith('-')) throw new Error(`Unknown option ${a}\n${USAGE}`);
    else if (!opts.dataset) opts.dataset = a;
    else throw new Error(`Unexpected argument ${a}\n${USAGE}`);
  }
  if (!opts.dataset) throw new Error(USAGE);
  return opts as typeof opts & { dataset: string };
}

try {
  const args = parseArgs(process.argv.slice(2).filter((a) => a !== '--'));
  const started = Date.now();
  const runDate = localTimestamp();
  const dataDir = join(process.cwd(), 'data');
  const result = runQualityMetrics({
    dataDir,
    dataset: args.dataset,
    outRoot: args.out,
    bidsRoot: args.bidsRoot,
    physioRoot: args.physioRoot,
    derivRoot: args.derivRoot,
    maxScans: args.maxScans,
    log: (msg) => console.log(msg),
  });
  const { nScans, nSubjects, failedScans } = result.summary;
  const nPhysio = result.summary.nPhysio ?? nScans;
  console.log(
    `Done in ${((Date.now() - started) / 1000).toFixed(1)} s: ${nScans} scans (${nPhysio} physio recordings), ` +
      `${nSubjects} subjects` +
      (failedScans.length ? `, ${failedScans.length} failed (listed in dataset.json)` : ''),
  );

  // Run log: one line per run in quality_runs.tsv, next to the metrics (read by the Stats tab).
  // Counted in physio recordings (one per recording- file) on every side, so a
  // scan split into recording-cardiac and recording-respiratory counts twice
  // in each: listed (downloaded or not), computed, and downloaded but failed
  const listed = result.index.stats.physioRecordings;
  // Readable recordings of the scans computed (all readable scans, or the --max-scans subset):
  // those not computed failed; scans left out by --max-scans are not failures
  const readable = result.scans.reduce((n, s) => n + (result.index.scans.get(s.id)?.length ?? 0), 0);
  const run = {
    runDate,
    scansComputed: nPhysio,
    scansAvailable: listed,
    scansFailed: Math.max(0, readable - nPhysio),
    countSource: 'files on disk',
    ...(args.maxScans !== undefined ? { maxScans: args.maxScans } : {}),
  };
  const logPath = appendQualityRun(result.outDir, run);
  const note = subsetNote(run) || `${notDownloaded(run)} not downloaded`;
  console.log(`Coverage: ${nPhysio} of ${listed} physio recordings (${note}, ${run.scansFailed} failed). Logged in ${logPath}`);
  console.log(
    'The PDF report (quality_report.pdf) is built and saved next to these files the next time the Stats tab opens (npm run dev).',
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
