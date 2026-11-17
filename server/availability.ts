import { execFileSync } from 'child_process';
import { relative, sep } from 'path';
import type { BidsIndex } from './bids-index';

// How many physio files a dataset lists, and how many of them are downloaded.
// DataLad datasets list every file, but a file that was never fetched
// (datalad get) is a dangling symlink, or in "unlocked" mode a small pointer
// file. git-annex knows which is which; without it, the file itself is checked
// (hasPhysioContent, the same check that decides which files become scans).

export interface PhysioFileCount {
  /** Physio files listed in the dataset, downloaded or not */
  onDisk: number;
  /** Of those, the ones whose content is here */
  downloaded: number;
  /** How "downloaded" was decided */
  source: 'git-annex' | 'files on disk';
}

/**
 * Every physio file (*_physio.tsv.gz, or *_physio.tsv) in the index, downloaded or not, in any folder:
 * the folder walked and the path relative to it (with '/'), sorted.
 */
export function listPhysioPaths(index: BidsIndex): { root: string; path: string }[] {
  return index.files
    .filter((f) => f.kind === 'physio')
    .map((f) => ({ root: f.root, path: relative(f.root, f.path).split(sep).join('/') }))
    .sort((a, b) => a.root.localeCompare(b.root) || a.path.localeCompare(b.path));
}

/** Paths in `git annex find --not --in=here` output (one per line, relative to the folder it ran in) */
export function parseAnnexMissing(output: string): Set<string> {
  return new Set(
    output
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0),
  );
}

/**
 * Annexed files under root whose content is not here, or null when git-annex
 * can't answer (not installed, not an annex repository, or too slow).
 * Read-only and local: it never downloads anything.
 */
function annexMissing(root: string): Set<string> | null {
  try {
    const out = execFileSync('git', ['annex', 'find', '--not', '--in=here'], {
      cwd: root,
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return parseAnnexMissing(out);
  } catch {
    return null;
  }
}

/**
 * Count the physio files in the index and those downloaded: with git-annex
 * (run in each folder walked) when it can answer for all of them (physio
 * files kept in plain git count as downloaded), otherwise by checking each
 * file's content.
 */
export function countPhysioFiles(index: BidsIndex, useAnnex = true): PhysioFileCount {
  const paths = listPhysioPaths(index);
  const roots = [...new Set(paths.map((p) => p.root))];
  const missing = new Map<string, Set<string>>();
  if (useAnnex && paths.length > 0) {
    for (const root of roots) {
      const m = annexMissing(root);
      if (!m) break;
      missing.set(root, m);
    }
  }
  if (roots.length > 0 && missing.size === roots.length) {
    const downloaded = paths.filter((p) => !missing.get(p.root)!.has(p.path)).length;
    return { onDisk: paths.length, downloaded, source: 'git-annex' };
  }
  return {
    onDisk: paths.length,
    downloaded: index.files.filter((f) => f.kind === 'physio' && f.readable).length,
    source: 'files on disk',
  };
}
