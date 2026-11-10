import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BANNER_WIDTH, bannerLines, readAppVersion, versionLabel } from '../startup-banner';

describe('bannerLines', () => {
  it('shows the name, the version and the links', () => {
    const text = bannerLines('0.1.0').join('\n');
    expect(text).toContain('PHYSAI-QA-INTERACTIVE');
    expect(text).toContain('version 0.1.0 (beta)');
    expect(text).toContain('https://github.com/rgbayrak/physai-qa-interactive');
    expect(text).toContain('https://doi.org/10.5281/zenodo.19389717');
  });

  it('keeps every line within the rule width', () => {
    for (const line of bannerLines('0.1.0')) expect(line.length).toBeLessThanOrEqual(BANNER_WIDTH);
  });
});

describe('versionLabel', () => {
  it('marks versions below 1.0.0 as beta', () => {
    expect(versionLabel('0.9.3')).toBe('version 0.9.3 (beta)');
    expect(versionLabel('1.0.0')).toBe('version 1.0.0');
  });
});

describe('readAppVersion', () => {
  it('reads the version from package.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'startup-banner-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '2.3.4' }));
    expect(readAppVersion(dir)).toBe('2.3.4');
  });

  it('falls back to unknown without a package.json', () => {
    expect(readAppVersion(mkdtempSync(join(tmpdir(), 'startup-banner-')))).toBe('unknown');
  });
});
