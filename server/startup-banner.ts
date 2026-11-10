import { readFileSync } from 'fs';
import { join } from 'path';

/** Width of the rule lines; no banner line is wider than this */
export const BANNER_WIDTH = 70;

const TITLE = 'PHYSAI-QA-INTERACTIVE';
const DESCRIPTION = [
  'Interactive visualization and annotation of physiological',
  'recordings in BIDS fMRI datasets. Part of the physAI suite.',
];
const INFO: [string, string][] = [
  ['Docs and issues', 'https://github.com/rgbayrak/physai-qa-interactive'],
  ['Cite', 'https://doi.org/10.5281/zenodo.19389717'],
  ['License', 'MIT'],
  ['Stop', 'Ctrl+C'],
];

/** Version from package.json, or 'unknown' if it cannot be read */
export function readAppVersion(cwd: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Version label: versions below 1.0.0 are marked beta */
export function versionLabel(version: string): string {
  return /^0\./.test(version) ? `version ${version} (beta)` : `version ${version}`;
}

/** The lines of the welcome banner printed when the dev server starts */
export function bannerLines(version: string): string[] {
  const rule = '  ' + '─'.repeat(BANNER_WIDTH - 2);
  const label = versionLabel(version);
  const gap = Math.max(1, BANNER_WIDTH - 3 - TITLE.length - label.length);
  const keyWidth = Math.max(...INFO.map(([key]) => key.length));
  return [
    rule,
    `   ${TITLE}${' '.repeat(gap)}${label}`,
    ...DESCRIPTION.map((line) => `   ${line}`),
    '',
    ...INFO.map(([key, value]) => `   ${key.padEnd(keyWidth)}  ${value}`),
    rule,
  ];
}
