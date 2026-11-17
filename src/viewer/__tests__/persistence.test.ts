import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LAST_VIEWED_KEY,
  clearOldLocalStorage,
  lastViewedKey,
  saveLastViewed,
  readLastViewed,
  resumeFrom,
} from '../persistence';
import type { LastViewed } from '../persistence';
import { parseScanId } from '@/data/scan-key';

/** Minimal in-memory Storage */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
} as unknown as Storage;

const scans = [parseScanId('func/sub-01_ses-01_task-rest_run-01')!, parseScanId('func/sub-02_ses-01_task-rest_run-01')!];

const saved: LastViewed = {
  ...scans[1],
  channel: 'respiratory',
  confound: 'rot_x',
  event: 'trial_type',
  stacked: ['cardiac'],
};

describe('last-viewed storage', () => {
  it('scopes the key per dataset', () => {
    expect(lastViewedKey('ds006644')).not.toBe(lastViewedKey('ds000210'));
    expect(lastViewedKey(null)).toMatch(/:unnamed$/);
  });

  it('round-trips through storage', () => {
    const store = memoryStorage();
    saveLastViewed('k', saved, store);
    expect(readLastViewed('k', store)).toEqual(saved);
  });

  it('returns null for a missing or corrupt entry', () => {
    const store = memoryStorage();
    expect(readLastViewed('k', store)).toBeNull();
    store.setItem('k', '{not json');
    expect(readLastViewed('k', store)).toBeNull();
  });

  it('never throws when storage is blocked or unavailable', () => {
    expect(() => saveLastViewed('k', saved, throwingStorage)).not.toThrow();
    expect(readLastViewed('k', throwingStorage)).toBeNull();
    expect(readLastViewed('k', null)).toBeNull();
  });
});

describe('resumeFrom', () => {
  it('resumes the saved scan with its channel, confound, events column and stack', () => {
    expect(resumeFrom(saved, scans)).toEqual({
      scan: scans[1],
      selection: { channel: 'respiratory', confound: 'rot_x', event: 'trial_type', stacked: ['cardiac'] },
      locks: {},
    });
  });

  it('restores locks that some scan still has, and drops the others', () => {
    expect(resumeFrom({ ...saved, locks: { task: 'rest' } }, scans)?.locks).toEqual({ task: 'rest' });
    expect(resumeFrom({ ...saved, locks: { task: 'gone' } }, scans)?.locks).toEqual({});
    expect(resumeFrom({ ...saved, locks: ['task'] as unknown as Record<string, string> }, scans)?.locks).toEqual({});
  });

  it('treats entries saved before the events figure existed as no events column', () => {
    const old: LastViewed = { ...saved };
    delete old.event;
    expect(resumeFrom(old, scans)?.selection.event).toBe('');
  });

  it('returns null when the saved scan is no longer in the dataset', () => {
    expect(resumeFrom({ ...saved, id: 'func/sub-99_ses-01_task-rest_run-01' }, scans)).toBeNull();
    expect(resumeFrom(null, scans)).toBeNull();
  });

  it('ignores entries saved before scans had ids', () => {
    const { id: _id, ...old } = saved;
    expect(resumeFrom(old as unknown as LastViewed, scans)).toBeNull();
  });

  it('treats entries saved before stacked channels existed as an empty stack', () => {
    const old: LastViewed = { ...saved };
    delete old.stacked;
    expect(resumeFrom(old, scans)?.selection.stacked).toEqual([]);
  });
});

describe('choices kept for one visit only', () => {
  it('keys the entry by dataset and dev server launch, so a new launch finds nothing', () => {
    expect(lastViewedKey('ds', 'L1')).not.toBe(lastViewedKey('ds', 'L2'));
    const store = memoryStorage();
    const entry: LastViewed = { ...scans[1], channel: 'cardiac', confound: '', locks: { sub: '02' } };
    saveLastViewed(lastViewedKey('ds', 'L1'), entry, store);
    expect(resumeFrom(readLastViewed(lastViewedKey('ds', 'L1'), store), scans)?.locks).toEqual({ sub: '02' });
    expect(readLastViewed(lastViewedKey('ds', 'L2'), store)).toBeNull();
  });

  it('removes what earlier versions left in localStorage, and nothing else', () => {
    const store = memoryStorage();
    store.setItem(`${DEFAULT_LAST_VIEWED_KEY}:ds`, '{}');
    store.setItem('physai-quality-visible-metrics', '[]');
    store.setItem('unrelated', 'x');
    clearOldLocalStorage([DEFAULT_LAST_VIEWED_KEY, 'physai-quality-visible-metrics'], store);
    expect([...Array(store.length).keys()].map((i) => store.key(i))).toEqual(['unrelated']);
    clearOldLocalStorage([DEFAULT_LAST_VIEWED_KEY], throwingStorage); // blocked storage: no error
  });
});
