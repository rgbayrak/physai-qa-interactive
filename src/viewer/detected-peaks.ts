import type { DetectedPeaksFile } from '@/data/detected-peaks';

// BUILT-IN PEAK DETECTION row: which detector's peaks the "Show peaks" box shows,
// from the channel's peaks file (scripts/compute-peaks.ts). Pure; wired in main.ts.

/**
 * The detector whose peaks are shown: the file's default when it ran, else the
 * first that ran (a file computed with --detectors may lack the default); null
 * when none ran or there is no file.
 */
export function shownDetector(file: DetectedPeaksFile | null): string | null {
  if (!file) return null;
  const ran = file.detectors.filter((d) => d.error === null);
  return (ran.find((d) => d.default) ?? ran[0])?.id ?? null;
}
