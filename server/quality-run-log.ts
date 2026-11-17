import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { RUN_LOG_HEADER, RUN_LOG_NAME, runLogLine } from '../src/quality/run-log';
import type { QualityRun } from '../src/quality/run-log';

/**
 * Append one run to <outDir>/quality_runs.tsv, writing the header first when
 * the file is new (or empty). Earlier runs are kept as history; a log written
 * before a column was added gets the current header, its old lines unchanged
 * (a missing last column reads as n/a, parseLastRun).
 */
export function appendQualityRun(outDir: string, run: QualityRun): string {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, RUN_LOG_NAME);
  const header = RUN_LOG_HEADER.join('\t');
  const old = existsSync(path) ? readFileSync(path, 'utf-8') : '';
  if (old.trim() === '') {
    writeFileSync(path, `${header}\n${runLogLine(run)}\n`);
    return path;
  }
  const [first, ...rest] = old.split('\n');
  if (first.replace(/\r$/, '') !== header) writeFileSync(path, [header, ...rest].join('\n'));
  appendFileSync(path, runLogLine(run) + '\n');
  return path;
}
