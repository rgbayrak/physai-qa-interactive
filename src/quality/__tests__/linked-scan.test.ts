import { describe, it, expect } from 'vitest';
import { lastViewedKey, readLastViewed, saveLastViewed } from '@/viewer/persistence';
import { parseScanId } from '@/data/scan-key';
import { shareScanWithViewer, viewerScan } from '../linked-scan';

/** Minimal in-memory Storage for Node */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

const NAME = 'DMT-HAR-MED';
const scan = (id: string) => parseScanId(id)!;

describe('scan shared with Explore and Annotate', () => {
  it('reads the scan the viewer last showed for this dataset', () => {
    const store = memoryStorage();
    saveLastViewed(
      lastViewedKey(NAME),
      { ...scan('eeg/sub-03_ses-02_task-rest'), channel: 'cardiac', confound: 'framewise_displacement' },
      store,
    );
    expect(viewerScan(NAME, store)).toEqual(scan('eeg/sub-03_ses-02_task-rest'));
    // another dataset's entry is not used
    expect(viewerScan('Other dataset', store)).toBeNull();
  });

  it('returns null when nothing was saved, the entry is malformed, or it has no scan id (older entry)', () => {
    const store = memoryStorage();
    expect(viewerScan(NAME, store)).toBeNull();
    store.setItem(lastViewedKey(NAME), '{"channel":"cardiac"}');
    expect(viewerScan(NAME, store)).toBeNull();
    store.setItem(lastViewedKey(NAME), '{"sub":"01","ses":"","task":"rest","run":"","channel":"cardiac"}');
    expect(viewerScan(NAME, store)).toBeNull();
  });

  it('writes the scan for the viewer, keeping its channel choices', () => {
    const store = memoryStorage();
    saveLastViewed(
      lastViewedKey(NAME),
      {
        ...scan('func/sub-01_ses-01_task-rest'),
        channel: 'respiratory',
        confound: 'dvars',
        event: 'trial_type',
        stacked: ['cardiac'],
      },
      store,
    );
    shareScanWithViewer(NAME, scan('func/sub-05_ses-02_task-rest_acq-mb'), store);
    expect(readLastViewed(lastViewedKey(NAME), store)).toEqual({
      ...scan('func/sub-05_ses-02_task-rest_acq-mb'),
      channel: 'respiratory',
      confound: 'dvars',
      event: 'trial_type',
      stacked: ['cardiac'],
    });
  });

  it('writes a usable entry when the viewer has none yet', () => {
    const store = memoryStorage();
    shareScanWithViewer(null, scan('func/sub-02_task-motor'), store);
    expect(readLastViewed(lastViewedKey(null), store)).toEqual({
      ...scan('func/sub-02_task-motor'),
      channel: '',
      confound: '',
      event: '',
      stacked: [],
    });
    expect(viewerScan(null, store)).toEqual(scan('func/sub-02_task-motor'));
  });
});
