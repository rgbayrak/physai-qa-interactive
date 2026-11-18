// Detect peaks in each PPG, ECG and respiratory channel of a dataset with one
// detector per signal type (its default: Elgendi 2013 for PPG, NeuroKit for ECG,
// Khodadad 2018 for respiration), and write one file per channel to
// data/peaks/<dataset>/ (laid out like the annotations), for viewing in the app.
// This lists the channels with the app's BIDS index and writes a manifest;
// scripts/detect_peaks.py (run with uv) runs the detectors. Each channel's file
// holds exactly the run's detectors (the default only, unless told otherwise).
//
//   npx vite-node scripts/compute-peaks.ts -- <dataset> [options]
//
//   <dataset>              folder name under data/ (e.g. ds006644, friends)
//   --bids-root <path>     main BIDS folder (default: data/<dataset>)
//   --physio-root <path>   folder holding the physio files, when stored outside the main folder
//   --deriv-root <path>    derivatives folder, when stored outside the main folder
//   --out <path>           output root (default: data/peaks)
//   --max-scans <N>        only the first N readable scans, in Prev/Next order (subject, session,
//                          task, run). N is the user's choice: no default
//   --detectors <ids>      comma-separated detector ids to run instead of the defaults, for their
//                          signal types (others keep their default); list with --list-detectors
//   --all-detectors        run every detector
//   --list-detectors       print the detector ids (and which is the default) and exit
//   --force                run detectors again that a channel's file already has (default: skip them)
//   --channel <col>=<type> the column's type for this run: ppg, ecg, resp or none (repeatable). Wins
//                          over the name; the run warns about ambiguous or unknown names with this hint

import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { resolveDatasetPaths } from '../server/quality-metrics';
import { buildBidsIndex, indexSummaryLines } from '../server/bids-index';
import { buildScans } from '../server/bids-layout';
import { buildPeaksManifest } from '../server/peaks';
import { channelTypeTableLines, parseChannelOverrides } from '../src/quality/channels';

/** The run's channel types table, next to the peaks (overwritten by each run) */
const CHANNEL_TYPES_FILE = 'channel_types.json';

const USAGE =
  'Usage: compute-peaks <dataset> [--bids-root <path>] [--physio-root <path>] [--deriv-root <path>] [--out <path>] ' +
  '[--max-scans <N>] [--detectors <id,id,...> | --all-detectors] [--list-detectors] [--force] ' +
  '[--channel <column>=<ppg|ecg|resp|none> ...]';

/** Run from the repository root, as the other scripts are */
const DETECTOR_SCRIPT = join(process.cwd(), 'scripts', 'detect_peaks.py');

interface Options {
  dataset?: string;
  bidsRoot?: string;
  physioRoot?: string;
  derivRoot?: string;
  out?: string;
  maxScans?: number;
  detectors?: string;
  allDetectors?: boolean;
  listDetectors?: boolean;
  force?: boolean;
  channels: string[];
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { channels: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a value\n${USAGE}`);
      return v;
    };
    if (a === '--help' || a === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (a === '--bids-root') opts.bidsRoot = resolve(value());
    else if (a === '--physio-root') opts.physioRoot = resolve(value());
    else if (a === '--deriv-root') opts.derivRoot = resolve(value());
    else if (a === '--out') opts.out = resolve(value());
    else if (a === '--detectors') opts.detectors = value();
    else if (a === '--all-detectors') opts.allDetectors = true;
    else if (a === '--list-detectors') opts.listDetectors = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--channel') opts.channels.push(value());
    else if (a === '--max-scans') {
      const v = argv[++i];
      const n = Number(v);
      if (!v || !Number.isInteger(n) || n < 1) throw new Error(`--max-scans needs a whole number of at least 1\n${USAGE}`);
      opts.maxScans = n;
    } else if (a.startsWith('-')) throw new Error(`Unknown option ${a}\n${USAGE}`);
    else if (!opts.dataset) opts.dataset = a;
    else throw new Error(`Unexpected argument ${a}\n${USAGE}`);
  }
  return opts;
}

/** Width of the section rules in the terminal output */
const RULE_WIDTH = 72;
const RULE = '─'.repeat(RULE_WIDTH);

/** A blank line, then "── Title ─────…": separates the sections of the output */
function section(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(3, RULE_WIDTH - title.length - 4))}`);
}

/** Run detect_peaks.py with uv; its output goes straight to the terminal */
function runDetectors(args: string[]): number {
  const r = spawnSync('uv', ['run', '--script', DETECTOR_SCRIPT, ...args], { stdio: 'inherit' });
  if (r.error) throw new Error(`Could not start uv (${r.error.message}); install it from https://docs.astral.sh/uv/`);
  return r.status ?? 1;
}

try {
  const args = parseArgs(process.argv.slice(2).filter((a) => a !== '--'));
  if (args.listDetectors) process.exit(runDetectors(['--list-detectors']));
  if (!args.dataset) throw new Error(USAGE);
  if (args.detectors && args.allDetectors) throw new Error(`Use --detectors or --all-detectors, not both\n${USAGE}`);

  const dataDir = join(process.cwd(), 'data');
  const paths = resolveDatasetPaths(dataDir, args.dataset, {
    bidsRoot: args.bidsRoot,
    physioRoot: args.physioRoot,
    derivRoot: args.derivRoot,
  });
  section(`Dataset ${args.dataset}`);
  console.log(`  BIDS folder: ${paths.bidsRoot}`);
  if (paths.physioRoot) console.log(`  Physio folder: ${paths.physioRoot}`);
  const index = buildBidsIndex(paths);
  for (const line of indexSummaryLines(index)) console.log(`  ${line}`);

  const readable = buildScans(index);
  const scans = args.maxScans === undefined ? readable : readable.slice(0, args.maxScans);
  console.log(
    scans.length < readable.length
      ? `  Scans: the first ${scans.length} of ${readable.length} readable scans (--max-scans ${args.maxScans}), ${scans[0]?.id} … ${scans[scans.length - 1]?.id}`
      : `  Scans: all ${readable.length} readable scans`,
  );

  const outDir = join(args.out ?? join(dataDir, 'peaks'), args.dataset);
  const overrides = parseChannelOverrides(args.channels);
  const manifest = buildPeaksManifest(index, scans, outDir, { overrides });

  // What every column of the physio.json sidecars was taken as, and why ("!" = check it); saved with the peaks
  section('Channel types (from the physio.json Columns; "!" = check)');
  for (const line of channelTypeTableLines(manifest.channelTypes)) console.log(`  ${line}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, CHANNEL_TYPES_FILE), JSON.stringify(manifest.channelTypes, null, 1) + '\n');
  for (const s of manifest.skipped) console.log(`  Skipped ${s.file}: ${s.reason}`);

  section('Peak detection');
  if (manifest.jobs.length === 0) {
    console.log('  Nothing to compute.');
    process.exit(0);
  }

  const manifestPath = join(outDir, 'peaks_manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest.jobs, null, 1));
  console.log(`  Output: ${outDir}`);
  console.log('  Starting the Python detectors with uv (the first run downloads the packages; this can take a minute) …');
  const status = runDetectors([
    manifestPath,
    ...(args.detectors ? ['--detectors', args.detectors] : []),
    ...(args.allDetectors ? ['--all-detectors'] : []),
    ...(args.force ? ['--force'] : []),
  ]);
  if (status !== 0) process.exit(status);
  console.log(RULE);
  console.log('To view them: npm run dev, open one of these scans, and tick "Show peaks" under BUILT-IN PEAK DETECTION.');
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
