import { lstatSync, statSync } from 'fs';
import { join, resolve } from 'path';

/** Folder settings as given in the environment (BIDS_ROOT, BIDSPHYS_ROOT, BIDSDER_ROOT) */
export interface RootSettings {
  bidsRoot?: string;
  physioRoot?: string;
  derivRoot?: string;
}

/**
 * Either the given folders as absolute paths (relative ones are read from cwd),
 * or the lines of a message telling the user what to set. There is no default
 * dataset: without BIDS_ROOT the dev server does not start.
 */
export type RootsCheck =
  | { ok: true; bidsRoot: string; physioRoot?: string; derivRoot?: string }
  | { ok: false; lines: string[] };

const RUN_AGAIN = '      BIDS_ROOT=data/<dataset> npm run dev';
const ELSEWHERE = [
  '    If the physio or derivatives are stored outside that folder, also set:',
  '      BIDSPHYS_ROOT=<folder with *_physio.tsv.gz>   BIDSDER_ROOT=<folder with confounds>',
];

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** True if path exists, counting a git-annex link whose content is not downloaded */
function isPresent(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Check the folder settings before the dev server reads anything from them */
export function checkRootSettings(settings: RootSettings, cwd: string): RootsCheck {
  if (!settings.bidsRoot) {
    return {
      ok: false,
      lines: [
        'No BIDS dataset given.',
        '    Tell the viewer where your dataset is, then run again:',
        RUN_AGAIN,
        ...ELSEWHERE,
      ],
    };
  }

  const bidsRoot = resolve(cwd, settings.bidsRoot);
  const physioRoot = settings.physioRoot ? resolve(cwd, settings.physioRoot) : undefined;
  const derivRoot = settings.derivRoot ? resolve(cwd, settings.derivRoot) : undefined;
  const lines: string[] = [];

  if (!isDir(bidsRoot)) {
    lines.push(
      `BIDS_ROOT folder not found: ${bidsRoot}`,
      '    A relative path is read from the project folder. Check the path, then run again:',
      RUN_AGAIN,
    );
  } else if (!isPresent(join(bidsRoot, 'dataset_description.json'))) {
    lines.push(
      `BIDS-compliant dataset not found: ${join(bidsRoot, 'dataset_description.json')} is missing.`,
      '    Point BIDS_ROOT at the main BIDS folder (the one with dataset_description.json), then run again:',
      RUN_AGAIN,
      ...ELSEWHERE,
    );
  }

  if (physioRoot && !isDir(physioRoot)) {
    lines.push(
      `BIDSPHYS_ROOT folder not found: ${physioRoot}`,
      '    Set it to the folder with the *_physio.tsv.gz files, or leave it out if they are inside BIDS_ROOT.',
    );
  }
  if (derivRoot && !isDir(derivRoot)) {
    lines.push(
      `BIDSDER_ROOT folder not found: ${derivRoot}`,
      '    Set it to the derivatives folder with the confounds files, or leave it out if it is inside BIDS_ROOT/derivatives/.',
    );
  }

  return lines.length ? { ok: false, lines } : { ok: true, bidsRoot, physioRoot, derivRoot };
}

/** Warning lines when no physio files were found under physioRoot (the server still starts) */
export function noPhysioLines(physioRoot: string, physioGiven: boolean): string[] {
  return [
    `No readable physio files under ${physioRoot}.`,
    physioGiven
      ? '    Check that BIDSPHYS_ROOT is the folder with the *_physio.tsv.gz files.'
      : '    If the physio is stored outside BIDS_ROOT, set BIDSPHYS_ROOT=<folder with *_physio.tsv.gz>.',
    '    If the files are listed but not downloaded, get them with: datalad get',
  ];
}
